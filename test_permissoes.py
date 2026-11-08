import asyncio
import tempfile
import unittest
from pathlib import Path
import httpx
import db
import server
import usuarios_admin as u


class PermissoesTest(unittest.TestCase):
    def test_padroes_por_nivel(self):
        self.assertEqual(set(u.permissoes_efetivas({'nivel_acesso': 'operador'}).values()), {'editar'})
        self.assertEqual(set(u.permissoes_efetivas({'nivel_acesso': 'consulta'}).values()), {'ver'})
        # Administrador ignora restrições; consulta nunca ganha edição.
        self.assertEqual(u.permissoes_efetivas({'nivel_acesso': 'administrador', 'permissoes': {'casos': 'nenhum'}})['casos'], 'editar')
        self.assertEqual(u.permissoes_efetivas({'nivel_acesso': 'consulta', 'permissoes': {'casos': 'editar'}})['casos'], 'ver')

    def test_rotas(self):
        financeiro = {'nivel_acesso': 'operador', 'permissoes': {'casos': 'nenhum', 'contatos': 'nenhum', 'atividades': 'nenhum',
                      'publicacoes_oab': 'nenhum', 'pesquisa': 'nenhum', 'pagamentos': 'ver', 'integracoes': 'nenhum'}}
        self.assertIsNone(u.liberar_rota(financeiro, '/lancamentos', 'POST'))
        self.assertIsNone(u.liberar_rota(financeiro, '/casos', 'GET'))  # modais do financeiro listam processos
        self.assertIn('somente consulta', u.liberar_rota(financeiro, '/pagamentos', 'POST'))
        self.assertIn('não tem acesso', u.liberar_rota(financeiro, '/casos', 'POST'))
        self.assertIn('não tem acesso', u.liberar_rota(financeiro, '/mcp', 'POST'))
        self.assertIn('não tem acesso', u.liberar_rota(financeiro, '/integracoes/google', 'GET'))
        for livre in ('/responsaveis/me', '/notificacoes', '/preferencias/favoritos', '/integracoes/status'):
            self.assertIsNone(u.liberar_rota(financeiro, livre, 'GET'))

    def test_validacao_e_api(self):
        async def verificar():
            with tempfile.TemporaryDirectory() as pasta:
                registro = db.RegistroUsuarios(Path(pasta) / 'teste.db')
                with self.assertRaises(ValueError):
                    u.alterar(registro, {'login': 'ana', 'nome_completo': 'Ana', 'email': 'ana@example.org', 'permissoes': {'inexistente': 'ver'}}, 'bootstrap')
                with self.assertRaises(ValueError):
                    u.alterar(registro, {'login': 'ana', 'nome_completo': 'Ana', 'email': 'ana@example.org', 'permissoes': {'casos': 'tudo'}}, 'bootstrap')
                ana = u.alterar(registro, {'login': 'ana', 'nome_completo': 'Ana', 'email': 'ana@example.org',
                                           'permissoes': {'financeiro': 'nenhum', 'pagamentos': 'nenhum'}}, 'bootstrap')
                self.assertEqual(ana['usuario']['permissoes_efetivas']['financeiro'], 'nenhum')
                self.assertEqual(ana['usuario']['permissoes_efetivas']['casos'], 'editar')

                async def destino(scope, receive, send):
                    await server._json(send, 200, {'ok': True})
                app = server._AutenticacaoBearer(destino, registro)
                cab = {'Authorization': 'Bearer ' + ana['token']}
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as c:
                    self.assertEqual((await c.get('/lancamentos', headers=cab)).status_code, 403)
                    self.assertEqual((await c.get('/casos', headers=cab)).status_code, 200)
                    u.alterar(registro, {'permissoes': {}}, 'bootstrap', 'ana')
                    self.assertEqual((await c.get('/lancamentos', headers=cab)).status_code, 200)
        asyncio.run(verificar())


if __name__ == '__main__':
    unittest.main()
