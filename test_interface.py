"""Regressões do painel, offline: python -m unittest test_interface -v.

Requer Playwright e Chromium instalados. APIs são interceptadas; nenhum token real é usado.
"""
import os
import shutil
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")


class _Arquivos(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@unittest.skipUnless(sync_playwright and CHROMIUM_PATH, "Playwright e Chromium são necessários")
class InterfaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Arquivos, directory=str(Path(__file__).parent)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(executable_path=CHROMIUM_PATH, args=["--no-sandbox"])
        except Exception:
            cls.pw.stop()
            cls.server.shutdown()
            cls.server.server_close()
            raise
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/static/app.html"

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda erro: self.errors.append(str(erro)))
        self.requests = []
        self.fail_save = False
        self.case = {"id": "caso-1", "numero": 1, "titulo": "Caso de teste", "autor": "Autora de teste", "responsavel": "Ana", "processos": []}
        self.contact = {"id": "cliente-1", "nome": "Cliente de teste", "telefones": [{"tipo": "celular", "telefone": "11999999999"}]}
        self.context.route("**/*", self.route)
        self.page.goto(self.url)
        self.page.wait_for_function("typeof abrirCaso === 'function'")

    def route(self, route):
        request = route.request
        from urllib.parse import urlparse
        path = urlparse(request.url).path
        if path.startswith("/static/"):
            return route.continue_()
        self.requests.append((request.method, path))
        if path == "/mcp":
            body = request.post_data_json
            if request.headers.get("authorization") != "Bearer teste-valido":
                return route.fulfill(status=401, json={"mensagem": "Token inválido"})
            if body.get("method") == "notifications/initialized":
                return route.fulfill(status=202, body="")
            return route.fulfill(json={"jsonrpc": "2.0", "id": body.get("id"), "result": {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "teste", "version": "1"}}}, headers={"mcp-session-id": "sessao-teste"})
        if request.method in ("PATCH", "POST"):
            if self.fail_save:
                return route.fulfill(status=500, json={"mensagem": "Falha simulada. Tente salvar novamente."})
            if path == "/casos/caso-1":
                self.case.update(request.post_data_json)
                return route.fulfill(json=self.case)
            if path == "/clientes/cliente-1":
                self.contact.update(request.post_data_json)
                return route.fulfill(json=self.contact)
            if path == "/casos":
                return route.fulfill(json={**self.case, **request.post_data_json})
        data = {"/responsaveis": {"responsaveis": ["Ana", "Título pendente", "Título salvo", "Não perder"]}, "/casos/caso-1": self.case, "/clientes/cliente-1": self.contact,
                "/casos": {"casos": [self.case]}, "/clientes": {"clientes": [self.contact]}}.get(path, {"atividades": [], "publicacoes": [], "casos": [], "vinculos": []})
        route.fulfill(json=data)

    def connect(self):
        self.page.locator("#token").fill("teste-valido")
        self.page.locator("#form-token button[type=submit]").click()
        self.page.wait_for_function("document.getElementById('status-conexao').textContent === 'Conectado'")
        self.assertFalse(self.errors)

    def open_case(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-casos')); await abrirCaso('caso-1'); }")

    def choose(self, value):
        self.page.locator(f"#modal-edicao-pendente [data-escolha-edicao={value}]").click()

    def open_publicacoes_oab(self):
        self.pub_oab_gets = 0
        self.pub_oab_posts = []
        self.pub_oab_fail = False
        self.pub_oab_items = [
            {"hash": "pub-1", "numero_processo": "10006070420255020401", "status": "nao_tratada", "dados": {}},
            {"hash": "pub-2", "numero_processo": "10006070420255020402", "status": "nao_tratada", "dados": {}},
        ]
        def responder(route):
            from urllib.parse import urlparse, parse_qs
            request = route.request
            if request.method == "POST":
                self.pub_oab_posts.append(request.post_data_json)
                if self.pub_oab_fail:
                    return route.fulfill(status=500, json={"mensagem": "Falha de teste"})
                return route.fulfill(json={"ok": True})
            self.pub_oab_gets += 1
            status = parse_qs(urlparse(request.url).query).get("status", [""])[0]
            itens = [p for p in self.pub_oab_items if not status or p["status"] == status]
            return route.fulfill(json={"publicacoes": itens, "total": len(itens)})
        self.context.route("**/publicacoes-oab**", responder)
        self.connect()
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-publicacoes-oab'))")
        self.page.locator("#lista-publicacoes-oab table").wait_for()

    def test_publicacoes_colunas_djen_separadas_capitalizacao_e_persistencia(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]["criado_em"] = "2026-10-23T12:00:00Z"
        self.pub_oab_items[0]["dados"] = {
            "data_disponibilizacao": "2026-10-22", "tipoComunicacao": "INTIMAÇÃO",
            "tipoDocumento": "DESPACHO", "nomeOrgao": "VARA CÍVEL",
            "destinatarios": [{"nome": "MARIA DA SILVA", "polo": "A"}],
            "destinatarioadvogados": [{"nome": "JOÃO DOS SANTOS", "numero_oab": "0123", "uf_oab": "SP"}],
            "texto": "TEXTO DA PUBLICAÇÃO", "meio": "DIÁRIO ELETRÔNICO",
            "link": "https://example.test/AbC", "hash": "aBc123"}
        self.page.evaluate("carregarPublicacoesOab()")
        tabela = self.page.locator(".pub-oab-tabela")
        self.page.get_by_role("columnheader", name="Nome Do Processo", exact=True).wait_for()
        self.assertTrue(self.page.get_by_role("columnheader", name="Divulgado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Capturado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Tipo", exact=True).is_visible())
        self.assertEqual(tabela.locator('tbody tr').first.locator('[data-coluna="nome"]').inner_text(), "Maria Da Silva")
        self.page.locator(".pub-oab-colunas summary").click()
        for rotulo in ("Tipo De Documento", "Advogados", "Número Da Oab", "Texto", "Hash", "Link", "Meio"):
            self.page.locator(".pub-oab-colunas").get_by_label(rotulo, exact=True).check()
        self.page.locator(".pub-oab-colunas summary").press("Escape")
        linha = tabela.locator('tbody tr').first
        self.assertEqual(linha.locator('[data-coluna="advogados"]').inner_text(), "João Dos Santos")
        self.assertEqual(linha.locator('[data-coluna="hash"]').inner_text(), "aBc123")
        self.assertEqual(linha.locator('[data-coluna="link"]').inner_text(), "https://example.test/AbC")
        self.assertEqual(linha.locator('[data-coluna="djen:meio"]').inner_text(), "Diário Eletrônico")
        linha.get_by_role("button", name="Ler Mais", exact=True).click()
        self.page.locator(".pub-oab-colunas summary").click()
        self.page.locator(".pub-oab-colunas").get_by_label("Capturado", exact=True).uncheck()
        self.page.locator(".pub-oab-colunas summary").press("Escape")
        self.assertTrue(tabela.locator("td[colspan]").first.evaluate("el => el.colSpan === el.closest('table').querySelectorAll('thead th:not([hidden])').length"))
        self.page.evaluate("carregarPublicacoesOab()")
        self.page.locator(".pub-oab-tabela").wait_for()
        self.assertFalse(self.page.locator('th[data-coluna="capturado"]').is_visible())
        self.assertTrue(self.page.locator('th[data-coluna="djen:meio"]').is_visible())
        self.assertEqual(self.pub_oab_items[0]["dados"]["destinatarios"][0]["nome"], "MARIA DA SILVA")
        for largura in (1440, 390):
            self.page.set_viewport_size({"width": largura, "height": 900})
            self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
            self.assertEqual(tabela.locator('td[data-coluna="nome"]').first.evaluate("el => getComputedStyle(el).fontSize"), "12px")
            self.page.locator(".pub-oab-colunas summary").click()
            fieldset = self.page.locator(".pub-oab-colunas fieldset")
            self.assertTrue(fieldset.evaluate("el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth"))
            self.page.locator(".pub-oab-colunas summary").press("Escape")
        self.assertFalse(self.errors)

    def test_publicacoes_selecao_parcial_sem_reconsulta_e_sem_perder_foco(self):
        self.open_publicacoes_oab()
        todos = self.page.locator("input[data-publicacoes-todas]")
        linhas = self.page.locator("input[data-publicacao-hash]")
        consultas = self.pub_oab_gets
        linhas.first.check()
        self.assertTrue(todos.evaluate("el => el.indeterminate"))
        self.assertFalse(todos.is_checked())
        todos.focus()
        todos.press("Space")
        self.assertEqual(linhas.evaluate_all("els => els.filter(el => el.checked).length"), 2)
        self.assertTrue(todos.evaluate("el => el === document.activeElement"))
        self.assertFalse(todos.evaluate("el => el.indeterminate"))
        linhas.first.uncheck()
        self.assertTrue(todos.evaluate("el => el.indeterminate"))
        linhas.last.uncheck()
        self.assertFalse(todos.is_checked())
        self.assertFalse(todos.evaluate("el => el.indeterminate"))
        self.assertTrue(self.page.locator("#pub-oab-arquivar").is_disabled())
        self.assertEqual(self.pub_oab_gets, consultas)

    def test_publicacoes_filtro_vazio_desabilita_acoes_e_limpa_selecao(self):
        self.open_publicacoes_oab()
        self.page.locator("input[data-publicacao-hash]").first.check()
        self.assertTrue(self.page.locator("#pub-oab-arquivar").is_enabled())
        self.page.locator("#pub-oab-filtro-status").select_option("arquivada")
        self.page.get_by_text("Nenhuma publicação com este status", exact=True).wait_for()
        self.assertEqual(self.page.locator("#pub-oab-arquivar").count(), 0)
        self.assertEqual(self.page.locator("#pub-oab-marcar-tratada").count(), 0)
        self.page.locator("#pub-oab-filtro-status").select_option("")
        self.page.locator("#lista-publicacoes-oab table").wait_for()
        self.assertEqual(self.page.locator("input[data-publicacao-hash]:checked").count(), 0)

    def test_publicacoes_menu_teclado_e_vinculo_com_rotulo_e_erro(self):
        self.open_publicacoes_oab()
        botao = self.page.locator(".pub-oab-combo .cds--menu-button__trigger").first
        botao.focus()
        botao.press("Enter")
        menu = self.page.locator(".pub-oab-combo-menu:not([hidden])")
        itens = menu.get_by_role("menuitem")
        self.assertTrue(itens.first.evaluate("el => el === document.activeElement"))
        itens.first.press("ArrowDown")
        self.assertTrue(itens.nth(1).evaluate("el => el === document.activeElement"))
        itens.nth(1).press("End")
        self.assertTrue(itens.last.evaluate("el => el === document.activeElement"))
        itens.last.press("Escape")
        self.assertTrue(botao.evaluate("el => el === document.activeElement"))
        self.assertEqual(botao.get_attribute("aria-expanded"), "false")
        botao.press("ArrowUp")
        menu.get_by_role("menuitem").last.press("Home")
        menu.get_by_role("menuitem").first.press("ArrowDown")
        menu.get_by_role("menuitem").nth(1).press("Space")
        select = self.page.get_by_label("Vincular ao processo", exact=True)
        self.assertTrue(select.evaluate("el => el === document.activeElement"))
        form = self.page.locator(".mini-form-caso")
        form.get_by_role("button", name="Vincular", exact=True).click()
        self.assertEqual(select.get_attribute("aria-invalid"), "true")
        self.assertIn("Selecione um processo", form.get_by_role("status").inner_text())
        self.assertTrue(select.evaluate("el => el === document.activeElement"))
        form.get_by_role("button", name="Cancelar", exact=True).click()
        self.assertTrue(botao.evaluate("el => el === document.activeElement"))
        self.assertFalse(self.errors)

    def test_publicacoes_acoes_compactas_menu_e_barra_contextual(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]["dados"]["link"] = "https://example.test/publicacao"
        self.page.evaluate("carregarPublicacoesOab()")
        tabela = self.page.locator(".pub-oab-tabela")
        tabela.wait_for()
        acoes = tabela.locator('tbody tr').first.locator('td[data-label="Ações"]')
        self.assertEqual(acoes.locator('a.cds--link').count(), 1)
        self.assertEqual(acoes.locator('.cds--combo-button__container').count(), 0)
        self.assertEqual(acoes.locator('button.cds--btn--primary').count(), 0)
        self.assertFalse(self.page.locator("#pub-oab-batch").is_visible())
        self.page.locator("input[data-publicacao-hash]").first.check()
        self.assertTrue(self.page.locator("#pub-oab-batch").is_visible())
        self.assertIn("1 Selecionada", self.page.locator("#pub-oab-selecionadas").inner_text())
        self.page.get_by_role("button", name="Cancelar Seleção", exact=True).click()
        self.assertFalse(self.page.locator("#pub-oab-batch").is_visible())
        self.assertTrue(self.page.locator("input[data-publicacoes-todas]").evaluate("el => el === document.activeElement"))
        for largura in (1440, 390):
            self.page.set_viewport_size({"width": largura, "height": 900})
            botao = acoes.locator(".cds--menu-button__trigger")
            botao.click()
            menu = self.page.locator(".pub-oab-combo-menu:popover-open")
            self.assertTrue(menu.is_visible())
            self.assertTrue(menu.evaluate("el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight; }"))
            menu.get_by_role("menuitem").first.press("Escape")
        botao.click()
        self.page.get_by_role("menuitem", name="Cadastrar Processo", exact=True).click()
        self.assertTrue(self.page.locator("#form-caso-publicacao").is_visible())
        self.assertFalse(self.errors)

    def test_publicacoes_status_mantem_toast_apos_recarregar(self):
        self.open_publicacoes_oab()
        self.page.locator("input[data-publicacao-hash]").first.check()
        self.page.locator("#pub-oab-marcar-tratada").click()
        self.page.wait_for_function("!_pubOabAtualizando && !_pubOabCarregando")
        self.assertIn("Status atualizado", self.page.locator("#toast-global").inner_text())
        self.assertIn("1 publicação marcada", self.page.locator("#toast-global").inner_text())
        self.assertEqual(len(self.pub_oab_posts), 1)
        self.assertEqual(self.pub_oab_posts[0]["hashes"], ["pub-1"])
        self.assertTrue(self.page.locator("#pub-oab-marcar-tratada").is_disabled())
        self.assertFalse(self.errors)

    def test_publicacoes_falha_de_status_preserva_selecao_e_permite_repetir(self):
        self.open_publicacoes_oab()
        self.pub_oab_fail = True
        self.page.locator("input[data-publicacao-hash]").first.check()
        self.page.locator("#pub-oab-arquivar").click()
        self.page.wait_for_function("!_pubOabAtualizando")
        self.assertIn("Não foi possível atualizar o status", self.page.locator("#toast-global").inner_text())
        self.assertTrue(self.page.locator("input[data-publicacao-hash]").first.is_checked())
        self.assertTrue(self.page.locator("#pub-oab-arquivar").is_enabled())
        self.assertFalse(self.errors)

    def test_capa_unifica_cadastro_e_atualiza_movimentacoes(self):
        numero = "10006070420255020401"
        self.case["processos"] = [numero]
        self.case["autor"] = ""
        capa = {}
        def responder(route):
            if route.request.method == "POST":
                capa.update({"tribunal": "TRT2", "classe": "Ação trabalhista",
                    "data_distribuicao": "20250102120000", "cidade": "Praia Grande", "uf": "SP",
                    "partes": [{"nome": "Maria", "polo": "A"}],
                    "movimentos": [{"nome": "Distribuído", "codigo": 26, "dataHora": "2025-01-02T12:00:00Z"}]})
            route.fulfill(json=capa)
        self.context.route("**/casos/caso-1/processos/**", responder)
        self.open_case()
        self.assertEqual(self.page.locator("#caso-detalhe-titulo").inner_text(), "Caso de teste")
        self.assertEqual(self.page.locator("#caso-subaba-partes-botao").count(), 0)
        self.assertEqual(self.page.locator("#editar-caso-titulo").count(), 0)
        self.assertTrue(self.page.locator("#lista-capa-processos").is_visible())
        chamadas_antes = len(self.requests)
        self.page.locator("#btn-atualizar-capa").click()
        self.page.wait_for_function("document.getElementById('lista-capa-processos').textContent.includes('02/01/2025')")
        self.assertIn("1000607-04.2025.5.02.0401", self.page.locator("#lista-capa-processos").inner_text())
        self.assertIn("Maria", self.page.locator("#lista-capa-processos").inner_text())
        self.assertEqual(self.page.locator("#form-caso-partes").count(), 0)
        self.assertEqual(self.page.locator("#btn-buscar-partes").count(), 0)
        self.assertFalse(self.page.evaluate("formulariosPendentes().length"))
        self.page.locator("#caso-subaba-movimentacoes-botao").click()
        self.page.wait_for_function("document.getElementById('lista-movimentacoes').textContent.includes('Distribuído')")
        self.assertFalse(any(path == "/mcp" and method == "POST" for method, path in self.requests[chamadas_antes:]))
        self.page.locator("#caso-subaba-cadastro-botao").click()
        for width in (1440, 390):
            self.page.set_viewport_size({"width": width, "height": 1000})
            self.page.wait_for_timeout(350)
            self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
            self.page.screenshot(path=f"/tmp/astrajus-capa-{width}.png", full_page=True)
        self.assertFalse(self.errors)

    def test_capa_no_cadastro_com_mascara_distribuicao_e_ibge(self):
        self.case["processos"] = ["10063142720238260005"]
        self.context.route("**/casos/caso-1/processos/*/capa", lambda route: route.fulfill(json={
            "nome_processo": "Autora x Réu", "classe": "Cobrança", "assuntos": ["Contratos"],
            "orgao_julgador": "3ª Vara Cível", "data_distribuicao": "20230102123456",
            "cidade": "São Paulo", "uf": "SP", "tipo_justica": "Justiça Estadual",
        }))
        self.open_case()
        capa = self.page.locator("#caso-subaba-cadastro #lista-capa-processos")
        self.assertTrue(capa.is_visible())
        for texto in ["1006314-27.2023.8.26.0005", "02/01/2023 12:34:56", "3ª Vara Cível"]:
            self.assertIn(texto, capa.inner_text())
        self.assertIn("São Paulo", capa.inner_text())
        self.assertIn("SP", capa.inner_text())
        self.assertEqual(capa.get_by_label("Valor da causa").get_attribute("step"), "0.01")
        self.page.locator("#caso-subaba-movimentacoes-botao").click()
        self.assertFalse(capa.is_visible())
        self.assertEqual(self.page.locator("#caso-subaba-movimentacoes #lista-capa-processos").count(), 0)
        self.assertFalse(self.errors)

    def test_partes_e_advogados_sao_dados_da_capa_sem_formulario(self):
        self.case["processos"] = ["10063142720238260005"]
        capa = {"partes": [
            {"nome": "Autora DJen", "polo": "A"}, {"nome": "Segunda autora", "polo": "ATIVO"},
            {"nome": "Autora DJen", "polo": "A"}, {"nome": "Réu DJen", "polo": "P"},
            {"nome": "Sem polo"}],
            "advogados": [{"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"},
                          {"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"}]}
        self.context.route("**/casos/caso-1/processos/*/capa", lambda route: route.fulfill(json=capa))
        self.open_case()
        dados = self.page.locator("#lista-capa-processos .capa-card-auto")
        for texto in ["Autora DJen", "Segunda autora", "Réu DJen", "Sem polo", "Ana Silva — OAB 12345/SP"]:
            self.assertIn(texto, dados.inner_text())
        self.assertEqual(dados.inner_text().count("Autora DJen"), 1)
        self.assertEqual(dados.inner_text().count("Ana Silva"), 1)
        self.assertEqual(dados.locator("input, select, textarea, button").count(), 0)
        self.assertEqual(self.page.locator("#form-caso-partes, #editar-caso-autor, #editar-caso-reu, #editar-caso-advogados").count(), 0)
        self.assertEqual(self.page.get_by_role("button", name="Salvar partes").count(), 0)
        self.page.locator("#caso-voltar").click()
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertFalse(any(method == "PATCH" for method, _ in self.requests))
        self.page.evaluate("abrirCaso('caso-1')")
        self.page.wait_for_function("document.getElementById('lista-capa-processos').textContent.includes('Ana Silva')")
        self.assertFalse(self.errors)

    def test_token_invalido_permanece_no_acesso_e_nao_e_lembrado(self):
        self.page.locator("#token").fill("invalido")
        self.page.locator("#lembrar-token").check()
        self.page.locator("#form-token button[type=submit]").click()
        self.page.wait_for_function("document.getElementById('status-conexao').textContent === 'Não conectado'")
        self.assertTrue(self.page.locator("#aba-acesso").is_visible())
        self.assertIn("Token inválido", self.page.locator("#resultado-token").inner_text())
        self.assertEqual(self.page.locator("#token").input_value(), "invalido")
        self.assertIsNone(self.page.evaluate("localStorage.getItem('cnj_token')"))
        self.assertFalse(self.errors)

    def test_token_lembrado_e_revalidado(self):
        self.page.evaluate("localStorage.setItem('cnj_token', 'invalido')")
        self.page.reload()
        self.page.wait_for_function("document.getElementById('status-conexao').textContent === 'Não conectado'")
        self.assertTrue(self.page.locator("#aba-acesso").is_visible())
        self.assertIsNone(self.page.evaluate("localStorage.getItem('cnj_token')"))

    def test_secao_sem_modal_permite_foco_fora_e_restaura_origem(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-casos')); }")
        self.page.locator("#btn-novo-caso").click()
        self.assertEqual(self.page.locator('[aria-modal="true"], [role="dialog"], [role="alertdialog"]').count(), 0)
        self.assertEqual(self.page.locator("#modal-novo-caso").evaluate("el => getComputedStyle(el).position"), "static")
        self.page.locator("#btn-novo-caso").focus()
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-novo-caso")
        self.page.locator("#modal-novo-caso").focus()
        self.page.keyboard.press("Escape")
        self.page.locator("#modal-novo-caso").wait_for(state="hidden")
        self.assertFalse(self.page.locator("#modal-novo-caso").is_visible())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-novo-caso")
        self.assertFalse(self.page.locator("main").evaluate("el => el.closest('[inert]') !== null"))

    def test_todos_fluxos_sao_secoes_no_documento(self):
        self.connect()
        ids = self.page.locator(".fluxo-pagina").evaluate_all("els => els.map(el => el.id)")
        self.assertEqual(len(ids), 8)
        for width in (1440, 390):
            self.page.set_viewport_size({"width": width, "height": 960})
            for ident in ids:
                self.page.evaluate("id => abrirModal(id)", ident)
                section = self.page.locator(f"#{ident}")
                self.assertTrue(section.is_visible())
                self.assertEqual(section.get_attribute("role"), "region")
                self.assertTrue(section.evaluate("el => !!el.closest('main')"))
                self.assertEqual(section.evaluate("el => getComputedStyle(el).position"), "static")
                self.assertEqual(self.page.locator("[inert]").count(), 0)
                self.assertNotEqual(self.page.locator("body").evaluate("el => getComputedStyle(el).overflow"), "hidden")
                self.assertLessEqual(section.bounding_box()["width"], width)
                self.page.evaluate("id => fecharModal(id)", ident)
                self.assertFalse(section.is_visible())
        self.assertFalse(self.errors)

    def test_saida_caso_continuar_descartar_e_salvar_responsavel(self):
        self.open_case()
        self.page.locator("#editar-caso-responsavel").select_option("Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("continuar")
        self.assertTrue(self.page.locator("#caso-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Ana")
        self.page.evaluate("abrirCaso('caso-1')")
        self.page.locator("#editar-caso-responsavel").select_option("Título salvo")
        self.page.locator("#caso-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.case["responsavel"], "Título salvo")
        self.assertFalse(self.errors)

    def test_falha_ao_salvar_preserva_edicao_e_bloqueia_saida(self):
        self.open_case()
        self.page.locator("#editar-caso-responsavel").select_option("Não perder")
        self.fail_save = True
        self.page.locator("#caso-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("document.getElementById('resultado-caso-editar').textContent.includes('Falha simulada')")
        self.assertTrue(self.page.locator("#caso-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Não perder")
        self.assertTrue(self.page.locator("#form-caso-editar .edicao-pendente").is_visible())
        self.assertFalse(self.errors)

    def test_modal_com_edicao_pede_decisao_e_escape_continua(self):
        self.connect()
        self.page.evaluate("abrirModal('modal-novo-caso')")
        self.page.locator("#caso-titulo").fill("Caso pendente")
        self.page.keyboard.press("Escape")
        self.page.wait_for_selector("#modal-edicao-pendente.is-visible")
        self.page.keyboard.press("Escape")
        self.assertTrue(self.page.locator("#modal-novo-caso").is_visible())
        self.page.locator("#modal-edicao-pendente").wait_for(state="hidden")
        self.assertFalse(self.page.locator("#modal-edicao-pendente").is_visible())
        self.page.keyboard.press("Escape")
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('modal-novo-caso').classList.contains('is-visible')")
        self.assertFalse(self.errors)

    def test_cliente_protegido_e_descarte_restaura_grupos(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.page.locator("#contato-nome").fill("Nome pendente")
        self.page.evaluate("gruposContato.telefones.definirValores([{tipo: 'comercial', telefone: '11888888888'}, {tipo: 'celular', telefone: '11777777777'}])")
        self.page.locator("#contato-voltar").click()
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('contatos-vista-lista').hidden")
        self.assertEqual(self.page.locator("#contato-nome").input_value(), "Cliente de teste")
        telefones = self.page.evaluate("gruposContato.telefones.obterValores()")
        self.assertEqual(len(telefones), 1)
        self.assertEqual(telefones[0]["telefone"], "11999999999")
        self.assertFalse(self.errors)

    def test_navegacao_entre_secoes_nao_descarta_edicao_ao_cancelar(self):
        self.open_case()
        self.page.locator("#editar-caso-responsavel").select_option("Título pendente")
        self.page.locator("#aba-contatos-botao").click()
        self.choose("continuar")
        self.page.locator("#modal-edicao-pendente").wait_for(state="hidden")
        self.assertTrue(self.page.locator("#aba-casos").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Título pendente")
        self.page.locator("#aba-contatos-botao").click()
        self.choose("salvar")
        self.page.wait_for_function("!document.getElementById('aba-contatos').hidden")
        self.assertEqual(self.case["responsavel"], "Título pendente")
        self.assertFalse(self.errors)

    def test_cadastro_de_caso_por_publicacao_salva_ao_sair(self):
        self.connect()
        self.page.evaluate("() => { const area = document.getElementById('resultado-processo'); anexarBotaoCadastrarCaso(area, '00000000000000000001', null); }")
        self.page.locator("#resultado-processo button").click()
        self.page.locator("#form-caso-publicacao input[aria-label='Nome do novo cliente']").fill("Cliente de teste")
        self.page.locator("#form-caso-publicacao input[aria-label='Título do processo (opcional)']").fill("Novo caso de teste")
        self.page.keyboard.press("Escape")
        self.choose("salvar")
        self.page.locator("#modal-cadastrar-caso-publicacao").wait_for(state="hidden")
        self.assertIn(("POST", "/casos"), self.requests)
        self.assertFalse(self.errors)

    def test_revalidacao_preserva_secao_da_url(self):
        self.open_case()
        self.page.evaluate("localStorage.setItem('cnj_token', 'teste-valido')")
        self.page.reload()
        self.page.wait_for_function("document.getElementById('status-conexao').textContent === 'Conectado' && !document.getElementById('aba-casos').hidden")
        self.assertEqual(self.page.evaluate("location.hash"), "#aba-casos")
        self.assertFalse(self.errors)

    def test_cancelar_mudanca_da_url_preserva_secao_e_edicao(self):
        self.open_case()
        self.page.locator("#editar-caso-responsavel").select_option("Título pendente")
        self.page.evaluate("location.hash = '#aba-contatos'")
        self.choose("continuar")
        self.page.wait_for_function("location.hash === '#aba-casos'")
        self.assertTrue(self.page.locator("#aba-casos").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Título pendente")
        self.assertFalse(self.errors)

    def test_capa_sem_partes_exibe_ausencia_sem_edicao_pendente(self):
        self.case["processos"] = ["10063142720238260005"]
        self.context.route("**/casos/caso-1/processos/*/capa", lambda route: route.fulfill(json={"partes": [], "advogados": []}))
        self.open_case()
        self.assertEqual(self.page.locator("#lista-capa-processos .capa-card-auto dd").filter(has_text="Não informado pelo DJEN").count(), 3)
        self.assertFalse(self.page.evaluate("formulariosPendentes().length"))
        self.assertFalse(self.errors)

    def test_vincular_publicacao_abre_formulario_e_envia_vinculo(self):
        self.open_case()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-processo')); _cache.casos = [{id: 'caso-1', titulo: 'Caso de teste'}]; const area = document.getElementById('resultado-processo'); const table = document.createElement('table'); for (const row of linhaPublicacaoOab({hash:'publicacao-teste',status:'nao_tratada',numero_processo:'00000000000000000001',dados:{}})) table.appendChild(row); area.appendChild(table); }")
        self.page.locator("#resultado-processo button[aria-label='Mais ações']").click()
        self.page.get_by_text("Vincular a processo existente", exact=True).click()
        self.page.locator("#resultado-processo .mini-form-caso select").select_option("caso-1")
        self.page.locator("#resultado-processo .mini-form-caso").get_by_role("button", name="Vincular", exact=True).click()
        self.page.wait_for_function("!document.querySelector('#resultado-processo .mini-form-caso')")
        self.assertIn(("POST", "/casos/caso-1/publicacoes"), self.requests)
        self.assertFalse(self.errors)

    def test_cadastro_responsivo_abas_legiveis_e_acoes_dentro_da_tela(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.page.wait_for_timeout(150)
            self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
            label = self.page.locator("#contato-cadastro-aba-pessoal-botao .cds--content-switcher__label")
            self.assertTrue(label.is_visible())
            self.assertGreater(label.bounding_box()["width"], 100)
            for name in ("contato-salvar-botao", "contato-excluir"):
                rect = self.page.locator(f"#{name}").bounding_box()
                self.assertGreaterEqual(rect["x"], 0)
                self.assertLessEqual(rect["x"] + rect["width"], width)
        self.page.locator("#contato-cadastro-aba-pessoal-botao").focus()
        self.page.keyboard.press("ArrowRight")
        self.assertTrue(self.page.locator("#contato-cadastro-painel-documentacao").is_visible())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "contato-cadastro-aba-documentacao-botao")
        self.assertFalse(self.errors)

    def test_layout_aproveita_largura_sem_rolagem_horizontal(self):
        self.open_case()
        for width in (1920, 1440, 1024, 820, 768, 390, 320):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 960})
                self.page.wait_for_timeout(250)
                self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                self.assertTrue(self.page.locator(".sub-abas").evaluate("el => el.scrollWidth <= el.clientWidth"))
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        for width in (1440, 820, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.assertTrue(self.page.locator(".cadastro-tabs").evaluate("el => el.scrollWidth <= el.clientWidth"))
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); document.getElementById('contato-voltar').click(); }")
        # Conteúdo sem espaços deve quebrar dentro da coluna, sem ocultar dados.
        self.page.evaluate("""() => {
            const table = document.querySelector('.contatos-tabela');
            table.querySelector('td[data-label="E-mail"]').textContent = 'contato'.repeat(30) + '@exemplo.com.br';
        }""")
        for width in (1920, 1440, 1024, 820, 768, 390, 320):
            for expanded in (True, False):
                with self.subTest(width=width, expanded=expanded):
                    self.page.set_viewport_size({"width": width, "height": 960})
                    self.page.evaluate("_sideNavAbrir()" if expanded and width > 768 else "_sideNavFechar()")
                    self.page.wait_for_timeout(250)
                    table = self.page.locator('.contatos-tabela')
                    self.assertTrue(table.evaluate("el => el.closest('.tabela-responsiva-wrap').scrollWidth <= el.closest('.tabela-responsiva-wrap').clientWidth"))
                    self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
                    if width >= 1440:
                        right = self.page.locator('main').bounding_box()
                        self.assertAlmostEqual(right['x'] + right['width'], width, delta=1)
        self.assertFalse(self.errors)

    def test_paineis_do_cabecalho_permanecem_dentro_da_tela(self):
        self.connect()
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.page.wait_for_timeout(150)
            for button, panel in (("btn-busca-toggle", "header-busca-painel"), ("btn-notificacoes-toggle", "header-notificacoes-painel")):
                self.page.locator(f"#{button}").click()
                rect = self.page.locator(f"#{panel}").bounding_box()
                self.assertGreaterEqual(rect["x"], 0)
                self.assertLessEqual(rect["x"] + rect["width"], width)
                self.page.keyboard.press("Escape")
        self.assertFalse(self.errors)

    def test_indicador_ativo_e_foco_e_dialogo_sem_botoes_transbordando(self):
        self.open_case()
        row, marker = self.page.locator("#aba-casos-botao").evaluate("el => [el.getBoundingClientRect().height, parseFloat(getComputedStyle(el, '::before').height)]")
        self.assertLessEqual(marker, row)
        icon, button = self.page.locator("#btn-busca-toggle").evaluate("el => [el.querySelector('svg').getBoundingClientRect().toJSON(), el.getBoundingClientRect().toJSON()]")
        self.assertAlmostEqual(icon["y"] + icon["height"] / 2, button["y"] + button["height"] / 2, delta=1)
        self.page.locator("#caso-subaba-cadastro-botao").focus()
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(self.page.locator("#caso-subaba-atividades-botao").evaluate("el => getComputedStyle(el).outlineStyle"), "solid")
        self.page.locator("#caso-subaba-cadastro-botao").click()
        self.page.locator("#editar-caso-responsavel").select_option("Título pendente")
        self.page.locator("#caso-voltar").click()
        self.page.wait_for_selector("#modal-edicao-pendente.is-visible")
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.page.wait_for_timeout(300)  # Aguarda a transição de entrada/reposicionamento do Carbon.
            container = self.page.locator("#modal-edicao-pendente .fluxo-pagina-container").bounding_box()
            for item in self.page.locator("#modal-edicao-pendente .fluxo-pagina-footer button").all():
                rect = item.bounding_box()
                self.assertGreaterEqual(rect["x"], container["x"])
                self.assertLessEqual(rect["x"] + rect["width"], container["x"] + container["width"] + 1)
                self.assertLessEqual(rect["y"] + rect["height"], container["y"] + container["height"] + 1)
        self.choose("continuar")
        self.assertFalse(self.errors)

    def test_cabecalho_responsivo_e_abas_por_teclado(self):
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 900})
            self.page.wait_for_timeout(150)
            rect = self.page.locator("#aba-acesso-botao").bounding_box()
            if width <= 768:
                self.assertFalse(self.page.locator(".header-produto").is_visible())
            self.assertGreaterEqual(rect["x"], 0)
            self.assertLessEqual(rect["x"] + rect["width"], width)
            self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), width)
            if width in (1440, 320):
                self.page.screenshot(path=f"/tmp/astrajus-access-{width}.png")
        self.page.set_viewport_size({"width": 1440, "height": 1000})
        self.open_case()
        self.page.screenshot(path="/tmp/astrajus-case-desktop.png")
        self.page.locator("#caso-subaba-cadastro-botao").focus()
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "caso-subaba-atividades-botao")
        self.assertTrue(self.page.locator("#caso-subaba-atividades").is_visible())
        self.assertFalse(self.errors)


if __name__ == "__main__":
    unittest.main()
