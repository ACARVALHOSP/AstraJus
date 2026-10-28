"""Regressões de segurança, migração e ativação das integrações (sem rede)."""
from contextlib import closing
import asyncio
import json
import io
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from cryptography.fernet import Fernet

import db
import integracoes as i
import server
import agenda_atividades


class CofreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'test.db'
        self.chave = Fernet.generate_key()
        self.c = i.Cofre(self.path, self.chave)
        self.ator = self.c.ator()

    def candidato(self, secret='chave-secreta-teste', base=0, ambiente='sandbox'):
        return self.c.candidato('asaas', ambiente, {'api_key': secret}, base, self.ator)

    def aprovar_teste(self, ident, aprovado=True):
        r = self.c.obter_candidato(ident, self.ator)
        with patch('integracoes.time.time', return_value=time.time()+5):
            return self.c.registrar_teste(r, self.ator, aprovado, 'Resultado sanitizado.')

    def test_segredo_cifrado_e_mascara(self):
        ident = self.candidato()
        self.c.ativar(ident, self.aprovar_teste(ident), self.ator)
        self.assertNotIn(b'chave-secreta-teste', self.path.read_bytes())
        self.assertNotIn('chave-secreta-teste', json.dumps(self.c.catalogo()))
        self.assertNotIn('chave-secreta-teste', json.dumps(self.c.historico()))
        self.assertEqual(self.c.ativo('asaas', 'sandbox')['api_key'], 'chave-secreta-teste')

    def test_teste_falho_ou_ausente_nao_ativa(self):
        ident = self.candidato()
        for teste in ('inexistente', self.aprovar_teste(ident, False)):
            with self.assertRaises(i.Conflito):
                self.c.ativar(ident, teste, self.ator)
        self.assertIsNone(self.c.ativo('asaas', 'sandbox'))
        self.assertTrue(any(h['acao']=='ativacao_recusada' for h in self.c.historico()))

    def test_teste_expirado(self):
        ident = self.candidato()
        teste = self.aprovar_teste(ident)
        with self.c.abrir() as c:
            c.execute('UPDATE integracoes_testes SET criado_em=?', (time.time()-601,))
        with self.assertRaises(i.Conflito):
            self.c.ativar(ident, teste, self.ator)

    def test_concorrencia_preserva_versao_ativa(self):
        a,b=self.candidato('primeira'),self.candidato('segunda')
        ta=self.aprovar_teste(a)
        with self.c.abrir() as c:
            c.execute('DELETE FROM integracoes_testes WHERE config_id=?', (b,))
        with patch('integracoes.time.time', return_value=time.time()+10):
            tb=self.aprovar_teste(b)
        self.c.ativar(a,ta,self.ator)
        with self.assertRaises(i.Conflito):
            self.c.ativar(b,tb,self.ator)
        self.assertEqual('primeira',self.c.ativo('asaas','sandbox')['api_key'])

    def test_nao_reutiliza_teste_em_outro_candidato(self):
        a,b=self.candidato(),self.candidato()
        with self.assertRaises(i.Conflito):
            self.c.ativar(b,self.aprovar_teste(a),self.ator)

    def test_producao_confirma_e_ambientes_independentes(self):
        ident=self.candidato('producao',ambiente='producao');teste=self.aprovar_teste(ident)
        with self.assertRaises(i.Conflito):
            self.c.ativar(ident,teste,self.ator)
        self.c.ativar(ident,teste,self.ator,True)
        self.assertIsNone(self.c.ativo('asaas','sandbox'))
        self.assertEqual('sandbox',self.c.ambiente_asaas())
        self.c.ambiente_asaas('producao',self.ator)
        self.assertEqual('producao',self.c.valor('ASAAS_AMBIENTE'))

    def test_migracao_idempotente_e_backup_restauravel(self):
        self.c.importar_ambiente({'ASAAS_API_KEY_SANDBOX':'migrada'})
        self.c.importar_ambiente({'ASAAS_API_KEY_SANDBOX':'outra'})
        self.assertEqual('migrada',self.c.valor('ASAAS_API_KEY_SANDBOX'))
        backup=Path(self.tmp.name)/'backup.db'
        with closing(sqlite3.connect(self.path)) as origem, closing(sqlite3.connect(backup)) as destino:
            origem.backup(destino)
        restaurado=i.Cofre(backup,self.chave)
        self.assertEqual('migrada',restaurado.valor('ASAAS_API_KEY_SANDBOX'))
        with self.assertRaises(ValueError):
            i.Cofre(backup,Fernet.generate_key()).ativo('asaas','sandbox')

    def test_inicializacao_migra_google_e_cria_backup_cifrado_restauravel(self):
        from datetime import datetime,timezone
        legado=db.RegistroIntegracaoGoogle(self.path)
        legado.salvar_conexao('refresh-legado-confidencial',lambda:datetime.now(timezone.utc))
        env={'CNJ_MCP_USUARIOS':str(Path(self.tmp.name)/'usuarios.json'),
             'CNJ_MCP_BANCO':'test.db','CNJ_INTEGRACOES_CHAVE':self.chave.decode(),
             'ASAAS_API_KEY_SANDBOX':'chave-importada'}
        with patch.dict('os.environ',env,clear=True), patch('sys.argv',['server.py','--listar-usuarios']), patch.object(server,'_COFRE_INTEGRACOES',None), patch('sys.stdout',new=io.StringIO()):
            self.assertEqual(0,server._principal())
        self.assertIsNone(legado.obter_conexao())
        self.assertEqual('refresh-legado-confidencial',self.c.google().obter_conexao()['refresh_token'])
        self.assertNotIn(b'refresh-legado-confidencial',self.path.read_bytes())
        backups=list((Path(self.tmp.name)/'backups-integracoes').glob('*.fernet'))
        self.assertTrue(backups)
        snapshot=Fernet(self.chave).decrypt(backups[-1].read_bytes())
        restaurado=Path(self.tmp.name)/'restaurado.db'
        restaurado.write_bytes(snapshot)
        with closing(sqlite3.connect(restaurado)) as c:
            self.assertEqual('ok',c.execute('PRAGMA integrity_check').fetchone()[0])
        self.assertEqual('refresh-legado-confidencial',db.RegistroIntegracaoGoogle(restaurado).obter_conexao()['refresh_token'])

    def test_google_separado_por_finalidade_e_dono(self):
        from datetime import datetime,timezone
        for finalidade,dono,token in [('drive','institucional','drive-secret'),('calendar','ana','ana-secret'),('calendar','bia','bia-secret')]:
            self.c.google(finalidade,dono).salvar_conexao(token,lambda:datetime.now(timezone.utc))
        self.assertEqual('ana-secret',self.c.google('calendar','ana').obter_conexao()['refresh_token'])
        self.c.google('calendar','ana').desconectar()
        self.assertIsNotNone(self.c.google('calendar','bia').obter_conexao())
        self.assertIsNotNone(self.c.google().obter_conexao())
        self.assertNotIn(b'ana-secret',self.path.read_bytes())

    def test_rotacao_usa_nova_primaria_e_preserva_leitura(self):
        self.c.importar_ambiente({'ASAAS_API_KEY_SANDBOX':'migrada'})
        nova=Fernet.generate_key()
        rotacao=i.Cofre(self.path,nova,[self.chave])
        rotacao.rotacionar(self.ator)
        self.assertEqual('migrada',i.Cofre(self.path,nova).valor('ASAAS_API_KEY_SANDBOX'))
        with self.assertRaises(ValueError):
            i.Cofre(self.path,self.chave).valor('ASAAS_API_KEY_SANDBOX')

    def test_desativacao_exige_versao_e_nao_retorna_ao_env(self):
        self.c.importar_ambiente({'ASAAS_API_KEY_SANDBOX':'migrada'})
        with self.assertRaises(i.Conflito):
            self.c.desativar('asaas','sandbox',99,self.ator)
        self.c.desativar('asaas','sandbox',1,self.ator)
        with patch.dict('os.environ',{'ASAAS_API_KEY_SANDBOX':'nao-reutilizar'}):
            self.assertEqual('',self.c.valor('ASAAS_API_KEY_SANDBOX'))

    def test_clientes_asaas_nao_cruzam_ambientes(self):
        self.c.asaas_cliente('cliente-local','sandbox','cus_sandbox')
        self.assertIsNone(self.c.asaas_cliente('cliente-local','producao'))
        self.c.asaas_cliente('cliente-local','producao','cus_producao')
        self.assertEqual('cus_sandbox',self.c.asaas_cliente('cliente-local','sandbox'))

    def test_nao_reenvia_senha_mascarada_a_outro_servidor_smtp(self):
        self.c.importar_ambiente({'CNJ_SMTP_HOST':'smtp.original.test','CNJ_SMTP_USUARIO':'conta','CNJ_SMTP_SENHA':'senha-preservada'})
        with self.assertRaises(i.Conflito):
            self.c.candidato('smtp','padrao',{'host':'smtp.outro.test','senha':''},1,self.ator)
        self.assertEqual('senha-preservada',self.c.ativo('smtp')['senha'])

    def test_teste_zapsign_leitura_sem_retorno_sensivel(self):
        chamadas=[]
        def responder(req):
            chamadas.append(req)
            return httpx.Response(200,json={'results':[{'token':'segredo-documento'}]})
        async def rodar():
            async with httpx.AsyncClient(transport=httpx.MockTransport(responder)) as client:
                return await i.testar('zapsign','padrao',{'api_key':'token-api'},client)
        ok,msg=asyncio.run(rodar())
        self.assertTrue(ok);self.assertNotIn('segredo',msg)
        self.assertEqual('GET',chamadas[0].method)
        self.assertEqual('Bearer token-api',chamadas[0].headers['Authorization'])

    def test_recaptcha_nao_confunde_formato_com_validacao(self):
        async def rodar():
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'success':True,'hostname':'errado'}))) as client:
                return await i.testar('recaptcha','padrao',{'site_key':'site','secret':'secret'},client,{'captcha_token':'t','hostname':'correto'})
        self.assertFalse(asyncio.run(rodar())[0])

    def test_autorizacao_http_e_identidade_individual(self):
        registro=db.RegistroUsuarios(self.path)
        from _util import _hash_token
        registro.salvar({'ana':{'hash':_hash_token('ana-token')},'admin':{'hash':_hash_token('admin-token'),'administrador_integracoes':True}})
        async def downstream(scope,receive,send):
            await server._json(send,404,{})
        with patch.object(server,'_COFRE_INTEGRACOES',self.c):
            app=server._AutenticacaoBearer(downstream,registro,admin_token='bootstrap-token')
        async def rodar():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='https://exemplo.test') as client:
                for token in ('','ana-token','invalido'):
                    r=await client.get('/admin/integracoes/api',headers={'Authorization':'Bearer '+token})
                    self.assertEqual(403,r.status_code)
                r=await client.get('/admin/integracoes/api',headers={'Authorization':'Bearer admin-token'})
                self.assertEqual(200,r.status_code)
                self.assertEqual('usuario:admin',r.json()['ator'])
                r=await client.post('/admin/integracoes/candidato',headers={'Authorization':'Bearer admin-token'},json={'provedor':'zapsign','ambiente':'padrao','base':0,'dados':{'api_key':'secret'}})
                self.assertEqual(201,r.status_code)
                self.assertEqual('usuario:admin',self.c.historico()[0]['autor'])
        asyncio.run(rodar())


