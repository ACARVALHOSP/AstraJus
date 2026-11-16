"""Rotas administrativas de integrações; segredos nunca retornam ao navegador."""
import json
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs

import integracoes
import google_integracao


async def tratar(app, scope, receive, send):
    from sys import modules
    s = modules[app.__class__.__module__]
    path, method = scope['path'], scope['method']
    cofre = app.integracoes
    if path == '/admin/integracoes' and method == 'GET':
        await s._responder(send, 200, (Path(__file__).parent / 'static/integracoes.html').read_bytes(), tipo='text/html; charset=utf-8', cabecalhos_extra=[(b'cache-control', b'no-store')])
        return
    if cofre is None:
        await s._json(send, 503, {'erro': 'Configure a chave mestra de integrações no servidor.'})
        return
    if path == '/integracoes/google/callback' and method == 'GET':
        await callback(app, scope, send, s)
        return
    auth = dict(scope.get('headers', [])).get(b'authorization', b'').decode('latin-1')
    token = auth[7:] if auth.startswith('Bearer ') else ''
    usuario = app.registro.identificar(token) if token else None
    registros = app.registro.carregar() if usuario else {}
    admin_nomeado = bool(usuario and (registros.get(usuario, {}).get('administrador_integracoes') is True or registros.get(usuario, {}).get('nivel_acesso') == 'administrador'))
    if usuario and registros[usuario].get('nivel_acesso') == 'consulta':
        admin_nomeado = False
    from usuarios_admin import validar_token_admin
    bootstrap = validar_token_admin(app.registro, token)
    if not (admin_nomeado or bootstrap):
        if app.falhas:
            app.falhas.verificar('integracoes:' + s._ip_cliente(scope))
        await s._json(send, 403, {'erro': 'Acesso restrito a administradores.'})
        return
    if app.falhas:
        ocupado, espera, _ = app.falhas.ocupado('integracoes:' + s._ip_cliente(scope))
        if ocupado:
            await s._json(send, 429, {'erro': 'Muitas tentativas. Aguarde para tentar novamente.'})
            return
    autor = 'usuario:' + usuario if admin_nomeado else cofre.ator()
    try:
        if path == '/admin/integracoes/api' and method == 'GET':
            await s._json(send, 200, {'integracoes': cofre.catalogo(), 'historico': cofre.historico(), 'asaas_ambiente': cofre.ambiente_asaas(), 'drive_conectado': bool(cofre.google().obter_conexao()), 'ator': autor, 'pode_gerir_administradores': bootstrap})
            return
        if method != 'POST':
            await s._json(send, 405, {'erro': 'Método não permitido.'})
            return
        raw = await s._ler_corpo(receive)
        if raw is None:
            await s._json(send, 413, {'erro': 'Corpo da requisição grande demais.'})
            return
        dados = json.loads(raw)
        if not isinstance(dados, dict):
            raise ValueError('Informe um objeto JSON.')
        if path in ('/admin/integracoes/testar', '/admin/integracoes/ativar') and (type(dados.get('candidato')) is not int or dados['candidato'] < 1):
            raise ValueError('Informe um candidato válido.')
        if path == '/admin/integracoes/ativar' and not isinstance(dados.get('teste'), str):
            raise ValueError('Informe o teste de conexão.')
        if path == '/admin/integracoes/candidato':
            ident = cofre.candidato(dados.get('provedor'), dados.get('ambiente'), dados.get('dados'), dados.get('base'), autor)
            await s._json(send, 201, {'candidato': ident})
        elif path == '/admin/integracoes/testar':
            r = cofre.obter_candidato(dados.get('candidato'), autor)
            key = ('teste', autor)
            if app._integracoes_limites.get(key, 0) > time.time():
                await s._json(send, 429, {'erro': 'Aguarde antes de testar novamente.'})
                return
            app._integracoes_limites[key] = time.time() + 3
            contexto = {'oauth': cofre.ativo('google_oauth') or {}, 'drive': cofre.google().obter_conexao(),
                        'hostname': s.urlsplit(s._base_publica(scope)).hostname, 'captcha_token': dados.get('captcha_token')}
            pendente = app._integracoes_google_candidatos.get(r['id'])
            if pendente and pendente[1] > time.time():
                contexto['drive'] = cofre.decifrar(pendente[0])
            async with s._cliente(20, follow_redirects=False) as client:
                ok, mensagem = await integracoes.testar(r['provedor'], r['ambiente'], cofre.dados(r), client, contexto)
            teste = cofre.registrar_teste(r, autor, ok, mensagem)
            await s._json(send, 200, {'aprovado': ok, 'mensagem': mensagem, 'teste': teste})
        elif path == '/admin/integracoes/ativar':
            r = cofre.obter_candidato(dados.get('candidato'), autor)
            cofre.ativar(r['id'], dados.get('teste'), autor, dados.get('confirmar_producao'))
            pendente = app._integracoes_google_candidatos.pop(r['id'], None)
            if r['provedor'] == 'google_oauth' and pendente:
                cofre.google().salvar_conexao(cofre.decifrar(pendente[0])['refresh_token'], lambda: datetime.now(timezone.utc), autor=autor)
            await s._json(send, 200, {'ativado': True})
        elif path == '/admin/integracoes/ambiente':
            novo = dados.get('ambiente')
            if novo == 'producao' and dados.get('confirmar_producao') is not True:
                raise ValueError('Confirme o uso do Asaas em produção.')
            cofre.ambiente_asaas(novo, autor)
            await s._json(send, 200, {'ambiente': novo})
        elif path == '/admin/integracoes/desativar':
            if dados.get('confirmar') is not True:
                raise ValueError('Confirme a desativação.')
            cofre.desativar(dados.get('provedor'), dados.get('ambiente'), dados.get('base'), autor)
            await s._json(send, 200, {'desativado': True})
        elif path == '/admin/integracoes/rotacionar':
            if not bootstrap or dados.get('confirmar') is not True:
                await s._json(send, 403, {'erro': 'Use o acesso de recuperação e confirme a rotação.'})
                return
            cofre.rotacionar(autor)
            await s._json(send, 200, {'rotacionado': True})
        elif path == '/admin/integracoes/google':
            candidato = dados.get('candidato')
            config = None
            if candidato:
                r = cofre.obter_candidato(candidato, autor)
                if r['provedor'] != 'google_oauth':
                    raise ValueError('Selecione as credenciais OAuth Google.')
                config = cofre.dados(r)
            await iniciar_google(app, scope, send, s, 'drive', 'institucional', config, candidato, autor=autor)
        elif path == '/admin/integracoes/google/desconectar':
            cofre.google().desconectar()
            await s._json(send, 200, {'desconectado': True})
        elif path == '/admin/integracoes/administrador':
            if not bootstrap:
                await s._json(send, 403, {'erro': 'Use o acesso administrativo de recuperação para alterar administradores.'})
                return
            nome = dados.get('nome')
            if not isinstance(nome, str) or type(dados.get('habilitado')) is not bool:
                raise ValueError('Usuário e permissão obrigatórios.')
            def alterar(usuarios):
                if nome not in usuarios or usuarios[nome].get('revogado'):
                    raise ValueError('Usuário ativo não encontrado.')
                usuarios[nome]['administrador_integracoes'] = dados['habilitado']
            app.registro.atualizar(alterar)
            with cofre.abrir() as c:
                cofre.auditar(c, autor, 'permissao_administrativa', 'acesso', 'padrao', resultado='habilitado' if dados['habilitado'] else 'revogado')
            await s._json(send, 200, {'atualizado': True})
        else:
            await s._json(send, 404, {'erro': 'Rota inexistente.'})
    except integracoes.Conflito as erro:
        await s._json(send, 409, {'erro': str(erro)})
    except (ValueError, TypeError, KeyError) as erro:
        s.log.warning('Integrações %s %s recusada: %s: %s', method, path, type(erro).__name__, str(erro)[:300])
        # Os ValueError levantados por este módulo trazem mensagens próprias, em português e sem dados sensíveis.
        # Outros erros (JSON malformado, chave ausente etc.) mantêm a mensagem genérica.
        texto = str(erro) if type(erro) is ValueError and str(erro) else 'Configuração inválida. Revise os campos e a versão.'
        await s._json(send, 400, {'erro': texto})


