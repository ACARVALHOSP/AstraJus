"""Perfis estruturados e administração de usuários, compatíveis com dados legados."""
import hmac
import json
import re
import secrets
import sqlite3
import tempfile
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

CAMPOS = ('usuario_id', 'nome_completo', 'email', 'email_verificado_em', 'criado_em',
          'atualizado_em', 'ultimo_acesso_em', 'nivel_acesso', 'status', 'criado_por',
          'revogado_em', 'revogado_por')
EDITAVEIS = {'nome_completo', 'email', 'nivel_acesso', 'status'}
NIVEIS = {'administrador', 'operador', 'consulta'}
STATUS = {'pendente', 'ativo', 'bloqueado', 'revogado'}
CATEGORIAS_LIMPEZA = {
    'publicacoes': ('publicacoes_capturadas', 'publicacao_revisoes', 'origem_djen_migracao_pendencias'),
    'monitoramento_tecnico': ('monitoramento_entregas', 'monitoramento_coletas', 'automacao_execucoes', 'automacao_leases'),
    'notificacoes': ('notificacoes', 'notificacao_eventos'),
}


def agora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def completar(nome, dados):
    r = dict(dados)
    defaults = dict.fromkeys(CAMPOS)
    defaults.update(usuario_id=uuid.uuid4().hex, nome_completo=nome,
                    email=nome if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', nome) else None,
                    nivel_acesso='operador', status='revogado' if r.get('revogado') else 'ativo')
    for k, v in defaults.items():
        r.setdefault(k, v)
    if r.get('revogado'):
        r['status'] = 'revogado'
    r['revogado'] = r['status'] == 'revogado'
    return r


def gravar(c, nome, dados):
    r = completar(nome, dados)
    colunas = ', '.join(('nome', 'dados') + CAMPOS)
    valores = [nome, json.dumps(r, ensure_ascii=False)] + [r[k] for k in CAMPOS]
    atualizacoes = ', '.join(f'{k}=excluded.{k}' for k in ('dados',) + CAMPOS)
    c.execute(f'INSERT INTO usuarios ({colunas}) VALUES ({", ".join("?" for _ in valores)}) '
              f'ON CONFLICT(nome) DO UPDATE SET {atualizacoes}', valores)
    return r


def migrar(c):
    existentes = {r[1] for r in c.execute('PRAGMA table_info(usuarios)')}
    with c:
        for campo in CAMPOS:
            if campo not in existentes:
                c.execute(f'ALTER TABLE usuarios ADD COLUMN {campo} TEXT')
        c.execute('CREATE UNIQUE INDEX IF NOT EXISTS usuarios_id_unico ON usuarios(usuario_id)')
        c.execute('''CREATE TABLE IF NOT EXISTS credencial_administrativa (
            id INTEGER PRIMARY KEY CHECK (id = 1), hash_token TEXT NOT NULL,
            atualizado_em TEXT NOT NULL)''')
        c.execute('''CREATE TABLE IF NOT EXISTS usuarios_auditoria (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrido_em TEXT NOT NULL,
            ator TEXT NOT NULL, usuario TEXT NOT NULL, acao TEXT NOT NULL,
            campos TEXT NOT NULL)''')
        c.execute('''CREATE TABLE IF NOT EXISTS usuarios_acessos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrido_em TEXT NOT NULL,
            usuario TEXT NOT NULL)''')
        for nome, dados in c.execute('SELECT nome, dados FROM usuarios WHERE usuario_id IS NULL').fetchall():
            gravar(c, nome, json.loads(dados))


def publico(nome, dados):
    return {'login': nome, **{k: dados.get(k) for k in CAMPOS}}


def configurar_token_admin(registro, token, *, somente_se_ausente=False):
    """Persiste apenas SHA-256 de um token de alta entropia; nunca o valor original."""
    from db import _abrir
    from _util import _hash_token
    if not isinstance(token, str) or not token:
        raise ValueError('Token administrativo vazio.')
    with registro._trava, _abrir(registro.caminho) as c, c:
        if somente_se_ausente:
            c.execute('INSERT OR IGNORE INTO credencial_administrativa VALUES (1, ?, ?)', (_hash_token(token), agora()))
        else:
            c.execute('INSERT INTO credencial_administrativa VALUES (1, ?, ?) '
                      'ON CONFLICT(id) DO UPDATE SET hash_token=excluded.hash_token, atualizado_em=excluded.atualizado_em',
                      (_hash_token(token), agora()))


