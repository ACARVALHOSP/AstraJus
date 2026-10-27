"""I05: outbox transacional, isolamento e estado de leitura; nenhuma rede real."""
import asyncio
import base64
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit, urlencode
import httpx

import db
import notificacoes
import server


class NotificacoesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / 'teste.db'
        self.registro = db.RegistroUsuarios(self.caminho)
        self.tokens = {}
        self.usuarios = {nome: f'{nome}@teste.com' for nome in ('ana', 'bia', 'carla')}
        for nome, usuario in self.usuarios.items():
            _, _, self.tokens[nome] = server._criar_usuario_core(self.registro, usuario)
        self.tempo = datetime.now(timezone.utc)
        self.agora = lambda: self.tempo
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        cliente = self.gestao.criar_cliente('Cliente fictício', None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente['id'], 'Processo fictício', self.usuarios['ana'], [], self.agora)
        self.repo = notificacoes.Repositorio(self.caminho, agora=self.agora)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao, publicacoes=self.publicacoes)

    def chamar(self, usuario='ana', metodo='GET', rota='/notificacoes', dados=None, autenticar=True):
        async def executar():
            mensagens = []
            async def send(m):
                mensagens.append(m)
            async def receive():
                return {'type': 'http.request', 'body': json.dumps(dados).encode() if dados is not None else b'{}', 'more_body': False}
            partes = urlsplit(rota)
            await self.mw({'type': 'http', 'method': metodo, 'path': partes.path, 'query_string': partes.query.encode(),
                'headers': [(b'authorization', f'Bearer {self.tokens[usuario]}'.encode())] if autenticar else []}, receive, send)
            status = next(m['status'] for m in mensagens if m['type'] == 'http.response.start')
            corpo = b''.join(m.get('body', b'') for m in mensagens if m['type'] == 'http.response.body')
            return status, json.loads(corpo) if corpo.startswith(b'{') else corpo
        return asyncio.run(executar())

    def feed(self, usuario='ana', **opcoes):
        return self.repo.listar(self.usuarios[usuario], **opcoes)

    def delegar(self, titulo='Conferir publicação', destino='bia', ator='ana'):
        return self.gestao.criar_atividade(self.caso['id'], 'tarefa', titulo, None, None, None, self.agora,
            responsavel=self.usuarios[destino], ator=self.usuarios[ator])

    def publicar(self, hash='pub-A', usuario='ana', caso=True):
        return self.publicacoes.registrar(hash, 'monitoramento-ficticio', None, None, {'texto': 'INTEIRO TEOR NÃO COPIAR'}, 'nao_tratada',
            self.caso['id'] if caso else None, self.agora, usuario_notificacao=self.usuarios[usuario])

    def test_feed_contagem_leitura_e_destino_isolados_por_usuario(self):
        atividade = self.delegar()
        self.assertEqual(self.chamar('ana')[1]['nao_lidas'], 0)
        self.assertEqual(self.chamar('carla')[1]['notificacoes'], [])
        status, bia = self.chamar('bia')
        self.assertEqual(status, 200)
        self.assertEqual(bia['nao_lidas'], 1)
        item = bia['notificacoes'][0]
        self.assertEqual(item['destino']['atividade_id'], atividade['id'])
        proibida = self.chamar('ana', 'PATCH', f"/notificacoes/{item['id']}", {'lida': True})
        inexistente = self.chamar('ana', 'PATCH', '/notificacoes/999999', {'lida': True})
        self.assertEqual(proibida, inexistente)
        self.assertEqual(proibida[0], 404)
        self.assertEqual(self.chamar('ana', rota=f"/notificacoes/{item['id']}/destino")[0], 404)
        self.assertEqual(self.feed('bia')['nao_lidas'], 1)

    def test_ler_e_idempotente_persistente_e_nao_conclui_trabalho(self):
        atividade = self.delegar()
        item = self.feed('bia')['notificacoes'][0]
        primeiro = self.chamar('bia', 'PATCH', f"/notificacoes/{item['id']}", {'lida': True})
        segundo = self.chamar('bia', 'PATCH', f"/notificacoes/{item['id']}", {'lida': True})
        self.assertEqual(primeiro, segundo)
        self.assertEqual(primeiro[0], 200)
        self.assertEqual(notificacoes.Repositorio(self.caminho).listar(self.usuarios['bia'])['nao_lidas'], 0)
        self.assertEqual(self.gestao.listar_atividades(self.caso['id'])[0]['status'], 'pendente')
        self.assertEqual(self.repo.destino(self.usuarios['bia'], item['id'])['atividade_id'], atividade['id'])
        self.assertEqual(self.feed('bia', estado='nao_lidas')['notificacoes'], [])

    def test_mesma_atribuicao_nao_duplica_retorno_ao_responsavel_gera_nova_ocorrencia(self):
        atividade = self.delegar()
        self.gestao.atualizar_atividade(self.caso['id'], atividade['id'], titulo='Título editado', responsavel=self.usuarios['bia'], ator=self.usuarios['ana'], agora=self.agora)
        self.assertEqual(len(self.feed('bia')['notificacoes']), 1)
        self.gestao.atualizar_atividade(self.caso['id'], atividade['id'], responsavel=self.usuarios['ana'], ator=self.usuarios['ana'], agora=self.agora)
        self.assertEqual(self.feed('ana')['notificacoes'], [])
        self.assertIn('atribuição mudou', self.feed('bia')['notificacoes'][0]['mensagem'])
        self.gestao.atualizar_atividade(self.caso['id'], atividade['id'], responsavel=self.usuarios['bia'], ator=self.usuarios['ana'], agora=self.agora)
        self.assertEqual(len(self.feed('bia')['notificacoes']), 2)

    def test_autoatribuicao_nao_notifica_e_corpo_nao_escolhe_destinatario(self):
        self.delegar(destino='ana', ator='ana')
        self.assertEqual(self.feed('ana')['notificacoes'], [])
        self.assertEqual(self.chamar('ana', 'POST', '/notificacoes', {'usuario': self.usuarios['bia']})[0], 405)

    def test_rollback_da_outbox_tambem_desfaz_mudanca_do_dominio(self):
        with mock.patch.object(db, '_registrar_notificacao', side_effect=OSError('Falha simulada na outbox')):
            with self.assertRaises(OSError):
                self.delegar()
            with self.assertRaises(OSError):
                self.publicar()
        self.assertEqual(self.gestao.listar_atividades(self.caso['id']), [])
        self.assertIsNone(self.publicacoes.obter('pub-A'))

    def test_concorrencia_de_atribuicao_nao_duplica_ocorrencia(self):
        atividade = self.delegar(destino='ana', ator='ana')
        def alterar(_):
            db.RegistroClientesCasos(self.caminho).atualizar_atividade(self.caso['id'], atividade['id'],
                responsavel=self.usuarios['bia'], ator=self.usuarios['ana'], agora=self.agora)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(alterar, range(2)))
        self.assertEqual(self.feed('bia')['nao_lidas'], 1)

    def test_recaptura_e_outbox_repetida_deduplicam_por_destinatario_e_hash(self):
        self.assertTrue(self.publicar())
        self.assertFalse(self.publicar())
        self.assertFalse(self.publicar(usuario='bia'))
        for _ in range(2):
            self.assertEqual(self.feed('ana')['nao_lidas'], 1)
            self.assertEqual(self.feed('bia')['nao_lidas'], 1)
        dados = json.dumps(self.feed('ana'), ensure_ascii=False)
        self.assertNotIn('INTEIRO TEOR', dados)
        self.assertNotIn('pub-A', dados)
        self.assertEqual(self.feed('carla')['notificacoes'], [])

    def test_desvinculacao_remove_item_contagem_leitura_e_acao_sem_perder_dedupe(self):
        self.publicar(caso=False)
        item = self.feed()['notificacoes'][0]
        self.assertEqual(item['destino']['tipo'], 'publicacoes_monitoradas')
        self.publicacoes.vincular_caso('pub-A', self.caso['id'])
        self.assertEqual(self.feed()['notificacoes'][0]['destino']['tipo'], 'publicacoes_processo')
        self.publicacoes.desvincular_do_caso('pub-A', self.caso['id'])
        self.assertEqual(self.feed()['notificacoes'], [])
        self.assertEqual(self.feed()['nao_lidas'], 0)
        self.assertIsNone(self.repo.marcar_lida(self.usuarios['ana'], item['id']))
        self.assertIsNone(self.repo.destino(self.usuarios['ana'], item['id']))
        self.publicacoes.vincular_caso('pub-A', self.caso['id'])
        self.assertEqual(self.feed()['notificacoes'][0]['id'], item['id'])

    def test_evento_sem_destino_fica_pendente_e_nao_materializa_publicacao(self):
        self.repo.registrar_monitoramento(self.usuarios['ana'], [{'hash': 'pub-futura', 'texto': 'Não copiar'}])
        self.assertIsNone(self.publicacoes.obter('pub-futura'))
        self.assertEqual(self.feed()['notificacoes'], [])
        with self.repo.transacao() as c:
            linha = c.execute('SELECT pendencia FROM notificacao_eventos').fetchone()
            self.assertEqual(linha[0], 'destino_indisponivel')
        self.publicar(hash='pub-futura')
        self.assertEqual(self.feed()['nao_lidas'], 1)

    def test_exclusao_e_revogacao_revalidam_visibilidade(self):
        atividade = self.delegar()
        item = self.feed('bia')['notificacoes'][0]
        self.gestao.excluir_atividade(self.caso['id'], atividade['id'])
        self.assertEqual(self.feed('bia')['nao_lidas'], 0)
        self.assertIsNone(self.repo.destino(self.usuarios['bia'], item['id']))
        self.delegar()
        dados = self.registro.carregar()
        dados[self.usuarios['bia']]['revogado'] = True
        self.registro.salvar(dados)
        self.assertEqual(self.feed('bia')['notificacoes'], [])
        self.assertEqual(self.chamar('bia')[0], 401)

    def test_janela_de_180_dias_nao_remove_dedupe_nem_reapresenta_recaptura(self):
        self.publicar()
        self.assertEqual(self.feed()['nao_lidas'], 1)
        self.tempo += timedelta(days=181)
        self.assertEqual(self.feed()['notificacoes'], [])
        self.publicar()
        self.assertEqual(self.feed()['nao_lidas'], 0)
        with self.repo.transacao() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM notificacao_eventos').fetchone()[0], 1)

    def test_cursor_estavel_sem_repeticao_com_chegada_de_evento_novo(self):
        for i in range(5):
            self.delegar(titulo=f'Atividade {i}')
        primeira = self.feed('bia', limite=2)
        ids = [n['id'] for n in primeira['notificacoes']]
        self.tempo += timedelta(seconds=1)
        self.delegar(titulo='Chegou depois')
        cursor = primeira['proximo_cursor']
        while cursor:
            pagina = self.feed('bia', limite=2, cursor=cursor)
            ids.extend(n['id'] for n in pagina['notificacoes'])
            cursor = pagina['proximo_cursor']
        self.assertEqual(len(ids), 5)
        self.assertEqual(len(set(ids)), 5)
        self.assertEqual(self.feed('bia')['nao_lidas'], 6)

    def test_cursor_invalido_foreign_estado_e_limites_sao_recusados(self):
        self.delegar(); self.delegar()
        cursor = self.feed('bia', limite=1)['proximo_cursor']
        for usuario, parametros in [('ana', {'cursor': cursor}), ('bia', {'cursor': cursor, 'estado': 'nao_lidas'}),
            ('bia', {'cursor': 'invalido'}), ('bia', {'limite': 101}), ('bia', {'limite': 0}), ('bia', {'estado': 'outro'})]:
            self.assertEqual(self.chamar(usuario, rota='/notificacoes?' + urlencode(parametros))[0], 400)
        adulterado = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
        adulterado[2] = 10 ** 100
        adulterado = base64.urlsafe_b64encode(json.dumps(adulterado).encode()).decode().rstrip('=')
        self.assertEqual(self.chamar('bia', rota='/notificacoes?cursor=' + adulterado)[0], 400)

    def test_apenas_lida_true_e_aceito_e_abrir_nao_marca_leitura(self):
        self.delegar()
        item = self.feed('bia')['notificacoes'][0]
        for corpo in ({'lida': False}, {'lida': 1}, {'lida': True, 'usuario': self.usuarios['ana']}, []):
            self.assertEqual(self.chamar('bia', 'PATCH', f"/notificacoes/{item['id']}", corpo)[0], 400)
        self.assertEqual(self.chamar('bia', rota=f"/notificacoes/{item['id']}/destino")[0], 200)
        self.assertEqual(self.feed('bia')['nao_lidas'], 1)
        self.assertEqual(self.chamar(autenticar=False)[0], 401)

    def test_falha_smtp_nao_perde_evento_da_delegacao(self):
        cfg = server.ConfiguracaoSMTP('smtp.ficticio', 587, 'u', 's', 'remetente@teste.com')
        self.mw.cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0), server.LimitadorUso(0, 0))
        with mock.patch.object(server, '_enviar_aviso_atividade_delegada', side_effect=OSError('SMTP simulado indisponível')) as envio:
            status, _ = self.chamar('ana', 'POST', f"/casos/{self.caso['id']}/atividades", {'titulo': 'Delegada por API', 'responsavel': self.usuarios['bia']})
        self.assertEqual(status, 201)
        envio.assert_called_once()
        self.assertEqual(self.chamar('bia')[1]['nao_lidas'], 1)

    def test_captura_oab_encaminha_titular_e_captura_manual_nao_notifica(self):
        bruto = {'hash': 'capturada-1', 'numero_processo': '00000000000000000000'}
        with mock.patch.object(server, '_extrair_publicacao_djen', return_value=bruto):
            server._registrar_itens_capturados([bruto], 'mon', None, self.publicacoes, self.gestao, self.agora, usuario_monitoramento=self.usuarios['ana'])
            server._registrar_itens_capturados([bruto], None, None, self.publicacoes, self.gestao, self.agora)
        self.assertEqual(self.feed('ana')['nao_lidas'], 1)
        self.assertEqual(self.feed('bia')['notificacoes'], [])

    def test_verificacao_de_monitoramento_registra_feed_antes_de_falha_smtp(self):
        self.publicacoes.registrar('pub-email', None, None, None, {'texto': 'Texto já disponível'}, 'nao_tratada', self.caso['id'], self.agora)
        registro = db.RegistroMonitoramentos(self.caminho)
        mon = {'usuario': self.usuarios['ana'], 'criterio': {'numero_oab': '123', 'uf_oab': 'SP'}, 'hashes_notificados': [],
               'expira_em': (self.tempo + timedelta(days=180)).isoformat()}
        registro.salvar({'mon-i05': mon})
        enviar = mock.Mock(side_effect=OSError('SMTP simulado indisponível'))
        with mock.patch.object(server, '_djen_get_com_retry', new_callable=mock.AsyncMock,
                               return_value=httpx.Response(200, json={'items': [{}]})), \
             mock.patch.object(server, '_extrair_publicacao_djen', return_value={'hash': 'pub-email'}):
            asyncio.run(server._verificar_um_monitoramento(registro, 'mon-i05', mon, enviar, self.tempo, gestao=self.gestao))
        enviar.assert_called_once()
        self.assertEqual(self.feed('ana')['nao_lidas'], 1)
        self.assertEqual(registro.carregar()['mon-i05']['hashes_notificados'], [])

    def test_job_captura_usa_usuario_do_monitoramento(self):
        registro = db.RegistroMonitoramentos(self.caminho)
        registro.salvar({'mon-i05-bia': {'usuario': self.usuarios['bia'], 'criterio': {'numero_oab': '123', 'uf_oab': 'SP'}}})
        circuito = mock.Mock()
        circuito.pode_tentar.return_value = True
        with mock.patch.object(server, '_CIRCUIT_DJEN', circuito), \
             mock.patch.object(server, '_djen_get_com_retry', new_callable=mock.AsyncMock,
                               return_value=httpx.Response(200, json={'items': [{}]})), \
             mock.patch.object(server, '_extrair_publicacao_djen', return_value={'hash': 'pub-job'}):
            asyncio.run(server._capturar_publicacoes_oab(registro, self.publicacoes, self.gestao, self.agora))
        self.assertEqual(self.feed('bia')['nao_lidas'], 1)
        self.assertEqual(self.feed('ana')['notificacoes'], [])


if __name__ == '__main__':
    unittest.main()
