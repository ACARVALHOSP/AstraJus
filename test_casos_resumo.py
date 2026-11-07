"""Resumos por processo na listagem GET /casos (tela Processos)."""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db


class CasosResumoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(caminho)
        self.pubs = db.RegistroPublicacoesOAB(caminho)
        self.agora = lambda: datetime(2026, 11, 7, 8, tzinfo=timezone.utc)
        cliente = self.gestao.criar_cliente("Maria Teste", None, None, self.agora)
        self.numero = "10012345620268260100"
        self.caso = self.gestao.criar_caso(cliente["id"], "Ação de Obrigação de Fazer", "ana", [self.numero], self.agora)
        self.vazio = self.gestao.criar_caso(cliente["id"], "Sem nada", "ana", [], self.agora)

    def resumo(self, caso_id):
        return next(c for c in self.gestao.listar_casos() if c["id"] == caso_id)

    def test_proximo_compromisso_ignora_concluidas_e_sem_data(self):
        criar = self.gestao.criar_atividade
        feita = criar(self.caso["id"], "prazo", "Já feita", "2026-11-01", None, None, self.agora)
        self.gestao.atualizar_atividade(self.caso["id"], feita["id"], status="concluida")
        criar(self.caso["id"], "tarefa", "Sem data", None, None, None, self.agora)
        criar(self.caso["id"], "audiencia", "Audiência", "2026-11-10", "09:30", None, self.agora)
        criar(self.caso["id"], "prazo", "Réplica", "2026-11-04", None, None, self.agora)
        proximo = self.resumo(self.caso["id"])["proximo_compromisso"]
        self.assertEqual((proximo["titulo"], proximo["data"], proximo["tipo"]), ("Réplica", "2026-11-04", "prazo"))
        self.assertIsNone(self.resumo(self.vazio["id"])["proximo_compromisso"])

    def test_publicacoes_a_revisar_e_ultima_movimentacao(self):
        dados = {"data_disponibilizacao": "2026-11-05", "tipoComunicacao": "Intimação", "texto": "x"}
        self.pubs.registrar("h1", None, None, self.numero, dados, "nao_tratada", self.caso["id"], self.agora)
        self.pubs.registrar("h2", None, None, self.numero, dados, "tratada", self.caso["id"], self.agora)
        self.gestao.registrar_evento(self.numero, "publicacao", {**dados, "hash": "h1"}, self.agora)
        resumo = self.resumo(self.caso["id"])
        self.assertEqual(resumo["publicacoes_a_revisar"], 1)
        self.assertEqual(resumo["ultima_movimentacao_data"], "2026-11-05")
        self.assertEqual(resumo["ultima_movimentacao_descricao"], "Publicação: Intimação")

        # Um movimento do DataJud mais recente que a publicação passa a ser a última movimentação.
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, agora=self.agora, movimentos=[
            {"codigo": 1, "nome": "Distribuição", "dataHora": "2026-01-10T10:00:00"},
            {"codigo": 2, "nome": "Conclusos para decisão", "dataHora": "2026-11-06T15:00:00"},
        ])
        resumo = self.resumo(self.caso["id"])
        self.assertEqual(resumo["ultima_movimentacao_descricao"], "Conclusos para decisão")
        self.assertTrue(resumo["ultima_movimentacao_data"].startswith("2026-11-06"))

        vazio = self.resumo(self.vazio["id"])
        self.assertEqual((vazio["publicacoes_a_revisar"], vazio["ultima_movimentacao_data"], vazio["ultima_movimentacao_descricao"]), (0, None, None))

    def test_checklist_por_atividade_e_contagens_das_abas(self):
        criar = self.gestao.criar_atividade
        com = criar(self.caso["id"], "prazo", "Com checklist", "2026-11-04", None, None, self.agora)
        sem = criar(self.caso["id"], "tarefa", "Sem checklist", None, None, None, self.agora)
        feita = criar(self.caso["id"], "tarefa", "Feita", None, None, None, self.agora)
        self.gestao.atualizar_atividade(self.caso["id"], feita["id"], status="concluida")
        i1 = self.gestao.criar_item_checklist(self.caso["id"], com["id"], "Item 1", self.agora)
        self.gestao.criar_item_checklist(self.caso["id"], com["id"], "Item 2", self.agora)
        self.gestao.atualizar_item_checklist(self.caso["id"], com["id"], i1["id"], concluido=True)
        por_id = {a["id"]: a for a in self.gestao.listar_atividades(self.caso["id"])}
        self.assertEqual(por_id[com["id"]]["checklist"], {"total": 2, "concluidos": 1})
        self.assertIsNone(por_id[sem["id"]]["checklist"])
        self.pubs.registrar("h9", None, None, self.numero, {"texto": "x"}, "nao_tratada", self.caso["id"], self.agora)
        self.assertEqual(self.gestao.contagens_caso(self.caso["id"]), {"atividades_abertas": 2, "publicacoes_a_revisar": 1})


if __name__ == "__main__":
    unittest.main()
