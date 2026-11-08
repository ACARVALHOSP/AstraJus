import asyncio
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import db
import google_integracao
import server


class FakeDrive:
    """Drive simulado: guarda as pastas criadas e permite apagar uma."""
    def __init__(self):
        self.pastas = {}   # id -> (nome, pai)
        self.n = 0

    async def criar(self, http, token, nome, pai=None):
        self.n += 1
        pid = f'p{self.n}'
        self.pastas[pid] = (nome, pai)
        return {'id': pid}

    async def existe(self, http, token, pasta_id):
        return pasta_id in self.pastas


class PastaDriveTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / 'teste.db'
        self.agora = lambda: datetime(2026, 1, 1)
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.cliente = self.gestao.criar_cliente('Maria Silva', None, None, self.agora)
        self.drive = FakeDrive()
        google = mock.Mock()
        google.obter_conexao.return_value = {'refresh_token': 'r'}
        self.mw = server._AutenticacaoBearer(None, db.RegistroUsuarios(self.caminho), gestao=self.gestao,
                                             registro_google=google, google_client_id='i', google_client_secret='s')
        for alvo, falso in (('criar_pasta_drive', self.drive.criar), ('pasta_drive_existe', self.drive.existe),
                            ('obter_access_token', mock.AsyncMock(return_value='t'))):
            p = mock.patch.object(google_integracao, alvo, falso)
            p.start()
            self.addCleanup(p.stop)

    def novo_caso(self, titulo):
        return self.gestao.criar_caso(self.cliente['id'], titulo, None, [], self.agora)

    def test_hierarquia_clientes_cliente_processo(self):
        c1, c2 = self.novo_caso('Ação A'), self.novo_caso('Ação B')
        asyncio.run(self.mw._tentar_pasta_drive(c1))
        asyncio.run(self.mw._tentar_pasta_drive(c2))
        self.assertEqual((c1['pasta_drive'], c2['pasta_drive']), ('criada', 'criada'))
        nomes = {pid: n for pid, (n, _) in self.drive.pastas.items()}
        self.assertEqual(sorted(nomes.values()), ['Ação A', 'Ação B', 'CLIENTES', 'Maria Silva'])  # uma única pasta do cliente
        pai = lambda pid: self.drive.pastas[pid][1]
        pasta_cliente = self.gestao.obter_drive_pasta_cliente(self.cliente['id'])
        self.assertEqual(nomes[pasta_cliente], 'Maria Silva')
        self.assertEqual(nomes[pai(pasta_cliente)], 'CLIENTES')
        self.assertIsNone(pai(pai(pasta_cliente)))  # CLIENTES na raiz configurada (aqui, sem raiz)
        self.assertEqual(pai(c1['drive_pasta_id']), pasta_cliente)
        self.assertEqual(pai(c2['drive_pasta_id']), pasta_cliente)
        self.assertEqual(self.gestao.obter_caso(c1['id'])['drive_pasta_id'], c1['drive_pasta_id'])

    def test_refaz_pasta_apagada_e_falha_nao_derruba(self):
        caso = self.novo_caso('Ação A')
        asyncio.run(self.mw._tentar_pasta_drive(caso))
        del self.drive.pastas[caso['drive_pasta_id']]   # apagada no Drive
        antigo = caso['drive_pasta_id']
        asyncio.run(self.mw._tentar_pasta_drive(self.gestao.obter_caso(caso['id'])))
        novo = self.gestao.obter_caso(caso['id'])['drive_pasta_id']
        self.assertNotEqual(novo, antigo)
        with mock.patch.object(google_integracao, 'criar_pasta_drive', side_effect=google_integracao.ErroGoogle('x')):
            outro = self.novo_caso('Ação C')
            asyncio.run(self.mw._tentar_pasta_drive(outro))
        self.assertEqual(outro['pasta_drive'], 'falhou')

    def test_sem_google(self):
        self.mw.registro_google.obter_conexao.return_value = None
        caso = self.novo_caso('Ação A')
        asyncio.run(self.mw._tentar_pasta_drive(caso))
        self.assertEqual(caso['pasta_drive'], 'nao_configurado')


if __name__ == '__main__':
    unittest.main()
