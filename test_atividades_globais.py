"""Listagem global de atividades (GET /atividades) usada pela tela Atividades."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

import db
import server
from test_publicacoes_filtros import _chamar_asgi


class AtividadesGlobaisTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.gestao = db.RegistroClientesCasos(self.tmp / "teste.db")
        agora = lambda: datetime(2026, 11, 7, 8, tzinfo=timezone.utc)
        cliente = self.gestao.criar_cliente("Maria Teste", None, None, agora)
        self.c1 = self.gestao.criar_caso(cliente["id"], "Ação de Obrigação de Fazer", "ana", ["10012345620268260100"], agora)
        self.c2 = self.gestao.criar_caso(cliente["id"], "Execução de Título", "carlos", ["10056789020268260100"], agora)
        criar = self.gestao.criar_atividade
        self.a_prazo = criar(self.c1["id"], "prazo", "Réplica à contestação", "2026-11-04", None, None, agora, responsavel="ana")
        self.a_aud = criar(self.c2["id"], "audiencia", "Audiência de instrução", "2026-11-10", "09:30", None, agora, responsavel="carlos")
        self.a_sem = criar(self.c2["id"], "tarefa", "Solicitar certidão", None, None, None, agora)
        self.a_fim = criar(self.c1["id"], "tarefa", "Tarefa antiga", "2026-10-01", None, None, agora, responsavel="ana")
        self.gestao.atualizar_atividade(self.c1["id"], self.a_fim["id"], status="concluida")

    def titulos(self, **kw):
        return [a["titulo"] for a in self.gestao.listar_atividades_globais(**kw)]

    def test_abertas_por_data_com_sem_data_no_fim_e_dados_do_processo(self):
        itens = self.gestao.listar_atividades_globais()
        self.assertEqual([a["titulo"] for a in itens], ["Réplica à contestação", "Audiência de instrução", "Solicitar certidão"])
        self.assertEqual(itens[0]["caso"], {"id": self.c1["id"], "titulo": "Ação de Obrigação de Fazer",
                                            "responsavel": "ana", "processos": ["10012345620268260100"]})
        self.assertEqual(self.titulos(situacao="concluidas"), ["Tarefa antiga"])

    def test_periodo_de_ate(self):
        self.assertEqual(self.titulos(situacao="todas", de="2026-11-01", ate="2026-11-30"),
                         ["Réplica à contestação", "Audiência de instrução"])
        self.assertEqual(self.titulos(situacao="todas", de="2026-11-05"), ["Audiência de instrução", "Solicitar certidão"][:1])
        self.assertEqual(self.titulos(situacao="todas", ate="2026-10-31"), ["Tarefa antiga"])

    def test_filtros(self):
        self.assertEqual(self.titulos(tipo="audiencia"), ["Audiência de instrução"])
        self.assertEqual(self.titulos(responsavel="ana"), ["Réplica à contestação"])
        self.assertEqual(self.titulos(sem_responsavel=True), ["Solicitar certidão"])
        self.assertEqual(self.titulos(responsavel_processo="carlos"), ["Audiência de instrução", "Solicitar certidão"])
        self.assertEqual(self.titulos(busca="execução"), ["Audiência de instrução", "Solicitar certidão"])
        self.assertEqual(self.titulos(busca="1001234-56"), ["Réplica à contestação"])
        self.assertEqual(self.titulos(busca="100%"), [])

    def test_todas_com_checklist(self):
        agora = lambda: datetime(2026, 11, 7, 8, tzinfo=timezone.utc)
        item = self.gestao.criar_item_checklist(self.c1["id"], self.a_prazo["id"], "Juntar documentos", agora)
        self.gestao.criar_item_checklist(self.c1["id"], self.a_prazo["id"], "Revisar", agora)
        self.gestao.atualizar_item_checklist(self.c1["id"], self.a_prazo["id"], item["id"], concluido=True)
        todas = self.gestao.listar_atividades_globais(situacao="todas")
        self.assertEqual(len(todas), 4)
        por_titulo = {a["titulo"]: a for a in todas}
        self.assertEqual(por_titulo["Réplica à contestação"]["checklist"], {"total": 2, "concluidos": 1})
        self.assertIsNone(por_titulo["Audiência de instrução"]["checklist"])
        self.assertEqual(por_titulo["Tarefa antiga"]["status"], "concluida")

    def test_endpoint(self):
        registro = server.RegistroUsuarios(self.tmp / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        token = saida.getvalue().strip().splitlines()[-1]
        mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao)
        auth = [(b"authorization", ("Bearer " + token).encode())]
        status, corpo = _chamar_asgi(mw, "GET", "/atividades?tipo=prazo", headers=auth)
        self.assertEqual(status, 200)
        dados = json.loads(corpo)
        self.assertEqual([a["titulo"] for a in dados["atividades"]], ["Réplica à contestação"])
        self.assertIsNone(dados["atividades"][0]["agenda"])
        status, corpo = _chamar_asgi(mw, "GET", "/atividades?responsavel=__sem__", headers=auth)
        self.assertEqual([a["titulo"] for a in json.loads(corpo)["atividades"]], ["Solicitar certidão"])
        self.assertEqual(_chamar_asgi(mw, "GET", "/atividades?situacao=xyz", headers=auth)[0], 400)
        self.assertEqual(_chamar_asgi(mw, "GET", "/atividades?tipo=xyz", headers=auth)[0], 400)


if __name__ == "__main__":
    unittest.main()
