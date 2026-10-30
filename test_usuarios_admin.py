import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from contextlib import closing

import db
import server
import usuarios_admin as u
import httpx
from _util import _hash_token


class UsuariosTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'teste.db'
        self.reg = db.RegistroUsuarios(self.path)

    def criar(self, login='ana', **campos):
        return u.alterar(self.reg, dict(login=login, nome_completo='Ana Exemplo', email=login+'@example.org', **campos), 'bootstrap')

    def test_migracao_legada_idempotente_sem_datas_inventadas(self):
        with closing(sqlite3.connect(self.path)) as c, c:
            c.execute('CREATE TABLE usuarios (nome TEXT PRIMARY KEY, dados TEXT NOT NULL)')
            c.execute('INSERT INTO usuarios VALUES (?, ?)', ('legado', json.dumps({'hash': _hash_token('antigo'), 'origem': 'cli'})))
        self.assertEqual(self.reg.identificar('antigo'), 'legado')
        r = self.reg.carregar()['legado']
        self.assertIsNone(r['criado_em'])
        self.assertIsNone(r['ultimo_acesso_em'])
        self.assertEqual(r['nivel_acesso'], 'operador')
        self.assertEqual(self.reg.carregar()['legado']['usuario_id'], r['usuario_id'])
        self.reg.atualizar(lambda dados: dados['legado'].update(email='nova@example.org'))
        with db._abrir(self.path) as c:
            self.assertEqual(c.execute('SELECT email FROM usuarios').fetchone()[0], 'nova@example.org')

    def test_criar_editar_status_e_email(self):
        r = self.criar()
        self.assertEqual(self.reg.identificar(r['token']), 'ana')
        self.assertNotIn('hash', r['usuario'])
        for status in ('bloqueado', 'pendente', 'ativo'):
            u.alterar(self.reg, {'status': status}, 'bootstrap', 'ana')
            self.assertEqual(self.reg.identificar(r['token']), 'ana' if status == 'ativo' else None)
        self.criar('bia')
        with self.assertRaises(ValueError):
            u.alterar(self.reg, {'email': 'BIA@example.org'}, 'bootstrap', 'ana')
        for dados in ({'hash': 'x'}, {'nivel_acesso': 'super'}, {'status': 'x'}, {'email': 'errado'}, {'nome_completo': 3}):
            with self.assertRaises(ValueError):
                u.alterar(self.reg, dados, 'bootstrap', 'ana')

    def test_revogar_e_proteger_admin(self):
        self.criar(nivel_acesso='administrador')
        with self.assertRaises(ValueError):
            u.alterar(self.reg, {'nivel_acesso': 'consulta'}, 'usuario:ana', 'ana')
        with self.assertRaises(ValueError):
            u.alterar(self.reg, {'status': 'revogado'}, 'bootstrap', 'ana')
        self.criar('bia', nivel_acesso='administrador')
        u.alterar(self.reg, {'status': 'revogado'}, 'bootstrap', 'ana')
        with self.assertRaises(ValueError):
            u.alterar(self.reg, {'status': 'ativo'}, 'bootstrap', 'ana')
        r = self.reg.carregar()['ana']
        self.assertEqual(r['revogado_por'], 'bootstrap')
        self.assertTrue(r['revogado_em'])

    def test_acesso_e_auditoria_sem_segredos(self):
        criado = self.criar()
        u.registrar_acesso(self.reg, 'ana')
        r = self.reg.carregar()['ana']
        self.assertTrue(r['ultimo_acesso_em'])
        u.registrar_acesso(self.reg, 'ana')
        with db._abrir(self.path) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM usuarios_acessos').fetchone()[0], 1)
            texto = str(c.execute('SELECT * FROM usuarios_auditoria').fetchall())
            self.assertNotIn(criado['token'], texto)
            self.assertNotIn(r['hash'], texto)

    def test_cli_legado_criacao_revogacao(self):
        ok, _, token = server._criar_usuario_core(self.reg, 'legado')
        self.assertTrue(ok)
        self.assertEqual(self.reg.identificar(token), 'legado')
        self.assertTrue(server._revogar_usuario_core(self.reg, 'legado')[0])
        self.assertIsNone(self.reg.identificar(token))
        ok, _, token_novo = server._criar_usuario_core(self.reg, 'legado')
        self.assertTrue(ok)
        self.assertEqual(self.reg.identificar(token_novo), 'legado')

    def test_consulta_mcp(self):
        self.assertTrue(u.mcp_consulta_permitido({'method': 'tools/call', 'params': {'name': 'listar_monitoramentos'}}))
        self.assertFalse(u.mcp_consulta_permitido({'method': 'tools/call', 'params': {'name': 'monitorar_publicacoes'}}))
        self.assertFalse(u.mcp_consulta_permitido([{'method': 'tools/list'}, {'method': 'tools/call', 'params': {'name': 'remover_monitoramento'}}]))

    def test_permissoes_http_mcp_e_oauth(self):
        r = self.criar(nivel_acesso='consulta')
        async def verificar():
            async def destino(scope, receive, send):
                await server._json(send, 200, {'ok': True})
            app = server._AutenticacaoBearer(destino, self.reg)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as c:
                headers = {'Authorization': 'Bearer ' + r['token']}
                self.assertEqual((await c.get('/rota-teste', headers=headers)).status_code, 200)
                self.assertEqual((await c.post('/rota-teste', headers=headers)).status_code, 403)
                for nome, esperado in [('listar_monitoramentos', 200), ('remover_monitoramento', 403), ('monitorar_publicacoes', 403)]:
                    resp = await c.post('/mcp', headers=headers, json={'method': 'tools/call', 'params': {'name': nome}})
                    self.assertEqual(resp.status_code, esperado)
                u.alterar(self.reg, {'status': 'bloqueado'}, 'bootstrap', 'ana')
                self.assertEqual((await c.get('/rota-teste', headers=headers)).status_code, 401)
            oauth = server.ServidorOAuth(self.reg, Path(self.tmp.name) / 'oauth.json')
            oauth._salvar({'clientes': {}, 'codigos': {}, 'tokens': {_hash_token('oauth-token'): {'usuario': 'ana', 'expira_em': oauth._agora()+100}}})
            self.assertIsNone(oauth.identificar('oauth-token'))
        asyncio.run(verificar())

    async def chamar(self, path, token='', method='GET', corpo=None):
        app = SimpleNamespace(registro=self.reg, admin_token='bootstrap-seguro', falhas=None, oauth=None)
        scope = {'path': path, 'method': method, 'headers': [(b'authorization', ('Bearer '+token).encode())], 'client': ('127.0.0.1', 1)}
        eventos = []
        async def send(e): eventos.append(e)
        async def receive(): return {'type': 'http.request', 'body': json.dumps(corpo).encode(), 'more_body': False}
        await u.tratar(app, scope, receive, send, server)
        return eventos[0], eventos[1]['body']

    def test_http_autorizacao_integridade_e_backup(self):
        r = self.criar()
        for token in ('', 'invalido', r['token']):
            status, _ = asyncio.run(self.chamar('/admin/usuarios/api', token))
            self.assertEqual(status['status'], 403)
        status, corpo = asyncio.run(self.chamar('/admin/usuarios/api', 'bootstrap-seguro'))
        self.assertEqual(status['status'], 200)
        self.assertIn((b'cache-control', b'no-store'), status['headers'])
        self.assertNotIn(b'"hash"', corpo)
        status, corpo = asyncio.run(self.chamar('/admin/banco/integridade', 'bootstrap-seguro', 'POST'))
        self.assertTrue(json.loads(corpo)['integro'])
        status, corpo = asyncio.run(self.chamar('/admin/banco/backup', 'bootstrap-seguro', 'POST'))
        self.assertEqual(status['status'], 200)
        copia = Path(self.tmp.name) / 'backup.db'
        copia.write_bytes(corpo)
        with closing(sqlite3.connect(copia)) as c:
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(c.execute('SELECT nome_completo FROM usuarios').fetchone()[0], 'Ana Exemplo')


if __name__ == '__main__':
    unittest.main()
