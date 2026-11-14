import asyncio
import unittest
from unittest.mock import AsyncMock, patch
import server
import test_unit

class FontesHttpTest(test_unit.CapaProcessoHttpTest):
    def test_djen_preenche_capa_sem_apagar_campos_anteriores(self):
        self.gestao.salvar_capa_processo(self.caso['id'], self.numero, self.agora,
            tribunal='TJSP', classe='Classe antiga', grau='G1', nivel_sigilo=0,
            data_distribuicao='2023-01-01', assuntos=['Assunto anterior'],
            movimentos=[{'codigo': 1}], valor_causa=150)
        r={'instancias': [], 'capa_djen': {'tribunal': 'TJSP', 'classe': 'Classe DJEN', 'orgao_julgador': 'Vara DJEN'},
           'partes': [{'nome': 'Autor', 'polo': 'A'}], 'advogados': []}
        with patch.object(server, 'consultar_processo_unificado', AsyncMock(return_value=r)):
            status, capa=self._chamar('POST','atualizar',{'tribunal':'tjsp'})
        self.assertEqual(status,200)
        self.assertEqual(capa['tribunal'],'TJSP')
        self.assertEqual(capa['classe'],'Classe DJEN')
        self.assertEqual(capa['orgao_julgador'],'Vara DJEN')
        self.assertEqual(capa['grau'],'G1')
        self.assertEqual(capa['nivel_sigilo'],0)
        self.assertEqual(capa['data_distribuicao'],'2023-01-01')
        self.assertEqual(capa['movimentos'],[{'codigo':1}])
        self.assertEqual(capa['assuntos'],['Assunto anterior'])
        self.assertEqual(capa['valor_causa'],150)
        self.assertIn('não encontrado no DataJud',capa['aviso'])

    def test_sem_dados_nas_duas_fontes_nao_salva_capa(self):
        with patch.object(server,'consultar_processo_unificado',AsyncMock(return_value={'instancias':[],'partes':[],'advogados':[]})):
            status,r=self._chamar('POST','atualizar',{'tribunal':'tjsp'})
        self.assertEqual(status,502)
        self.assertTrue(r['erro'])
        self.assertIsNone(self.gestao.obter_capa_processo(self.caso['id'],self.numero))

    def test_datajud_tem_precedencia_e_sigilo_zero(self):
        r={'instancias':[{'tribunal':'TJSP','classe':'Classe DataJud','orgaoJulgador':'Vara DataJud','nivelSigilo':0}],
           'capa_djen':{'tribunal':'OUTRO','classe':'Classe DJEN','orgao_julgador':'Vara DJEN'}}
        with patch.object(server,'consultar_processo_unificado',AsyncMock(return_value=r)):
            status,capa=self._chamar('POST','atualizar',{'tribunal':'tjsp'})
        self.assertEqual(status,200)
        self.assertEqual((capa['tribunal'],capa['classe'],capa['orgao_julgador'],capa['nivel_sigilo']),('TJSP','Classe DataJud','Vara DataJud',0))
        self.assertNotIn('aviso',capa)

class ExtracaoDjenTest(unittest.TestCase):
    def test_campos_da_publicacao_mais_recente_que_os_informa(self):
        djen={'itens':[
            {'data_disponibilizacao':'2026-10-01','siglaTribunal':'TRT2','nomeOrgao':'Vara antiga','nomeClasse':'Classe antiga'},
            {'data_disponibilizacao':'2026-10-25','siglaTribunal':'TRT2','nomeOrgao':'Vara atual','nomeClasse':'Classe atual'},
            {'data_disponibilizacao':'2026-10-29','nomeOrgao':''}]}
        with patch.object(server,'consultar_processo_datajud',AsyncMock(return_value={'encontrado':False})), patch.object(server,'consultar_publicacoes_djen',AsyncMock(return_value=djen)):
            r=asyncio.run(server.consultar_processo_unificado('trt2','10018401920265020072'))
        self.assertEqual(r['capa_djen'],{'tribunal':'TRT2','orgao_julgador':'Vara atual','classe':'Classe atual'})

if __name__=='__main__':
    unittest.main()


