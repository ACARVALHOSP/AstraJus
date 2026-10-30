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
