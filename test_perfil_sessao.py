import asyncio
import tempfile
import unittest
from pathlib import Path
import httpx
import db
import server
import usuarios_admin

class PerfilSessaoTest(unittest.TestCase):
    def test_perfil_individual_autenticado_sem_segredos(self):
        async def verificar():
            with tempfile.TemporaryDirectory() as pasta:
                registro = db.RegistroUsuarios(Path(pasta) / 'teste.db')
                ana = usuarios_admin.alterar(registro, {'login': 'ana', 'nome_completo': 'Ana Exemplo', 'email': 'ana@example.org', 'nivel_acesso': 'consulta'}, 'bootstrap')
                usuarios_admin.alterar(registro, {'login': 'bia', 'nome_completo': 'Bia Privada', 'email': 'bia@example.org'}, 'bootstrap')
                async def destino(scope, receive, send):
                    await server._json(send, 404, {})
                app = server._AutenticacaoBearer(destino, registro)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as c:
                    for token in ('', 'invalido'):
                        r = await c.get('/responsaveis/me', headers={'Authorization': 'Bearer '+token})
                        self.assertEqual(r.status_code, 401)
                    r = await c.get('/responsaveis/me', headers={'Authorization': 'Bearer '+ana['token']})
                    self.assertEqual(r.status_code, 200)
                    self.assertEqual(r.headers['cache-control'], 'no-store')
                    self.assertEqual(r.json(), {'usuario': {'login': 'ana', 'nome_completo': 'Ana Exemplo', 'nivel_acesso': 'consulta'}})
                    usuarios_admin.alterar(registro, {'status': 'bloqueado'}, 'bootstrap', 'ana')
                    self.assertEqual((await c.get('/responsaveis/me', headers={'Authorization': 'Bearer '+ana['token']})).status_code, 401)
        asyncio.run(verificar())

if __name__ == '__main__':
    unittest.main()
