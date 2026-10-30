"""Regressões offline: cobertura, persistência e falhas independentes por destino."""
import asyncio
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx
import db
import server
from monitoramento_runtime import Repositorio, utc


class MonitoramentoConfiavelTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'teste.db'
        self.registro = db.RegistroMonitoramentos(self.path)
        self.gestao = db.RegistroClientesCasos(self.path)
        self.publicacoes = db.RegistroPublicacoesOAB(self.path)
        self.agora = datetime(2026, 10, 30, 15, tzinfo=timezone.utc)
        self.mon = server._criar_monitoramento(self.registro, 'ana@teste.com', None, None, '123', 'SP', lambda: self.agora)
        self.mid = self.mon['id']
        self.repo = Repositorio(self.path)
        for nome in ('_FALHAS_MONITORAMENTO', '_PROXIMA_TENTATIVA_MONITORAMENTO'):
            p = mock.patch.object(server, nome, {})
            p.start(); self.addCleanup(p.stop)

    def executar(self, itens, enviar=None, total=None):
        async def resposta(url, params):
            tamanho, pagina = params['itensPorPagina'], params['pagina']
            return httpx.Response(200, json={'count': len(itens) if total is None else total,
                'items': itens[(pagina - 1) * tamanho:pagina * tamanho]})
        with mock.patch.object(server, '_djen_get_com_retry', side_effect=resposta):
            return asyncio.run(server._verificar_um_monitoramento(self.registro, self.mid,
                self.registro.carregar()[self.mid], enviar, self.agora, self.gestao))

    def test_pagina_21_e_dedupe_acima_de_50_sobrevivem_reinicio(self):
        itens = [{'hash': f'h{i}'} for i in range(81)]
        enviar = mock.Mock()
        self.assertTrue(self.executar(itens, enviar))
        self.assertEqual(len(enviar.call_args.args[2]), 81)
        self.assertEqual(self.publicacoes.contar(), 81)
        self.assertEqual(self.repo.estado(self.mid + ':djen')['paginas'], 5)
        self.assertEqual(Repositorio(self.path).pendentes(self.mid, 'email'), [])
        self.executar(itens, enviar)
        enviar.assert_called_once()

    def test_smtp_nao_impede_registro_local_e_entrega_e_retentada(self):
        enviar = mock.Mock(side_effect=OSError('SMTP simulado'))
        self.assertFalse(self.executar([{'hash': 'h1'}], enviar))
        self.assertEqual(self.publicacoes.contar(), 1)
        self.assertEqual(len(self.repo.pendentes(self.mid, 'email')), 1)
        self.assertEqual(self.repo.pendentes(self.mid, 'local'), [])
        self.assertGreater(utc(self.registro.carregar()[self.mid]['expira_em']), self.agora)
        enviar_ok = mock.Mock()
        self.executar([], enviar_ok)
        enviar_ok.assert_called_once()
        self.assertEqual(enviar_ok.call_args.args[2][0]['hash'], 'h1')

    def test_sem_smtp_coleta_e_preserva_fila(self):
        self.executar([{'hash': 'sem-smtp'}])
        self.assertEqual(self.publicacoes.contar(), 1)
        self.assertEqual(len(self.repo.pendentes(self.mid, 'email')), 1)

    def test_falha_local_depois_de_email_nao_perde_evento(self):
        enviar = mock.Mock()
        with mock.patch.object(server.notificacoes.Repositorio, 'registrar_monitoramento', side_effect=RuntimeError):
            self.assertFalse(self.executar([{'hash': 'local-falha'}], enviar))
        self.assertEqual(self.repo.pendentes(self.mid, 'email'), [])
        self.assertEqual(len(self.repo.pendentes(self.mid, 'local')), 1)
        self.executar([], enviar)
        self.assertEqual(self.repo.pendentes(self.mid, 'local'), [])
        enviar.assert_called_once()

    def test_pagina_intermediaria_falha_preserva_checkpoint_e_reprocessa(self):
        itens = [{'hash': f'p{i}'} for i in range(21)]
        async def resposta(url, params):
            if params['pagina'] == 2:
                return server._erro('Falha simulada')
            return httpx.Response(200, json={'count': 21, 'items': itens[:20]})
        with mock.patch.object(server, '_djen_get_com_retry', side_effect=resposta):
            asyncio.run(server._verificar_um_monitoramento(self.registro, self.mid, self.mon, None, self.agora, self.gestao))
        self.assertEqual(self.publicacoes.contar(), 20)
        self.assertNotIn('checkpoint', self.repo.estado(self.mid + ':djen'))
        self.repo.marcar(self.mid + ':djen', tentar_apos=0)
        server._PROXIMA_TENTATIVA_MONITORAMENTO.clear()
        self.executar(itens)
        self.assertEqual(self.publicacoes.contar(), 21)
        self.assertEqual(self.repo.estado(self.mid + ':djen')['checkpoint'], self.agora.isoformat())

    def test_captura_manual_101_e_automatica_51(self):
        async def resposta(url, params):
            total = 101 if params['itensPorPagina'] == 100 else 51
            inicio = (params['pagina'] - 1) * params['itensPorPagina']
            return httpx.Response(200, json={'count': total, 'items': [{'hash': f'h{i}'} for i in range(inicio, min(inicio + params['itensPorPagina'], total))]})
        with mock.patch.object(server, '_djen_get_com_retry', side_effect=resposta):
            r, erro = asyncio.run(server._capturar_publicacoes_oab_manual(self.publicacoes, self.gestao,
                {'numero_oab': '123', 'data_inicio': '2026-01-01', 'data_fim': '2026-10-30'}, lambda: self.agora))
            self.assertIsNone(erro)
            self.assertEqual((r['encontradas'], r['paginas']), (101, 2))
            asyncio.run(server._capturar_um_monitoramento_oab(self.mid, self.mon['criterio'], self.publicacoes, self.gestao, lambda: self.agora))
            self.assertEqual(self.repo.estado(self.mid + ':oab')['paginas'], 2)

    def test_criterio_composto_preservado_e_reconciliacao_semanal(self):
        c = {'numero_processo': '10063142720238260005', 'numero_oab': '123', 'uf_oab': 'SP'}
        estado = {'checkpoint': self.agora.isoformat(), 'ultima_reconciliacao': self.agora.isoformat()}
        p = server._parametros_coleta(c, estado, self.agora + timedelta(days=1), 50)
        self.assertEqual(p['numeroProcesso'], c['numero_processo'])
        self.assertEqual(p['dataDisponibilizacaoInicio'], '2026-10-28')
        self.assertNotIn('dataDisponibilizacaoInicio', server._parametros_coleta(c, estado, self.agora + timedelta(days=8), 50))

    def test_hash_ausente_e_pagina_repetida_nao_confirmam_completude(self):
        for resposta in ({'count': 1, 'items': [{}]}, {'count': 2, 'items': [{'hash': 'repetido'}]}):
            with mock.patch.object(server, '_djen_get_com_retry', new_callable=mock.AsyncMock,
                                   return_value=httpx.Response(200, json=resposta)):
                resumo, erro = asyncio.run(server._coletar_paginas_djen({'itensPorPagina': 1}, lambda itens: None))
            self.assertIsNone(resumo)
            self.assertTrue(erro['erro'])

    def test_fusos_mistos_expiram_sem_typeerror(self):
        for expira in ((self.agora - timedelta(days=1)).isoformat(), (self.agora - timedelta(days=1)).replace(tzinfo=None).isoformat()):
            self.repo.remover(self.mid)
            self.registro.atualizar(lambda d: d.update({self.mid: {**self.mon, 'expira_em': expira}}))
            self.executar([])
            self.assertNotIn(self.mid, self.registro.carregar())

    def test_renovar_preserva_id_hashes_e_proprietario(self):
        self.repo.ingerir(self.mid, [{'hash': 'preservado'}], self.agora)
        self.assertTrue(server._renovar_monitoramento(self.registro, 'outro@teste.com', self.mid)['erro'])
        server._renovar_monitoramento(self.registro, 'ana@teste.com', self.mid, self.agora + timedelta(days=10))
        self.assertEqual(len(self.repo.pendentes(self.mid, 'email')), 1)
        self.assertEqual(utc(self.registro.carregar()[self.mid]['expira_em']), self.agora + timedelta(days=190))

    def test_criacao_concorrente_respeita_limite_e_idempotencia(self):
        def criar(n):
            return server._criar_monitoramento(db.RegistroMonitoramentos(self.path), 'ana@teste.com', None, None, str(n), 'SP', lambda: self.agora)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(criar, range(20)))
        self.assertEqual(len(self.registro.carregar()), 5)
        duplicado = criar(123)
        self.assertEqual(duplicado['id'], self.mid)
        self.assertTrue(duplicado['existente'])

    def test_vinculo_nao_trata_e_evento_e_idempotente(self):
        cliente = self.gestao.criar_cliente('Cliente', None, None, lambda: self.agora)
        caso = self.gestao.criar_caso(cliente['id'], 'Processo', None, ['10063142720238260005'], lambda: self.agora)
        item = {'hash': 'evento', 'numeroprocessocommascara': '10063142720238260005'}
        self.executar([item])
        self.assertEqual(self.publicacoes.obter('evento')['status'], 'nao_tratada')
        self.gestao.registrar_evento(item['numeroprocessocommascara'], 'publicacao', server._extrair_publicacao_djen(item), lambda: self.agora)
        self.assertEqual(len(self.gestao.eventos_do_caso(caso['id'])), 1)
        self.publicacoes.marcar_tratada_por_processo(item['numeroprocessocommascara'], caso['id'])
        self.assertEqual(self.publicacoes.obter('evento')['status'], 'nao_tratada')

    def test_revisao_explicita_preserva_autoria_e_data(self):
        self.publicacoes.registrar('revisao', None, None, None, {}, 'nao_tratada', None, lambda: self.agora)
        self.publicacoes.atualizar_status_detalhado(['revisao'], 'tratada', usuario='ana@teste.com')
        with db._abrir(self.path) as c:
            row = c.execute('SELECT usuario,status,acao,criado_em FROM publicacao_revisoes WHERE hash=?', ('revisao',)).fetchone()
        self.assertEqual(row[:3], ('ana@teste.com', 'tratada', 'alteracao_status'))
        self.assertIsNotNone(utc(row[3]).tzinfo)

    def test_login_distinto_do_email_entrega_ao_perfil_sem_mudar_proprietario(self):
        usuarios = db.RegistroUsuarios(self.path)
        usuarios.salvar({'operador': {'email': 'destino@teste.com'}})
        mon = server._criar_monitoramento(self.registro, 'operador', None, None, '456', 'SP', lambda: self.agora)
        self.repo.ingerir(mon['id'], [{'hash': 'perfil-email'}], self.agora)
        enviar = mock.Mock()
        asyncio.run(server._entregar_monitoramento(self.repo, self.registro, mon['id'], mon, self.gestao, enviar, self.agora))
        self.assertEqual(enviar.call_args.args[0], 'destino@teste.com')
        self.assertEqual(self.registro.carregar()[mon['id']]['usuario'], 'operador')
        self.assertEqual(len(self.registro.do_usuario('operador')), 1)
        self.assertEqual(self.registro.do_usuario('destino@teste.com'), {})

    def test_sem_email_preserva_fila_e_reenvia_apos_completar_perfil(self):
        usuarios = db.RegistroUsuarios(self.path)
        usuarios.salvar({'operador': {'email': None}})
        mon = server._criar_monitoramento(self.registro, 'operador', None, None, '456', 'SP', lambda: self.agora)
        self.repo.ingerir(mon['id'], [{'hash': 'sem-perfil-email'}], self.agora)
        enviar = mock.Mock()
        asyncio.run(server._entregar_monitoramento(self.repo, self.registro, mon['id'], mon, self.gestao, enviar, self.agora))
        enviar.assert_not_called()
        self.assertEqual(len(self.repo.pendentes(mon['id'], 'email')), 1)
        self.assertEqual(self.repo.pendentes(mon['id'], 'local'), [])
        self.assertFalse(server._listar_monitoramentos(self.registro, 'operador')['email_destinatario_configurado'])
        usuarios.salvar({'operador': {'email': 'completo@teste.com'}})
        asyncio.run(server._entregar_monitoramento(self.repo, self.registro, mon['id'], mon, self.gestao, enviar, self.agora))
        self.assertEqual(enviar.call_args.args[0], 'completo@teste.com')
        self.assertEqual(self.repo.pendentes(mon['id'], 'email'), [])

    def test_lease_e_historico_impedem_duplicacao_e_retomam_falha(self):
        async def executar():
            chamadas = []
            async def job():
                chamadas.append(1)
                await asyncio.sleep(0.02)
            await asyncio.gather(self.repo.executar('teste', 24, job, []), Repositorio(self.path).executar('teste', 24, job, []))
            await self.repo.executar('teste', 24, job, [])
            self.assertEqual(len(chamadas), 1)
            async def falhar(): return False
            await self.repo.executar('falha', 24, falhar, [])
            await self.repo.executar('falha', 24, job, [])
            self.assertEqual(len(chamadas), 2)
        asyncio.run(executar())
        self.assertEqual(self.repo.historico('teste')[0]['estado'], 'concluida')
        self.assertEqual(len(self.repo.historico('falha')), 2)


if __name__ == '__main__':
    unittest.main()
