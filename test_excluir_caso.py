"""Excluir processo: recusa com mensagem clara quando há lançamentos financeiros ou horas, e limpa o que é derivado."""
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db
import horas
import modelos_prazo
import server
from test_modelos_prazo import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)


class ExcluirCasoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        _, _, self.token = server._criar_usuario_core(self.registro, "ana@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(self.cliente["id"], "Silva x Banco", "ana@teste.com", [], AGORA)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)

    def contar(self, tabela, caso_id=None):
        with sqlite3.connect(self.caminho) as c:
            return c.execute(f"SELECT count(*) FROM {tabela} WHERE caso_id = ?", (caso_id or self.caso["id"],)).fetchone()[0]

    def lancamento(self):
        return self.gestao.criar_lancamento("HONORARIO", "2026-12-01", 100.0, "Honorário", False, self.caso["id"], self.cliente["id"], "ana@teste.com", AGORA)

    def excluir_http(self):
        return chamar(self.mw, "DELETE", f"/casos/{self.caso['id']}", self.token)

    def test_processo_simples_e_com_atividades_continuam_excluindo(self):
        self.gestao.criar_atividade(self.caso["id"], "prazo", "Contestação", "2026-12-01", None, None, AGORA)
        self.assertEqual(self.excluir_http(), (200, {"excluido": True}))
        self.assertIsNone(self.gestao.obter_caso(self.caso["id"]))
        self.assertEqual(self.excluir_http()[0], 404)

    def test_lancamento_financeiro_impede_com_409_e_mensagem_clara(self):
        self.lancamento()
        status, corpo = self.excluir_http()
        self.assertEqual(status, 409)                                   # antes: erro de chave estrangeira virava 500
        self.assertIn("1 lançamento financeiro (em Financeiro)", corpo["mensagem"])
        self.assertIn("Exclua ou mova esses registros", corpo["mensagem"])
        self.assertIsNotNone(self.gestao.obter_caso(self.caso["id"]))   # nada foi apagado
        self.lancamento()
        self.assertIn("2 lançamentos financeiros", self.excluir_http()[1]["mensagem"])

    def test_excluido_o_lancamento_o_processo_pode_ser_excluido(self):
        lanc = self.lancamento()
        self.assertEqual(self.excluir_http()[0], 409)
        self.gestao.excluir_lancamento(lanc["id"])
        self.assertEqual(self.excluir_http()[0], 200)

    def test_horas_lancadas_impedem_e_nao_deixam_horas_orfas(self):
        h = horas.Repositorio(self.caminho)
        lancada = h.criar(caso_id=self.caso["id"], usuario="ana@teste.com", data="2026-11-10", minutos=60, agora=AGORA)
        h.criar(caso_id=self.caso["id"], usuario="ana@teste.com", data="2026-11-11", minutos=30, agora=AGORA)
        status, corpo = self.excluir_http()
        self.assertEqual(status, 409)
        self.assertIn("2 lançamentos de horas (em Horas)", corpo["mensagem"])
        self.assertEqual(self.contar("horas_lancamentos"), 2)
        h.excluir(lancada["id"], "ana@teste.com")
        self.assertIn("1 lançamento de horas (em Horas)", self.excluir_http()[1]["mensagem"])

    def test_mensagem_junta_financeiro_e_horas(self):
        self.lancamento()
        horas.Repositorio(self.caminho).criar(caso_id=self.caso["id"], usuario="ana@teste.com", data="2026-11-10", minutos=60, agora=AGORA)
        mensagem = self.excluir_http()[1]["mensagem"]
        self.assertIn("1 lançamento financeiro (em Financeiro) e 1 lançamento de horas (em Horas)", mensagem)

    def test_cronometro_decisoes_de_modelo_e_ciencia_somem_junto(self):
        h = horas.Repositorio(self.caminho)
        h.iniciar_cronometro("ana@teste.com", self.caso["id"], None, AGORA)
        m = modelos_prazo.Repositorio(self.caminho)
        modelo = m.criar({"criterio": "Cobrança", "prazos": [{"titulo": "Contestação", "dias": 15}]}, "ana@teste.com", AGORA)
        m.reservar(self.caso["id"], modelo["id"], "dispensado", "ana@teste.com", AGORA)
        prazo = self.gestao.criar_atividade(self.caso["id"], "prazo", "Réplica", "2026-12-01", None, None, AGORA)
        self.gestao.confirmar_ciencia(self.caso["id"], prazo["id"], "ana@teste.com", AGORA)
        self.assertEqual((self.contar("horas_cronometro"), self.contar("modelo_prazo_decisoes"), self.contar("atividade_ciencia")), (1, 1, 1))
        self.assertEqual(self.excluir_http()[0], 200)
        self.assertEqual((self.contar("horas_cronometro"), self.contar("modelo_prazo_decisoes"), self.contar("atividade_ciencia")), (0, 0, 0))
        self.assertIsNone(h.cronometro("ana@teste.com"))

    def test_funciona_sem_as_tabelas_de_horas_e_de_modelos(self):
        # instalação que nunca abriu Horas nem Modelos: as tabelas ainda não existem
        self.assertEqual(self.contar("atividade_ciencia"), 0)
        with sqlite3.connect(self.caminho) as c:
            existentes = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn("horas_lancamentos", existentes)
        self.assertEqual(self.excluir_http()[0], 200)

    def test_outro_conflito_de_chave_estrangeira_tambem_vira_409(self):
        from unittest import mock
        with mock.patch.object(self.gestao, "excluir_caso", side_effect=sqlite3.IntegrityError("FOREIGN KEY constraint failed")):
            status, corpo = self.excluir_http()
        self.assertEqual(status, 409)
        self.assertIn("ainda tem registros ligados", corpo["mensagem"])


if __name__ == "__main__":
    unittest.main()
