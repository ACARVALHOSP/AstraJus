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
        self.case = {"id": "caso-1", "numero": 1, "titulo": "Caso de teste", "autor": "Autora de teste", "processos": []}
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
        data = {"/casos/caso-1": self.case, "/clientes/cliente-1": self.contact,
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

    def test_partes_automaticas_djen_com_tags_oab_e_polos(self):
        self.open_case()
        self.context.route("**/casos/caso-1/publicacoes", lambda route: route.fulfill(json={"publicacoes": [{"dados": {
            "destinatarios": [{"nome": "Autora DJen", "polo": "A"}, {"nome": "Réu DJen", "polo": "P"}, {"nome": "Sem polo"}],
            "destinatarioadvogados": [{"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"}, {"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"}]
        }}]}))
        self.page.locator("#caso-subaba-partes-botao").click()
        self.page.wait_for_function("document.getElementById('status-partes-djen').textContent.includes('Preenchido')")
        self.assertIn("Autora DJen", self.page.evaluate("_lerCamposPartes('autor')"))
        self.assertEqual(self.page.evaluate("_lerCamposPartes('reu')"), ["Réu DJen"])
        self.assertNotIn("Sem polo", self.page.evaluate("_lerCamposPartes('autor')"))
        tags = self.page.locator("#campos-caso-advogados .cds--tag")
        self.assertEqual(tags.all_text_contents(), ["Ana Silva — OAB 12345/SP"])
        self.page.locator("#form-caso-partes button[type=submit]").click()
        self.page.wait_for_function("document.getElementById('resultado-caso-partes').textContent.includes('Partes atualizadas')")
        self.assertEqual(self.case["advogados"], "Ana Silva — OAB 12345/SP")
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

    def test_modal_contem_foco_escape_e_restaura_origem(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-casos')); }")
        self.page.locator("#btn-novo-caso").click()
        for _ in range(18):
            self.page.keyboard.press("Tab")
            self.assertTrue(self.page.evaluate("document.getElementById('modal-novo-caso').contains(document.activeElement)"))
        self.page.keyboard.press("Escape")
        self.page.locator("#modal-novo-caso").wait_for(state="hidden")
        self.assertFalse(self.page.locator("#modal-novo-caso").is_visible())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-novo-caso")
        self.assertFalse(self.page.locator("main").evaluate("el => el.closest('[inert]') !== null"))

    def test_saida_caso_continuar_descartar_e_salvar_ambas_secoes(self):
        self.open_case()
        self.page.locator("#editar-caso-titulo").fill("Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("continuar")
        self.assertTrue(self.page.locator("#caso-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-titulo").input_value(), "Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.page.locator("#editar-caso-titulo").input_value(), "Caso de teste")
        self.page.evaluate("abrirCaso('caso-1')")
        self.page.locator("#editar-caso-titulo").fill("Título salvo")
        self.page.locator("#caso-subaba-partes-botao").click()
        self.page.locator("#editar-caso-autor").fill("Autora alterada")
        self.page.locator("#caso-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.case["titulo"], "Título salvo")
        self.assertEqual(self.case["autor"], "Autora alterada")
        self.assertFalse(self.errors)

    def test_falha_ao_salvar_preserva_edicao_e_bloqueia_saida(self):
        self.open_case()
        self.page.locator("#editar-caso-titulo").fill("Não perder")
        self.fail_save = True
        self.page.locator("#caso-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("document.getElementById('resultado-caso-editar').textContent.includes('Falha simulada')")
        self.assertTrue(self.page.locator("#caso-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-titulo").input_value(), "Não perder")
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
        self.page.locator("#editar-caso-titulo").fill("Título pendente")
        self.page.locator("#aba-contatos-botao").click()
        self.choose("continuar")
        self.page.locator("#modal-edicao-pendente").wait_for(state="hidden")
        self.assertTrue(self.page.locator("#aba-casos").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-titulo").input_value(), "Título pendente")
        self.page.locator("#aba-contatos-botao").click()
        self.choose("salvar")
        self.page.wait_for_function("!document.getElementById('aba-contatos').hidden")
        self.assertEqual(self.case["titulo"], "Título pendente")
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
        self.page.locator("#editar-caso-titulo").fill("Título pendente")
        self.page.evaluate("location.hash = '#aba-contatos'")
        self.choose("continuar")
        self.page.wait_for_function("location.hash === '#aba-casos'")
        self.assertTrue(self.page.locator("#aba-casos").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-titulo").input_value(), "Título pendente")
        self.assertFalse(self.errors)

    def test_descarte_restaura_partes_individuais_inclusive_campos_adicionados(self):
        self.case["autor"] = "Autora de teste, Segunda autora"
        self.open_case()
        self.page.locator("#caso-subaba-partes-botao").click()
        self.page.evaluate("_preencherCamposPartes('autor', ['Alteração', 'Segunda autora', 'Terceira autora'])")
        self.page.locator("#caso-voltar").click()
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.page.evaluate("_lerCamposPartes('autor')"), ["Autora de teste", "Segunda autora"])
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
        self.assertEqual(self.page.locator("#caso-subaba-partes-botao").evaluate("el => getComputedStyle(el).outlineStyle"), "solid")
        self.page.locator("#editar-caso-autor").fill("Alteração de teste")
        self.page.locator("#caso-voltar").click()
        self.page.wait_for_selector("#modal-edicao-pendente.is-visible")
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.page.wait_for_timeout(300)  # Aguarda a transição de entrada/reposicionamento do Carbon.
            container = self.page.locator("#modal-edicao-pendente .cds--modal-container").bounding_box()
            for item in self.page.locator("#modal-edicao-pendente .cds--modal-footer button").all():
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
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "caso-subaba-partes-botao")
        self.assertTrue(self.page.locator("#caso-subaba-partes").is_visible())
        self.assertFalse(self.errors)


if __name__ == "__main__":
    unittest.main()