class CalendarIndividualTest(unittest.TestCase):
    def preparar(self):
        from test_agenda_atividades import AgendaAtividadesTest
        fixture=AgendaAtividadesTest()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        cofre=i.Cofre(fixture.caminho,Fernet.generate_key())
        cofre.importar_ambiente({'CNJ_GOOGLE_CLIENT_ID':'client','CNJ_GOOGLE_CLIENT_SECRET':'secret'})
        cofre.google('calendar','ana').salvar_conexao('token-ana',fixture.agora)
        fixture.mw.integracoes=cofre
        return fixture,cofre

    def test_outro_usuario_nao_le_nem_cancela_vinculo_pessoal(self):
        f,c=self.preparar()
        v=f.criar()
        _,_,token_bia=server._criar_usuario_core(f.registro,'bia')
        c.google('calendar','bia').salvar_conexao('token-bia',f.agora)
        f.token=token_bia
        status,_=f.chamar('GET')
        self.assertEqual(403,status)
        status,_=f.chamar('DELETE',{'vinculo_id':v['id'],'versao':v['versao']})
        self.assertEqual(403,status)
        status,dados=f.chamar('GET',rota=f"/casos/{f.caso['id']}/atividades")
        self.assertEqual(200,status)
        self.assertIsNone(dados['atividades'][0]['agenda'])
        self.assertNotIn('token-ana',json.dumps(dados))

    def test_reconciliacao_preserva_id_remoto(self):
        f,c=self.preparar()
        # Simular vínculo institucional existente, ainda sem dono pessoal.
        f.mw.integracoes=None
        v=f.criar()
        anterior=f.repo.obter(f.caso['id'],f.atv['id'])
        f.mw.integracoes=c
        status,dados=f.chamar('POST',{'reconciliar_institucional':True})
        self.assertEqual(200,status,dados)
        atual=f.repo.obter(f.caso['id'],f.atv['id'])
        self.assertEqual(anterior['evento_id'],atual['evento_id'])
        self.assertEqual('ana',atual['usuario'])

    def test_reconciliacao_recusa_conta_diferente(self):
        f,c=self.preparar()
        f.mw.integracoes=None
        f.criar()
        f.mw.integracoes=c
        f.calendario='outra-conta@teste'
        status,_=f.chamar('POST',{'reconciliar_institucional':True})
        self.assertEqual(409,status)
        self.assertIsNone(f.repo.obter(f.caso['id'],f.atv['id'])['usuario'])


if __name__=='__main__':
    unittest.main()
