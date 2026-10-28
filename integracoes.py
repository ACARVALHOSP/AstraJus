"""Configurações de serviços cifradas, versionadas e auditadas em SQLite.

A chave de cifragem é infraestrutura: CNJ_INTEGRACOES_CHAVE (Fernet), fora do banco.
Esta implantação tem um escritório institucional, não é um sistema multi-tenant.
"""
import asyncio
import ipaddress
import json
import os
import secrets
import smtplib
import socket
import sqlite3
import ssl
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from cryptography.fernet import Fernet, MultiFernet, InvalidToken


PROVEDORES = {
    'asaas': ('escritorio', {'api_key'}, set()),
    'drive': ('escritorio', set(), {'pasta_raiz'}),
    'zapsign': ('sistema', {'api_key'}, set()),
    'datajud': ('sistema', {'api_key'}, set()),
    'smtp': ('sistema', {'senha'}, {'host', 'porta', 'usuario', 'remetente'}),
    'recaptcha': ('sistema', {'secret'}, {'site_key'}),
    'google_oauth': ('sistema', {'client_secret'}, {'client_id'}),
}
VARIAVEIS = {
    'DATAJUD_API_KEY': ('datajud', 'api_key'),
    'CNJ_GOOGLE_CLIENT_ID': ('google_oauth', 'client_id'),
    'CNJ_GOOGLE_CLIENT_SECRET': ('google_oauth', 'client_secret'),
    'CNJ_GOOGLE_DRIVE_PASTA_RAIZ': ('drive', 'pasta_raiz'),
    'CNJ_SMTP_HOST': ('smtp', 'host'), 'CNJ_SMTP_PORTA': ('smtp', 'porta'),
    'CNJ_SMTP_USUARIO': ('smtp', 'usuario'), 'CNJ_SMTP_SENHA': ('smtp', 'senha'),
    'CNJ_SMTP_REMETENTE': ('smtp', 'remetente'),
    'CNJ_RECAPTCHA_SECRET': ('recaptcha', 'secret'),
    'CNJ_RECAPTCHA_SITE_KEY': ('recaptcha', 'site_key'),
    'ZAPSIGN_API_KEY': ('zapsign', 'api_key'),
}


class Conflito(ValueError):
    pass


