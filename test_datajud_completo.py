import asyncio
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
import db
import server

NUMERO = '10063142720238260005'
FONTE = dict(tribunal='TJSP', numeroProcesso=NUMERO, dataAjuizamento='2023-01-01T00:00:00Z',
    grau='G1', nivelSigilo=0, formato={'codigo': 1, 'nome': 'Eletrônico'},
    sistema={'codigo': 2, 'nome': 'PJe'}, classe={'codigo': 7, 'nome': 'Procedimento'},
    assuntos=[{'codigo': 123, 'nome': 'Assunto'}],
    orgaoJulgador={'codigo': 42, 'nome': 'Vara', 'codigoMunicipioIBGE': 3550308},
    movimentos=[{'codigo': 26, 'nome': 'Distribuição', 'dataHora': '2023-01-01T00:00:00Z',
        'complementosTabelados': [{'codigo': 1, 'descricao': 'Variável', 'valor': 2, 'nome': 'Complemento'}],
        'orgaoJulgador': {'codigoOrgao': 42, 'nomeOrgao': 'Vara'}}])

class CompletoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'db.sqlite'
        self.g = db.RegistroClientesCasos(self.path)
        self.agora = lambda: datetime(2026, 10, 30)

    def test_extracao_preserva_todos_os_campos_e_compatibilidade(self):
        p = server._extrair_processo_datajud(FONTE)
        self.assertEqual(p['datajud'], FONTE)
        self.assertEqual(p['movimentos'], FONTE['movimentos'])
        self.assertEqual(p['classe'], 'Procedimento')
        self.assertEqual(p['assuntos'], ['Assunto'])

    def test_snapshot_duravel_independe_cache_e_preserva_instancias(self):
        fontes = [FONTE, {**FONTE, 'grau': 'G2'}]
        self.g.salvar_datajud(NUMERO, 'TJSP', fontes)
        self.assertEqual(db.RegistroClientesCasos(self.path).obter_datajud(NUMERO, 'tjsp'), fontes)
        self.g.salvar_datajud(NUMERO, 'tjsp', [FONTE])
        self.assertEqual(self.g.obter_datajud(NUMERO, 'TJSP'), [FONTE])

    def test_capa_migracao_e_candidatos_sem_capa_ou_so_monitorados(self):
        c = self.g.criar_cliente('Cliente', None, None, self.agora)
        caso = self.g.criar_caso(c['id'], 'Processo', None, [NUMERO], self.agora)
        outro = '10063142720238260006'
        db.RegistroMonitoramentos(self.path).salvar({'m': {'criterio': {'numero_processo': outro}}})
        self.assertEqual(set(self.g.processos_datajud_pendentes()), {(NUMERO, None), (outro, None)})
        self.g.salvar_capa_processo(caso['id'], NUMERO, self.agora, tribunal='TJSP', datajud=[FONTE], valor_causa=10)
        capa = self.g.obter_capa_processo(caso['id'], NUMERO)
        self.assertEqual(capa['datajud'], [FONTE])
        self.assertEqual(capa['valor_causa'], 10)

    def test_consulta_nao_reutiliza_cache_incompleto_e_grava_snapshot(self):
        cache = db.CacheDataJud(self.path)
        cache.gravar('tjsp:'+NUMERO, {'encontrado': True, 'processos': [{'classe': 'Antiga'}]})
        resposta = httpx.Response(200, json={'hits': {'total': {'value': 1}, 'hits': [{'_source': FONTE}]}})
        post = AsyncMock(return_value=resposta)
        with patch.object(server, '_CACHE_DATAJUD', cache), patch.object(server, '_datajud_post_com_retry', post):
            resultado = asyncio.run(server.consultar_processo_datajud('tjsp', NUMERO))
        self.assertEqual(resultado['processos'][0]['datajud'], FONTE)
        self.assertTrue(post.call_args.args[2]['_source'])
        self.assertEqual(self.g.obter_datajud(NUMERO, 'tjsp'), [FONTE])

    def test_montagem_preserva_sigilo_zero_e_todas_instancias(self):
        instancias = [server._extrair_processo_datajud(FONTE), server._extrair_processo_datajud({**FONTE, 'grau': 'G2'})]
        with patch.object(server, 'consultar_processo_unificado', AsyncMock(return_value={'instancias': instancias})):
            campos, erro = asyncio.run(server._montar_capa_via_tribunal(NUMERO, 'tjsp'))
        self.assertIsNone(erro)
        self.assertEqual(campos['nivel_sigilo'], 0)
        self.assertEqual(len(campos['datajud']), 2)

    def test_tribunais_por_numero(self):
        for codigo, tribunal in [('07', 'tjdft'), ('25', 'tjse'), ('26', 'tjsp')]:
            self.assertEqual(server._tribunal_do_numero('10063142720238'+codigo+'0005'), tribunal)
        self.assertIsNone(server._tribunal_do_numero('123'))

    def test_monitorado_sem_cadastro_e_falha_preserva_snapshot(self):
        db.RegistroMonitoramentos(self.path).salvar({'m': {'criterio': {'numero_processo': NUMERO}}})
        self.g.salvar_datajud(NUMERO, 'tjsp', [FONTE])
        with patch.object(server, 'consultar_processo_datajud', AsyncMock(return_value={'erro': True})) as consulta:
            asyncio.run(server._atualizar_movimentos_processos(self.g, self.agora))
        consulta.assert_awaited_once_with('tjsp', NUMERO)
        self.assertEqual(self.g.obter_datajud(NUMERO, 'tjsp'), [FONTE])

if __name__ == '__main__':
    unittest.main()