def token_admin_configurado(registro):
    from db import _abrir
    with _abrir(registro.caminho) as c:
        return c.execute('SELECT 1 FROM credencial_administrativa WHERE id=1').fetchone() is not None


def validar_token_admin(registro, token):
    from db import _abrir
    from _util import _hash_token
    if not isinstance(token, str) or not token:
        return False
    with _abrir(registro.caminho) as c:
        row = c.execute('SELECT hash_token FROM credencial_administrativa WHERE id=1').fetchone()
    return bool(row and hmac.compare_digest(_hash_token(token), row[0]))


def gerar_token_admin(registro):
    token = secrets.token_urlsafe(32)
    configurar_token_admin(registro, token)
    return token


def validar(dados):
    if not isinstance(dados, dict) or set(dados) - EDITAVEIS - {'login'}:
        raise ValueError('Campos de usuário inválidos.')
    for k in ('login', 'nome_completo', 'email', 'nivel_acesso', 'status'):
        if k in dados and not isinstance(dados[k], str):
            raise ValueError(f'Informe {k} como texto.')
    if 'nome_completo' in dados and (not dados['nome_completo'].strip() or len(dados['nome_completo']) > 200):
        raise ValueError('Nome completo deve ter entre 1 e 200 caracteres.')
    if 'email' in dados and (len(dados['email']) > 254 or (dados['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', dados['email']))):
        raise ValueError('E-mail inválido.')
    if 'nivel_acesso' in dados and dados['nivel_acesso'] not in NIVEIS:
        raise ValueError('Nível de acesso inválido.')
    if 'status' in dados and dados['status'] not in STATUS:
        raise ValueError('Status inválido.')
    return {k: v.strip() for k, v in dados.items()}


def alterar(registro, dados, ator, login=None):
    from db import _abrir
    from _util import _hash_token
    dados = validar(dados)
    novo = login is None
    login = dados.get('login', '').lower() if novo else login
    if not re.fullmatch(r'[a-z0-9._+@-]{2,254}', login):
        raise ValueError('Login inválido: use de 2 a 254 letras minúsculas, números ou . _ + @ - .')
    if not novo and 'login' in dados:
        raise ValueError('O login não pode ser alterado.')
    with registro._trava, _abrir(registro.caminho) as c, c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT dados FROM usuarios WHERE nome=?', (login,)).fetchone()
        if novo and row:
            raise ValueError('Esse login já está cadastrado.')
        if not novo and not row:
            raise LookupError('Usuário não encontrado.')
        token = secrets.token_urlsafe(32) if novo else None
        anterior = json.loads(row[0]) if row else {}
        r = completar(login, anterior)
        if novo:
            if not dados.get('nome_completo') or not dados.get('email'):
                raise ValueError('Informe nome completo e e-mail.')
            r.update(hash=_hash_token(token), criado_em=agora(), criado_por=ator, origem='admin')
        r.update({k: v or None for k, v in dados.items() if k in EDITAVEIS})
        if 'nivel_acesso' in dados and r['nivel_acesso'] != 'administrador':
            r['administrador_integracoes'] = False
        if r['email']:
            duplicado = c.execute('SELECT 1 FROM usuarios WHERE lower(email)=lower(?) AND nome<>?', (r['email'], login)).fetchone()
            if duplicado:
                raise ValueError('E-mail já utilizado por outro usuário.')
        if anterior.get('email') != r['email']:
            r['email_verificado_em'] = None
        if ator == 'usuario:' + login and (r['status'] != 'ativo' or r['nivel_acesso'] != 'administrador'):
            raise ValueError('Você não pode remover o próprio acesso administrativo.')
        if anterior.get('nivel_acesso') == 'administrador' and anterior.get('status') == 'ativo' and (r['status'] != 'ativo' or r['nivel_acesso'] != 'administrador'):
            if c.execute("SELECT count(*) FROM usuarios WHERE nivel_acesso='administrador' AND status='ativo'").fetchone()[0] <= 1:
                raise ValueError('Mantenha pelo menos um administrador ativo.')
        if anterior.get('status') == 'revogado' and r['status'] != 'revogado':
            raise ValueError('Acesso revogado não pode ser reativado. Crie uma nova conta.')
        r['revogado'] = r['status'] == 'revogado'
        if r['revogado'] and anterior.get('status') != 'revogado':
            r.update(revogado_em=agora(), revogado_por=ator)
        r['atualizado_em'] = agora()
        r = gravar(c, login, r)
        campos = sorted(k for k in EDITAVEIS if anterior.get(k) != r.get(k))
        c.execute('INSERT INTO usuarios_auditoria (ocorrido_em, ator, usuario, acao, campos) VALUES (?, ?, ?, ?, ?)',
                  (agora(), ator, login, 'criar' if novo else 'atualizar', json.dumps(campos)))
    return {'usuario': publico(login, r), **({'token': token} if token else {})}