async def iniciar_google(app, scope, send, s, finalidade, dono, config=None, candidato=None, autor=None):
    config = config or app.integracoes.ativo('google_oauth') or {}
    if not config.get('client_id') or not config.get('client_secret'):
        raise ValueError('Configure a aplicação OAuth Google primeiro.')
    if not integracoes.client_id_google_valido(config['client_id']):
        raise ValueError('O Client ID do Google deve terminar em .apps.googleusercontent.com. Confira se o navegador não preencheu o campo sozinho.')
    app._google_fluxos = {k: v for k, v in app._google_fluxos.items() if v['expira'] > time.time()}
    if len(app._google_fluxos) >= 100:
        raise ValueError('Muitas conexões pendentes. Aguarde.')
    state = secrets.token_urlsafe(32)
    app._google_fluxos[state] = {'finalidade': finalidade, 'dono': dono, 'autor': autor or 'usuario:' + dono, 'config': app.integracoes.cifrar(config), 'candidato': candidato, 'expira': time.time()+600}
    redirect = s._base_publica(scope) + '/integracoes/google/callback'
    escopos = ['https://www.googleapis.com/auth/drive.file'] if finalidade == 'drive' else ['https://www.googleapis.com/auth/calendar']
    url = google_integracao.url_autorizacao(config['client_id'], redirect, state, escopos=escopos)
    await s._json(send, 200, {'url': url})