class Cofre:
    def __init__(self, caminho, chave, anteriores=()):
        self.caminho = Path(caminho)
        self.cifra = MultiFernet([Fernet(k.encode() if isinstance(k, str) else k) for k in [chave, *anteriores]])
        if self.caminho.exists():
            self._backup_inicial()
        with self.abrir() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS integracoes_identidades (
                nome TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS integracoes_config (
                id INTEGER PRIMARY KEY, provedor TEXT NOT NULL, ambiente TEXT NOT NULL,
                escopo TEXT NOT NULL, dono TEXT NOT NULL, versao INTEGER NOT NULL,
                segredo BLOB NOT NULL, parametros TEXT NOT NULL, estado TEXT NOT NULL,
                base INTEGER NOT NULL, autor TEXT NOT NULL, criado_em REAL NOT NULL,
                UNIQUE(provedor, ambiente, versao));
            CREATE UNIQUE INDEX IF NOT EXISTS integracoes_ativa
                ON integracoes_config(provedor, ambiente) WHERE estado='ativo';
            CREATE TABLE IF NOT EXISTS integracoes_testes (
                id TEXT PRIMARY KEY, config_id INTEGER NOT NULL, autor TEXT NOT NULL,
                criado_em REAL NOT NULL, aprovado INTEGER NOT NULL, mensagem TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS integracoes_auditoria (
                id INTEGER PRIMARY KEY, autor TEXT NOT NULL, acao TEXT NOT NULL,
                provedor TEXT NOT NULL, ambiente TEXT NOT NULL, versao INTEGER,
                instante REAL NOT NULL, resultado TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS integracoes_google (
                finalidade TEXT NOT NULL, dono TEXT NOT NULL, segredo BLOB NOT NULL,
                conectado_em TEXT NOT NULL, cursor TEXT, calendario TEXT,
                PRIMARY KEY(finalidade,dono));
            CREATE TABLE IF NOT EXISTS integracoes_meta (nome TEXT PRIMARY KEY, valor TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS integracoes_asaas_clientes (
                cliente_id TEXT NOT NULL, ambiente TEXT NOT NULL, customer_id TEXT NOT NULL,
                PRIMARY KEY(cliente_id,ambiente));
            ''')
            c.execute('INSERT OR IGNORE INTO integracoes_identidades VALUES (?,?)',
                      ('admin-bootstrap', secrets.token_hex(16)))
            c.execute("INSERT OR IGNORE INTO integracoes_meta VALUES ('asaas_ambiente','sandbox')")

    def _backup_inicial(self):
        """Snapshot consistente e cifrado antes da primeira migração de uma base existente."""
        with self.abrir() as origem:
            tabela = origem.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='integracoes_meta'").fetchone()
            if tabela and origem.execute("SELECT 1 FROM integracoes_meta WHERE nome='importado'").fetchone():
                return
            pasta = self.caminho.parent / 'backups-integracoes'
            pasta.mkdir(mode=0o700, exist_ok=True)
            with tempfile.TemporaryDirectory() as tmp:
                destino = sqlite3.connect(str(Path(tmp)/'snapshot.db'))
                try:
                    origem.backup(destino)
                finally:
                    destino.close()
                cifrado = self.cifra.encrypt((Path(tmp)/'snapshot.db').read_bytes())
            arquivo = pasta / ('antes-migracao-' + secrets.token_hex(8) + '.sqlite.fernet')
            fd = os.open(arquivo, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(cifrado)

    @contextmanager
    def abrir(self):
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(self.caminho, timeout=15)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    def cifrar(self, dados):
        return self.cifra.encrypt(json.dumps(dados).encode())

    def decifrar(self, valor):
        try:
            return json.loads(self.cifra.decrypt(valor))
        except InvalidToken:
            raise ValueError('Chave mestra incompatível com as configurações existentes.') from None

    def ator(self):
        with self.abrir() as c:
            return 'admin:' + c.execute("SELECT id FROM integracoes_identidades WHERE nome='admin-bootstrap'").fetchone()[0]

    @staticmethod
    def validar(provedor, ambiente):
        if provedor not in PROVEDORES or ambiente not in ({'sandbox', 'producao'} if provedor == 'asaas' else {'padrao'}):
            raise ValueError('Integração ou ambiente inválido.')

    @staticmethod
    def auditar(c, autor, acao, provedor, ambiente, versao=None, resultado='ok'):
        c.execute('INSERT INTO integracoes_auditoria(autor,acao,provedor,ambiente,versao,instante,resultado) VALUES(?,?,?,?,?,?,?)',
                  (autor, acao, provedor, ambiente, versao, time.time(), resultado))

    def ativo(self, provedor, ambiente='padrao'):
        with self.abrir() as c:
            r = c.execute("SELECT * FROM integracoes_config WHERE provedor=? AND ambiente=? AND estado='ativo'", (provedor, ambiente)).fetchone()
            return self.dados(r) if r else None

    def dados(self, r):
        return {**json.loads(r['parametros']), **self.decifrar(r['segredo'])}

    def candidato(self, provedor, ambiente, dados, base, autor):
        self.validar(provedor, ambiente)
        if not isinstance(dados, dict) or type(base) is not int:
            raise ValueError('Configuração e versão obrigatórias.')
        escopo, segredos, parametros = PROVEDORES[provedor]
        if set(dados) - segredos - parametros:
            raise ValueError('Campo de configuração desconhecido.')
        if any(not isinstance(v, str) or len(v) > 8192 or any(ord(x) < 32 for x in v) for v in dados.values()):
            raise ValueError('Valor de configuração inválido.')
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            atual = c.execute("SELECT * FROM integracoes_config WHERE provedor=? AND ambiente=? AND estado='ativo'", (provedor, ambiente)).fetchone()
            if base != (atual['versao'] if atual else 0):
                raise Conflito('A configuração mudou. Recarregue antes de editar.')
            unidos = self.dados(atual) if atual else {}
            if provedor == 'smtp' and atual and not dados.get('senha', '').strip():
                if any(dados.get(k, '').strip() and dados[k].strip() != unidos.get(k, '') for k in ('host', 'usuario')):
                    raise Conflito('Informe novamente a senha ao alterar o servidor ou usuário SMTP.')
            unidos.update({k: v.strip() for k, v in dados.items() if v.strip()})
            versao = c.execute('SELECT COALESCE(MAX(versao),0)+1 FROM integracoes_config WHERE provedor=? AND ambiente=?', (provedor, ambiente)).fetchone()[0]
            r = c.execute('INSERT INTO integracoes_config(provedor,ambiente,escopo,dono,versao,segredo,parametros,estado,base,autor,criado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                          (provedor, ambiente, escopo, 'institucional' if escopo == 'escritorio' else 'sistema', versao,
                           self.cifrar({k: v for k, v in unidos.items() if k in segredos}),
                           json.dumps({k: v for k, v in unidos.items() if k in parametros}), 'candidato', base, autor, time.time()))
            self.auditar(c, autor, 'candidato', provedor, ambiente, versao)
            return r.lastrowid

    def obter_candidato(self, identificador, autor):
        with self.abrir() as c:
            r = c.execute("SELECT * FROM integracoes_config WHERE id=? AND autor=? AND estado='candidato'", (identificador, autor)).fetchone()
            if not r:
                raise Conflito('Candidato inexistente ou já utilizado.')
            return dict(r)

    def registrar_teste(self, r, autor, aprovado, mensagem):
        with self.abrir() as c:
            recente = c.execute('SELECT MAX(criado_em) FROM integracoes_testes WHERE autor=?', (autor,)).fetchone()[0]
            if recente and time.time() - recente < 1:
                raise Conflito('Aguarde um segundo antes de testar novamente.')
            identificador = secrets.token_urlsafe(24)
            c.execute('INSERT INTO integracoes_testes VALUES(?,?,?,?,?,?)', (identificador, r['id'], autor, time.time(), int(aprovado), mensagem))
            self.auditar(c, autor, 'teste', r['provedor'], r['ambiente'], r['versao'], 'aprovado' if aprovado else 'falhou')
            return identificador

    def ativar(self, identificador, teste, autor, confirmar_producao=False):
        falha = None
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            r = c.execute('SELECT * FROM integracoes_config WHERE id=? AND autor=?', (identificador, autor)).fetchone()
            t = c.execute('SELECT * FROM integracoes_testes WHERE id=? AND config_id=? AND autor=?', (teste, identificador, autor)).fetchone()
            atual = c.execute("SELECT versao FROM integracoes_config WHERE provedor=? AND ambiente=? AND estado='ativo'", (r['provedor'], r['ambiente'])).fetchone() if r else None
            if not r or r['estado'] != 'candidato' or not t or not t['aprovado'] or time.time()-t['criado_em'] > 600:
                falha = 'Teste aprovado ausente, expirado ou candidato já utilizado.'
            elif r['base'] != (atual['versao'] if atual else 0):
                falha = 'A configuração mudou. Crie e teste um novo candidato.'
            elif r['provedor'] == 'asaas' and r['ambiente'] == 'producao' and confirmar_producao is not True:
                falha = 'Confirme explicitamente o ambiente de produção.'
            if falha:
                self.auditar(c, autor, 'ativacao_recusada', r['provedor'] if r else 'desconhecido', r['ambiente'] if r else 'padrao', resultado='recusada')
            else:
                c.execute("UPDATE integracoes_config SET estado='substituido' WHERE provedor=? AND ambiente=? AND estado='ativo'", (r['provedor'], r['ambiente']))
                c.execute("UPDATE integracoes_config SET estado='ativo' WHERE id=?", (identificador,))
                self.auditar(c, autor, 'ativacao', r['provedor'], r['ambiente'], r['versao'])
        if falha:
            raise Conflito(falha)

    def catalogo(self):
        result = []
        with self.abrir() as c:
            for p, (escopo, segredos, _) in PROVEDORES.items():
                for a in (('sandbox', 'producao') if p == 'asaas' else ('padrao',)):
                    r = c.execute("SELECT * FROM integracoes_config WHERE provedor=? AND ambiente=? AND estado='ativo'", (p, a)).fetchone()
                    ultimo = c.execute('SELECT * FROM integracoes_auditoria WHERE provedor=? AND ambiente=? ORDER BY id DESC LIMIT 1', (p, a)).fetchone()
                    teste = c.execute('SELECT * FROM integracoes_testes WHERE config_id=? ORDER BY criado_em DESC LIMIT 1', (r['id'],)).fetchone() if r else None
                    result.append({'provedor': p, 'ambiente': a, 'escopo': escopo,
                                   'versao': r['versao'] if r else 0, 'estado': 'ativo' if r else 'nao_configurado',
                                   'parametros': json.loads(r['parametros']) if r else {},
                                   'segredos': {k: '••••••••' for k in segredos if r and k in self.decifrar(r['segredo'])},
                                   'ultima_acao': dict(ultimo) if ultimo else None})
                    result[-1]['testado_em'] = teste['criado_em'] if teste and teste['aprovado'] else None
        return result

    def historico(self):
        with self.abrir() as c:
            return [dict(r) for r in c.execute('SELECT * FROM integracoes_auditoria ORDER BY id DESC LIMIT 100')]

    def desativar(self, provedor, ambiente, base, autor):
        self.validar(provedor, ambiente)
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            r = c.execute("SELECT * FROM integracoes_config WHERE provedor=? AND ambiente=? AND estado='ativo'", (provedor, ambiente)).fetchone()
            if not r or r['versao'] != base:
                raise Conflito('A configuração mudou. Recarregue antes de desativar.')
            c.execute("UPDATE integracoes_config SET estado='desativado' WHERE id=?", (r['id'],))
            self.auditar(c, autor, 'desativacao', provedor, ambiente, base)

    def rotacionar(self, autor):
        """Reencripta com a chave primária já instalada externamente pelo operador."""
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            for r in c.execute('SELECT id,segredo FROM integracoes_config').fetchall():
                c.execute('UPDATE integracoes_config SET segredo=? WHERE id=?', (self.cifra.rotate(r['segredo']), r['id']))
            for r in c.execute('SELECT finalidade,dono,segredo FROM integracoes_google').fetchall():
                c.execute('UPDATE integracoes_google SET segredo=? WHERE finalidade=? AND dono=?', (self.cifra.rotate(r['segredo']), r['finalidade'], r['dono']))
            self.auditar(c, autor, 'rotacao_cifragem', 'cofre', 'padrao')

    def ambiente_asaas(self, novo=None, autor=None):
        with self.abrir() as c:
            if novo is not None:
                self.validar('asaas', novo)
                if not self.ativo('asaas', novo):
                    raise ValueError('Ative e valide a configuração desse ambiente primeiro.')
                aprovado = c.execute("SELECT 1 FROM integracoes_testes t JOIN integracoes_config cfg ON cfg.id=t.config_id WHERE cfg.provedor='asaas' AND cfg.ambiente=? AND cfg.estado='ativo' AND t.aprovado=1", (novo,)).fetchone()
                if not aprovado:
                    raise Conflito('Teste e ative uma nova versão desse ambiente antes de selecioná-lo para cobranças.')
                c.execute("UPDATE integracoes_meta SET valor=? WHERE nome='asaas_ambiente'", (novo,))
                self.auditar(c, autor, 'selecionar_ambiente', 'asaas', novo)
            return c.execute("SELECT valor FROM integracoes_meta WHERE nome='asaas_ambiente'").fetchone()[0]

    def valor(self, nome, padrao=''):
        if nome == 'ASAAS_AMBIENTE':
            return self.ambiente_asaas()
        if nome in ('ASAAS_API_KEY', 'ASAAS_API_KEY_SANDBOX'):
            r = self.ativo('asaas', 'producao' if nome == 'ASAAS_API_KEY' else 'sandbox')
            return (r or {}).get('api_key', padrao)
        if nome in VARIAVEIS:
            p, campo = VARIAVEIS[nome]
            return (self.ativo(p) or {}).get(campo, padrao)
        return os.environ.get(nome, padrao)

    def importar_ambiente(self, env):
        """Uma vez; preserva operação legada sem afirmar que foi testada."""
        with self.abrir() as c:
            if c.execute("SELECT 1 FROM integracoes_meta WHERE nome='importado'").fetchone():
                return
        for p in PROVEDORES:
            for a in (('sandbox', 'producao') if p == 'asaas' else ('padrao',)):
                dados = {campo: env[n] for n, (prov, campo) in VARIAVEIS.items() if prov == p and env.get(n)}
                if p == 'asaas':
                    dados = {'api_key': env.get('ASAAS_API_KEY' if a == 'producao' else 'ASAAS_API_KEY_SANDBOX', '')}
                if any(dados.values()) and not self.ativo(p, a):
                    ident = self.candidato(p, a, dados, 0, 'migracao')
                    with self.abrir() as c:
                        c.execute("UPDATE integracoes_config SET estado='ativo' WHERE id=?", (ident,))
                        self.auditar(c, 'migracao', 'importacao_nao_testada', p, a, 1)
        with self.abrir() as c:
            c.execute("UPDATE integracoes_meta SET valor=? WHERE nome='asaas_ambiente'", ('producao' if env.get('ASAAS_AMBIENTE') == 'producao' else 'sandbox',))
            c.execute("INSERT OR IGNORE INTO integracoes_meta VALUES ('importado','sim')")

    def google(self, finalidade='drive', dono='institucional'):
        return GoogleRegistro(self, finalidade, dono)

    def asaas_cliente(self, cliente_id, ambiente, customer_id=None):
        self.validar('asaas', ambiente)
        with self.abrir() as c:
            if customer_id is not None:
                c.execute('INSERT INTO integracoes_asaas_clientes VALUES(?,?,?) ON CONFLICT(cliente_id,ambiente) DO UPDATE SET customer_id=excluded.customer_id', (cliente_id, ambiente, customer_id))
            r = c.execute('SELECT customer_id FROM integracoes_asaas_clientes WHERE cliente_id=? AND ambiente=?', (cliente_id, ambiente)).fetchone()
            return r[0] if r else None


class GoogleRegistro:
    def __init__(self, cofre, finalidade, dono):
        if finalidade not in ('drive', 'calendar') or not dono or (finalidade == 'drive' and dono != 'institucional'):
            raise ValueError('Proprietário Google inválido.')
        self.cofre, self.finalidade, self.dono = cofre, finalidade, dono
        self.caminho = cofre.caminho

    def obter_conexao(self):
        with self.cofre.abrir() as c:
            r = c.execute('SELECT * FROM integracoes_google WHERE finalidade=? AND dono=?', (self.finalidade, self.dono)).fetchone()
            if r:
                return {**self.cofre.decifrar(r['segredo']), 'conectado_em': r['conectado_em'], 'sync_token_calendar': r['cursor']}

    def salvar_conexao(self, refresh_token, agora, autor=None):
        with self.cofre.abrir() as c:
            c.execute('INSERT INTO integracoes_google(finalidade,dono,segredo,conectado_em) VALUES(?,?,?,?) ON CONFLICT(finalidade,dono) DO UPDATE SET segredo=excluded.segredo, conectado_em=excluded.conectado_em, cursor=NULL',
                      (self.finalidade, self.dono, self.cofre.cifrar({'refresh_token': refresh_token}), agora().isoformat()))
            self.cofre.auditar(c, autor or (self.cofre.ator() if self.finalidade == 'drive' else 'usuario:' + self.dono), 'google_conectado', self.finalidade, 'padrao')

    def desconectar(self):
        with self.cofre.abrir() as c:
            c.execute('DELETE FROM integracoes_google WHERE finalidade=? AND dono=?', (self.finalidade, self.dono))
            self.cofre.auditar(c, self.dono, 'google_desconectado', self.finalidade, 'padrao')

    def salvar_sync_token_calendar(self, token):
        with self.cofre.abrir() as c:
            c.execute('UPDATE integracoes_google SET cursor=? WHERE finalidade=? AND dono=?', (token, self.finalidade, self.dono))


async def testar(provedor, ambiente, dados, cliente, contexto=None):
    """Somente leitura; nunca devolve corpo, URL ou exceção do provedor."""
    contexto = contexto or {}
    try:
        if provedor in ('asaas', 'zapsign', 'datajud'):
            chave = dados.get('api_key')
            if not chave:
                return False, 'Informe a chave da API.'
            if provedor == 'asaas':
                base = 'https://api.asaas.com' if ambiente == 'producao' else 'https://api-sandbox.asaas.com'
                r = await cliente.get(base + '/v3/customers', params={'limit': 1}, headers={'access_token': chave})
            elif provedor == 'zapsign':
                r = await cliente.get('https://api.zapsign.com.br/api/v1/docs/', params={'page': 1}, headers={'Authorization': 'Bearer ' + chave})
            else:
                r = await cliente.post('https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search', json={'size': 0, 'query': {'match_all': {}}}, headers={'Authorization': 'APIKey ' + chave})
            return (True, 'Autenticação de leitura confirmada.') if r.status_code == 200 else (False, 'O provedor recusou a verificação (HTTP %s).' % r.status_code)
        if provedor == 'smtp':
            from email.utils import parseaddr
            if not dados.get('usuario') or not dados.get('senha') or '@' not in parseaddr(dados.get('remetente', ''))[1]:
                return False, 'Informe usuário, senha e remetente válido.'
            await asyncio.wait_for(asyncio.to_thread(_testar_smtp, dados), timeout=20)
            return True, 'Conexão TLS e autenticação SMTP confirmadas. Nenhum e-mail enviado.'
        if provedor == 'recaptcha':
            if not dados.get('site_key') or not dados.get('secret') or not contexto.get('captcha_token'):
                return False, 'Resolva um desafio real com a nova site key para validar o reCAPTCHA.'
            r = await cliente.post('https://www.google.com/recaptcha/api/siteverify', data={'secret': dados['secret'], 'response': contexto['captcha_token']})
            j = r.json()
            ok = r.status_code == 200 and j.get('success') is True and bool(contexto.get('hostname')) and j.get('hostname') == contexto['hostname']
            return ok, 'Desafio real validado.' if ok else 'Desafio inválido ou domínio incompatível.'
        if provedor in ('google_oauth', 'drive'):
            import google_integracao as g
            oauth = dados if provedor == 'google_oauth' else contexto.get('oauth', {})
            conexao = contexto.get('drive')
            if not oauth.get('client_id') or not oauth.get('client_secret') or not conexao:
                return False, 'Autorize a conta Google para validar as credenciais OAuth e o acesso ao Drive.'
            token = await g.obter_access_token(cliente, oauth['client_id'], oauth['client_secret'], conexao['refresh_token'])
            from urllib.parse import quote
            pasta = dados.get('pasta_raiz') or 'root'
            r = await cliente.get('https://www.googleapis.com/drive/v3/files/' + quote(pasta, safe=''), params={'fields': 'id,mimeType,capabilities(canAddChildren)'}, headers={'Authorization': 'Bearer ' + token})
            j = r.json()
            ok = r.status_code == 200 and j.get('mimeType') == 'application/vnd.google-apps.folder' and j.get('capabilities', {}).get('canAddChildren') is True
            return ok, 'Acesso à pasta do Drive confirmado.' if ok else 'Pasta indisponível ou sem permissão de gravação.'
    except Exception:
        return False, 'Não foi possível validar a conexão. Verifique as credenciais, permissões e a rede.'
    return False, 'Serviço não suportado.'


def _testar_smtp(dados):
    host = dados.get('host', '')
    porta = int(dados.get('porta', '587'))
    if not host or porta not in (465, 587):
        raise ValueError('SMTP requer TLS nas portas 465 ou 587.')
    # Resolver e conectar ao IP validado evita DNS rebinding/SSRF; SNI permanece o host.
    ips = [x[4][0] for x in socket.getaddrinfo(host, porta, type=socket.SOCK_STREAM)]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError('Host SMTP precisa ser público.')
    class SMTPPublico(smtplib.SMTP):
        def _get_socket(self, host_ignorado, port, timeout):
            sock = socket.create_connection((ips[0], port), timeout)
            return ssl.create_default_context().wrap_socket(sock, server_hostname=host) if porta == 465 else sock
    with SMTPPublico(host, porta, timeout=15) as smtp:
        smtp.ehlo()
        if porta == 587:
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        smtp.login(dados.get('usuario', ''), dados.get('senha', ''))