def registrar_acesso(registro, login):
    from db import _abrir
    with registro._trava, _abrir(registro.caminho) as c, c:
        data = agora()
        # No máximo uma escrita por minuto, mesmo com polling da interface.
        cursor = c.execute("""UPDATE usuarios SET ultimo_acesso_em=?,
            dados=json_set(dados, '$.ultimo_acesso_em', ?)
            WHERE nome=? AND (ultimo_acesso_em IS NULL OR substr(ultimo_acesso_em,1,16)<>substr(?,1,16))""",
                  (data, data, login, data))
        if cursor.rowcount:
            c.execute('INSERT INTO usuarios_acessos (ocorrido_em, usuario) VALUES (?, ?)', (data, login))
            # Limita a retenção sem guardar IP, credenciais ou o conteúdo consultado.
            c.execute("DELETE FROM usuarios_acessos WHERE ocorrido_em < strftime('%Y-%m-%dT%H:%M:%S', 'now', '-180 days')")


async def tratar(app, scope, receive, send, s):
    from db import _abrir
    enviar_original = send
    async def sem_cache(evento):
        if evento['type'] == 'http.response.start':
            evento = {**evento, 'headers': list(evento.get('headers', [])) + [(b'cache-control', b'no-store')]}
        await enviar_original(evento)
    send = sem_cache
    auth = dict(scope.get('headers', [])).get(b'authorization', b'').decode('latin-1')
    token = auth[7:] if auth.startswith('Bearer ') else ''
    chave = 'usuarios-admin:' + s._ip_cliente(scope)
    if app.falhas and app.falhas.ocupado(chave)[0]:
        await s._json(send, 429, {'mensagem': 'Muitas tentativas. Aguarde.'})
        return
    bootstrap = validar_token_admin(app.registro, token)
    login = app.registro.identificar(token) if token and not bootstrap else None
    if not login and not bootstrap and token and app.oauth:
        login = app.oauth.identificar(token)
    perfil = app.registro.carregar().get(login, {}) if login else {}
    if not bootstrap and not (perfil.get('nivel_acesso') == 'administrador' and perfil.get('status') == 'ativo'):
        if app.falhas:
            app.falhas.verificar(chave)
        await s._json(send, 403, {'mensagem': 'Acesso restrito a administradores.'})
        return
    ator = 'bootstrap' if bootstrap else 'usuario:' + login
    if login:
        registrar_acesso(app.registro, login)
    path, method = scope['path'], scope['method']
    try:
        if path == '/admin/usuarios/api' and method == 'GET':
            await s._json(send, 200, {'usuarios': [publico(n, r) for n, r in sorted(app.registro.carregar().items())]})
        elif path == '/admin/usuarios/historico' and method == 'GET':
            with _abrir(app.registro.caminho) as c:
                rows = c.execute('SELECT ocorrido_em, ator, usuario, acao, campos FROM usuarios_auditoria ORDER BY id DESC LIMIT 100').fetchall()
            await s._json(send, 200, {'historico': [dict(zip(('ocorrido_em', 'ator', 'usuario', 'acao', 'campos'), r)) for r in rows]})
        elif path == '/admin/usuarios/acessos' and method == 'GET':
            with _abrir(app.registro.caminho) as c:
                rows = c.execute('SELECT ocorrido_em, usuario FROM usuarios_acessos ORDER BY id DESC LIMIT 100').fetchall()
            await s._json(send, 200, {'acessos': [dict(zip(('ocorrido_em', 'usuario'), r)) for r in rows]})
        elif path == '/admin/banco/api' and method == 'GET':
            with _abrir(app.registro.caminho) as c:
                tamanho = c.execute('PRAGMA page_count').fetchone()[0] * c.execute('PRAGMA page_size').fetchone()[0]
                tabelas = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
            await s._json(send, 200, {'tipo': 'SQLite', 'tamanho_bytes': tamanho, 'tabelas': tabelas})
        elif path == '/admin/banco/integridade' and method == 'POST':
            with _abrir(app.registro.caminho) as c:
                resultado = [r[0] for r in c.execute('PRAGMA quick_check')]
            await s._json(send, 200, {'integro': resultado == ['ok'], 'verificado_em': agora()})
        elif path == '/admin/banco/limpar' and method == 'POST':
            raw = await s._ler_corpo(receive)
            if raw is None:
                await s._json(send, 413, {'mensagem': 'Corpo da requisição grande demais.'})
                return
            dados = json.loads(raw) if raw else {}
            categorias = dados.get('categorias')
            if not isinstance(categorias, list) or not categorias or not set(categorias) <= set(CATEGORIAS_LIMPEZA):
                await s._json(send, 400, {'mensagem': 'Informe ao menos uma categoria válida: ' + ', '.join(CATEGORIAS_LIMPEZA)})
                return
            apagados = {}
            with _abrir(app.registro.caminho) as c, c:
                for categoria in categorias:
                    total = 0
                    for tabela in CATEGORIAS_LIMPEZA[categoria]:
                        total += c.execute(f'DELETE FROM {tabela}').rowcount
                    apagados[categoria] = total
                c.execute('INSERT INTO usuarios_auditoria (ocorrido_em, ator, usuario, acao, campos) VALUES (?, ?, ?, ?, ?)',
                          (agora(), ator, '(sistema)', 'limpar_banco', json.dumps(apagados, ensure_ascii=False)))
            await s._json(send, 200, {'apagados': apagados})
        elif path == '/admin/banco/backup' and method == 'POST':
            with tempfile.TemporaryDirectory() as tmp:
                destino = Path(tmp) / 'cnj-backup.db'
                with _abrir(app.registro.caminho) as origem, closing(sqlite3.connect(destino)) as copia:
                    origem.backup(copia)
                await s._responder(send, 200, destino.read_bytes(), tipo='application/octet-stream',
                    cabecalhos_extra=[(b'content-disposition', b'attachment; filename="cnj-backup.db"'), (b'cache-control', b'no-store')])
        elif (path == '/admin/usuarios/api' and method == 'POST') or (path.startswith('/admin/usuarios/api/') and method == 'PATCH'):
            raw = await s._ler_corpo(receive)
            if raw is None:
                await s._json(send, 413, {'mensagem': 'Corpo da requisição grande demais.'})
                return
            dados = json.loads(raw)
            alvo = unquote(path[len('/admin/usuarios/api/'):]) if method == 'PATCH' else None
            resultado = alterar(app.registro, dados, ator, alvo)
            await s._json(send, 201 if method == 'POST' else 200, resultado)
        else:
            await s._json(send, 405, {'mensagem': 'Método ou rota não permitido.'})
    except LookupError as e:
        await s._json(send, 404, {'mensagem': str(e)})
    except (ValueError, UnicodeDecodeError) as e:
        await s._json(send, 400, {'mensagem': str(e) if not isinstance(e, json.JSONDecodeError) else 'JSON inválido.'})


FERRAMENTAS_CONSULTA = frozenset({'status_apis', 'consultar_processo_datajud',
    'consultar_publicacoes_djen', 'consultar_processo_unificado', 'buscar_feriados_forenses',
    'consultar_jurimetria_cjpg', 'perfil_decisorio_magistrado', 'baixar_certidao_djen', 'listar_monitoramentos'})


def mcp_consulta_permitido(payload):
    if isinstance(payload, list):
        return all(mcp_consulta_permitido(p) for p in payload)
    if not isinstance(payload, dict):
        return False
    return payload.get('method') != 'tools/call' or (
        isinstance(payload.get('params'), dict) and payload['params'].get('name') in FERRAMENTAS_CONSULTA)