class CapaVariasInstanciasTest(unittest.TestCase):
    """O mesmo processo costuma ter 1º e 2º grau no DataJud, cada um informando campos diferentes."""

    def test_junta_assuntos_municipio_e_sigilo_das_instancias(self):
        import server
        g2 = {'grau': 'G2', 'assuntos': ['Indenização por Dano Moral'], 'nivelSigilo': 0, 'orgaoJulgador': '2ª Câmara'}
        g1 = {'grau': 'G1', 'assuntos': ['Tutela de Urgência', 'Indenização por Dano Moral'], 'nivelSigilo': 1,
              'codigoMunicipioIBGE': 3550308, 'orgaoJulgador': '2ª Vara Cível'}
        for ordem in ([g2, g1], [g1, g2]):
            c = server._dados_comuns_das_instancias(ordem)
            self.assertEqual(c['principal']['grau'], 'G2')  # a instância mais avançada
            self.assertEqual(c['assuntos'], ['Indenização por Dano Moral', 'Tutela de Urgência'])  # sem repetir
            self.assertEqual(c['codigo_municipio'], '3550308')  # só o 1º grau informa o município
            self.assertEqual(c['nivel_sigilo'], 1)  # o maior
        vazio = server._dados_comuns_das_instancias([{'grau': 'G1'}])
        self.assertEqual((vazio['assuntos'], vazio['codigo_municipio'], vazio['nivel_sigilo']), ([], '', None))


class CapaCompletadaPeloSnapshotTest(unittest.TestCase):
    def test_preenche_vazios_com_o_snapshot_do_datajud(self):
        import server
        bruto = {'grau': 'G1', 'nivelSigilo': 0, 'assuntos': [{'codigo': 1, 'nome': 'Verbas rescisórias'}],
                 'orgaoJulgador': {'nome': '72ª Vara', 'codigoMunicipioIBGE': 3550308}}
        capa = server._completar_capa_com_datajud({'assuntos': [], 'nivel_sigilo': None, 'cidade': None, 'uf': None, 'datajud': [bruto]})
        self.assertEqual((capa['assuntos'], capa['nivel_sigilo'], capa['cidade'], capa['uf']), (['Verbas rescisórias'], 0, 'São Paulo', 'SP'))
        manual = server._completar_capa_com_datajud({'assuntos': ['X'], 'nivel_sigilo': 1, 'cidade': 'Outra', 'uf': 'RJ', 'datajud': [bruto]})
        self.assertEqual((manual['assuntos'], manual['nivel_sigilo'], manual['cidade']), (['X'], 1, 'Outra'))


class DjenDebugTest(unittest.TestCase):
    """GET /debug/djen/<numero>: devolve o JSON bruto do DJEN, sem transformar."""

    def _rodar(self, numero, query='', resposta=None):
        import server
        enviados = []

        async def json_(send, status, corpo):
            enviados.append((status, corpo))
        with patch.object(server, '_json', json_), patch.object(server, '_djen_get_com_retry', AsyncMock(return_value=resposta)) as chamada:
            asyncio.run(server._djen_debug_http(None, numero, query))
        return enviados[0], chamada

    def test_devolve_o_json_bruto_com_a_requisicao(self):
        bruto = {'status': 'success', 'count': 1, 'items': [{'id': 7, 'nomeClasse': 'Execução', 'codigoClasse': '159'}]}
        resp = type('R', (), {'status_code': 200, 'json': lambda self: bruto, 'text': ''})()
        (status, corpo), chamada = self._rodar('4016431-60.2026.8.26.0477', 'pagina=2&itens=5', resp)
        self.assertEqual(status, 200)
        self.assertEqual(corpo['djen_bruto'], bruto)
        self.assertEqual(chamada.call_args.kwargs['params'], {'numeroProcesso': '40164316020268260477', 'pagina': 2, 'itensPorPagina': 5})

    def test_numero_invalido_e_geobloqueio(self):
        (status, _), _ = self._rodar('123')
        self.assertEqual(status, 400)
        (status, corpo), _ = self._rodar('40164316020268260477', '', {'erro': 'HTTP 403 da API do DJEN'})
        self.assertEqual((status, corpo['erro']), (502, 'HTTP 403 da API do DJEN'))
