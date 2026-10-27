"""UI de lote com SQLite temporário real; nenhuma API externa ou dado de produção."""
import tempfile
import re
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import db
import test_interface as base


class ClientesLoteInterfaceTest(base.InterfaceTest):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.gestao = db.RegistroClientesCasos(Path(self.tmp.name) / "teste.db")
        agora = lambda: datetime.now(timezone.utc)
        self.a = self.gestao.criar_cliente("Álvaro Nunes", None, "Manter", agora, detalhes={"perfil": "contato"})
        self.b = self.gestao.criar_cliente("Beatriz Oliveira", None, None, agora)
        self.falhar_lote = False
        self.confirmacoes = 0
        super().setUp()
        self.connect()
        self.page.locator("#aba-contatos-botao").click()
        self.page.wait_for_selector("[data-selecionar-cliente]")

    def route(self, route):
        req = route.request
        path = urlparse(req.url).path
        if path == "/clientes/acoes-em-massa":
            dados = req.post_data_json
            if dados.get("confirmar"):
                self.confirmacoes += 1
                if self.falhar_lote:
                    return route.fulfill(status=503, json={"mensagem": "Falha simulada. Tente novamente."})
            try:
                return route.fulfill(json=self.gestao.clientes_em_massa(dados))
            except db.ConflitoClientesLote as erro:
                return route.fulfill(status=409, json={"mensagem": str(erro)})
            except ValueError as erro:
                return route.fulfill(status=400, json={"mensagem": str(erro)})
        if path == "/clientes" and req.method == "GET":
            return route.fulfill(json={"clientes": self.gestao.listar_clientes()})
        return super().route(route)

    def selecionar(self):
        campo = self.page.locator("#clientes-selecionar-todos")
        if not campo.is_visible() or self.page.viewport_size["width"] <= 768:
            campo = self.page.locator("#clientes-selecionar-todos-mobile")
        campo.check()

    def revisar(self):
        self.page.locator("#clientes-lote-confirmar").click()
        self.page.wait_for_selector("#clientes-lote-revisao", state="visible")

    def confirmar(self):
        self.page.locator("#clientes-lote-confirmar").click()
        self.page.locator("#modal-clientes-lote").wait_for(state="hidden")

    def test_lote_perfil_previa_confirmacao_e_selecao(self):
        self.page.locator("[data-selecionar-cliente]").first.check()
        self.assertTrue(self.page.locator("#clientes-selecionar-todos").evaluate("el => el.indeterminate"))
        self.selecionar()
        self.page.locator("#clientes-lote-perfil").click()
        self.revisar()
        self.assertIn("1 cliente(s) serão alterados; 1 sem alteração", self.page.locator("#clientes-lote-resumo").inner_text())
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "contato")
        self.confirmar()
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "cliente")
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["observacoes"], "Manter")
        self.assertFalse(self.page.locator("#clientes-lote-barra").is_visible())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "contatos-titulo")
        self.assertEqual(self.confirmacoes, 1)
        self.assertFalse(self.errors)

    def test_lote_aplicar_remover_etiquetas_e_mobile(self):
        self.selecionar()
        self.page.locator("#clientes-lote-etiquetas").click()
        self.page.locator("#clientes-lote-nova").fill("Prioritário")
        self.revisar()
        output = Path(__file__).parent / "output" / "playwright" / "clientes-lote"
        output.mkdir(parents=True, exist_ok=True)
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
            self.page.screenshot(path=str(output / f"etiquetas-{width}.png"), full_page=True)
        self.confirmar()
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["etiquetas"], ["Prioritário"])
        self.selecionar()
        self.page.locator("#clientes-lote-etiquetas").click()
        self.page.locator('cds-radio-button[value="remover_etiquetas"]').get_by_text("Remover etiquetas", exact=True).click()
        self.assertEqual(self.page.locator("#clientes-lote-operacao").input_value(), "remover_etiquetas")
        self.page.locator("#clientes-lote-etiquetas-opcoes input").check()
        self.revisar()
        self.confirmar()
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["etiquetas"], [])
        self.assertFalse(self.errors)

    def test_lote_erro_retentativa_e_cancelamento_teclado(self):
        self.selecionar()
        self.page.locator("#clientes-lote-perfil").click()
        self.page.keyboard.press("Escape")
        self.page.locator("#modal-clientes-lote").wait_for(state="hidden")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "clientes-lote-perfil")
        self.page.locator("#clientes-lote-perfil").click()
        self.revisar()
        self.falhar_lote = True
        self.page.locator("#clientes-lote-confirmar").click()
        self.page.locator("#clientes-lote-resultado").get_by_text("Falha simulada. Tente novamente.", exact=True).wait_for()
        self.assertTrue(self.page.locator("#modal-clientes-lote").is_visible())
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "contato")
        self.falhar_lote = False
        self.confirmar()
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "cliente")
        self.assertFalse(self.errors)

    def test_lote_filtro_limpa_selecao(self):
        self.selecionar()
        self.page.locator("cds-search:has(+ #contatos-busca) input").fill("alvaro")
        self.page.wait_for_function("_clientesSelecionados.size === 0")
        self.assertFalse(self.page.locator("#clientes-lote-barra").is_visible())
        self.assertIn("Seleção", self.page.locator("#clientes-lote-aviso").inner_text())

    def test_lote_conflito_exige_revisao_e_sem_mudanca_desabilita_confirmar(self):
        self.selecionar()
        self.page.locator("#clientes-lote-perfil").click()
        self.revisar()
        pedido = {"ids": [self.a["id"]], "acao": "perfil", "perfil": "cliente"}
        previa = self.gestao.clientes_em_massa(pedido)
        self.gestao.clientes_em_massa({**pedido, "confirmar": True, "esperado": previa["esperado"]})
        self.page.locator("#clientes-lote-confirmar").click()
        self.page.locator("#clientes-lote-resultado").get_by_text(re.compile("Os dados mudaram desde a prévia")).wait_for()
        self.assertTrue(self.page.locator("#modal-clientes-lote").is_visible())
        self.page.locator("#clientes-lote-voltar").click()
        self.revisar()
        self.assertIn("0 cliente(s) serão alterados", self.page.locator("#clientes-lote-resumo").inner_text())
        self.assertTrue(self.page.locator("#clientes-lote-confirmar").is_disabled())
        self.assertFalse(self.errors)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(ClientesLoteInterfaceTest(name) for name in loader.getTestCaseNames(ClientesLoteInterfaceTest) if name.startswith("test_lote_"))