async def callback(app, scope, send, s):
    query = parse_qs(scope.get('query_string', b'').decode('latin-1'))
    fluxo = app._google_fluxos.pop(query.get('state', [''])[0], None)
    if not fluxo or fluxo['expira'] < time.time() or not query.get('code'):
        await s._responder(send, 400, b'Autorizacao invalida ou expirada. Inicie a conexao novamente.')
        return
    if fluxo['finalidade'] == 'calendar' and fluxo['dono'] not in app.registro.ativos():
        await s._responder(send, 403, b'Usuario sem acesso ativo.')
        return
    etapa = 'preparação'
    try:
        cfg = app.integracoes.decifrar(fluxo['config'])
        async with s._cliente(20) as client:
            etapa = 'troca do código por token'
            dados = await google_integracao.trocar_codigo_por_token(client, cfg['client_id'], cfg['client_secret'], s._base_publica(scope)+'/integracoes/google/callback', query['code'][0])
            etapa = 'renovação do access token'
            token = await google_integracao.obter_access_token(client, cfg['client_id'], cfg['client_secret'], dados['refresh_token'])
            if fluxo['finalidade'] == 'calendar':
                etapa = 'verificação do Google Agenda'
                await google_integracao.calendario_principal(client, token)
            else:
                etapa = 'verificação do Google Drive'
                # about.get funciona com o escopo drive.file; files/root devolve 404 (o app só vê o que criou).
                r = await client.get('https://www.googleapis.com/drive/v3/about', params={'fields': 'user(emailAddress)'}, headers={'Authorization': 'Bearer '+token})
                if r.status_code != 200:
                    raise google_integracao.ErroGoogle('Falha ao consultar o Drive (HTTP %s): %s' % (r.status_code, r.text[:300]))
        if fluxo['candidato']:
            app._integracoes_google_candidatos[fluxo['candidato']] = (app.integracoes.cifrar({'refresh_token': dados['refresh_token']}), time.time()+600)
        else:
            app.integracoes.google(fluxo['finalidade'], fluxo['dono']).salvar_conexao(dados['refresh_token'], lambda: datetime.now(timezone.utc), autor=fluxo['autor'])
        if fluxo['finalidade'] == 'calendar':
            destino, orientacao = '/radix/', 'Abra Meu perfil (menu da conta) e clique em Verificar conexão para confirmar a sua agenda.'
        else:
            destino, orientacao = '/radix/#/administracao?aba=integracoes', 'Volte a Administração › Integrações para testar e ativar a configuração.'
        pagina = ('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                  '<title>Google conectado</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">'
                  '<h1 style="font-size:1.25rem">Autorização recebida</h1><p>' + orientacao + '</p>'
                  '<p><a href="' + destino + '">Voltar ao AstraJus</a></p></body></html>')
        await s._responder(send, 200, pagina.encode('utf-8'), tipo='text/html; charset=utf-8')
    except Exception as erro:
        # Registra só o tipo e a mensagem (sem código, token ou segredo) para diagnosticar a falha.
        s.log.warning('Callback Google (%s) falhou na etapa "%s": %s: %s', fluxo.get('finalidade'), etapa, type(erro).__name__, str(erro)[:300])
        # Na tela, só a etapa e o código curto do Google (ex.: invalid_client), nunca o corpo da resposta.
        codigo = re.search(r'"(?:error|status)"\s*:\s*"([A-Za-z_]{3,40})"', str(erro))
        http = re.search(r'HTTP (\d{3})', str(erro))
        detalhe = ' Etapa: %s.' % etapa + (' HTTP %s.' % http.group(1) if http else '') + (' Código do Google: %s.' % codigo.group(1) if codigo else '')
        await s._responder(send, 502, ('Nao foi possivel concluir a autorizacao Google. Tente conectar novamente.' + detalhe).encode('utf-8'), tipo='text/plain; charset=utf-8')
