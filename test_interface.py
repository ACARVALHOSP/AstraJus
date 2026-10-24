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
                return route.fulfill(json={"atualizadas": len(request.post_data_json.get("hashes", [])), "hashes_atualizados": request.post_data_json.get("hashes", []), "hashes_falharam": []})
            self.pub_oab_gets += 1
            status = parse_qs(urlparse(request.url).query).get("status", [""])[0]
            itens = [p for p in self.pub_oab_items if not status or p["status"] == status]
            query = parse_qs(urlparse(request.url).query)
            tamanho = int(query.get("tamanho", ["5"])[0])
            pagina = min(int(query.get("pagina", ["1"])[0]), max(1, (len(itens) + tamanho - 1) // tamanho))
            campos = sorted(set(k for p in self.pub_oab_items for k in p["dados"]))
            return route.fulfill(json={"publicacoes": itens[(pagina-1)*tamanho:pagina*tamanho], "total": len(itens),
                "pagina": pagina, "tamanho": tamanho, "campos_djen": campos})
        self.context.route("**/publicacoes-oab**", responder)
        self.connect()
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-publicacoes-oab'))")
        self.page.locator("#lista-publicacoes-oab cds-table").wait_for()
        self.page.wait_for_function("['cds-table', 'cds-toggletip', 'cds-tag', 'cds-icon-button'].every(n => customElements.get(n))")

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
        self.page.locator(".pub-oab-colunas button").click()
        for rotulo in ("Divulgado", "Capturado", "Tipo"):
            self.page.locator(".pub-oab-colunas").get_by_label(rotulo, exact=True).check()
        self.page.locator(".pub-oab-colunas button").press("Escape")
        self.assertTrue(self.page.get_by_role("columnheader", name="Divulgado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Capturado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Tipo", exact=True).is_visible())
        self.assertEqual(tabela.locator('cds-table-body > cds-table-row').first.locator('[data-coluna="nome"]').inner_text(), "Maria Da Silva X Parte Passiva Não Informada")
        self.page.locator(".pub-oab-colunas button").click()
        for rotulo in ("Tipo De Documento", "Advogados", "Número Da Oab", "Texto", "Hash", "Link", "Meio"):
            self.page.locator(".pub-oab-colunas").get_by_label(rotulo, exact=True).check()
        self.page.locator(".pub-oab-colunas button").press("Escape")
        linha = tabela.locator('cds-table-body > cds-table-row').first
        self.assertEqual(linha.locator('[data-coluna="advogados"]').inner_text(), "João Dos Santos")
        self.assertEqual(linha.locator('[data-coluna="hash"]').inner_text(), "aBc123")
        self.assertEqual(linha.locator('[data-coluna="link"]').inner_text(), "https://example.test/AbC")
        self.assertEqual(linha.locator('[data-coluna="djen:meio"]').inner_text(), "Diário Eletrônico")
        linha.get_by_role("button", name="Expandir publicação:", exact=False).click()
        self.page.locator(".pub-oab-colunas button").click()
        self.page.locator(".pub-oab-colunas").get_by_label("Capturado", exact=True).uncheck()
        self.page.locator(".pub-oab-colunas button").press("Escape")
        self.assertTrue(tabela.locator("cds-table-expanded-row[colspan]").first.evaluate("el => el.colSpan === el.closest('cds-table').querySelectorAll('cds-table-head cds-table-header-cell:not([hidden])').length"))
        self.page.evaluate("carregarPublicacoesOab()")
        self.page.locator(".pub-oab-tabela").wait_for()
        self.assertFalse(self.page.locator('cds-table-header-cell[data-coluna="capturado"]').is_visible())
        self.assertTrue(self.page.locator('cds-table-header-cell[data-coluna="djen:meio"]').is_visible())
        self.assertEqual(self.pub_oab_items[0]["dados"]["destinatarios"][0]["nome"], "MARIA DA SILVA")
        for largura in (1440, 390):
            self.page.set_viewport_size({"width": largura, "height": 900})
            self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
            self.assertEqual(tabela.locator('cds-table-cell[data-coluna="nome"]').first.evaluate("el => getComputedStyle(el).fontSize"), "12px")
            self.page.locator(".pub-oab-colunas button").click()
            fieldset = self.page.locator(".pub-oab-colunas fieldset")
            self.assertTrue(fieldset.evaluate("el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth"))
            self.page.locator(".pub-oab-colunas button").press("Escape")
        self.assertFalse(self.errors)

    def test_publicacoes_webcomponents_m_paginacao_selecao_entre_paginas_e_catalogo_completo(self):
        self.open_publicacoes_oab()
        self.pub_oab_items.extend({"hash": f"pub-{i}", "numero_processo": str(i).zfill(20),
            "status": "nao_tratada", "dados": {"campo_fora_da_pagina": "Valor"} if i == 11 else {}}
            for i in range(3, 12))
        self.page.evaluate("carregarPublicacoesOab()")
        self.assertEqual(self.page.locator('input[data-publicacao-hash]').count(), 5)
        self.assertEqual(self.page.locator('.pub-oab-linha').first.evaluate("el => el.getBoundingClientRect().height"), 40)
        self.assertEqual(self.page.locator('.pub-oab-tabela cds-table-header-row').evaluate("el => el.getBoundingClientRect().height"), 40)
        self.page.locator('.pub-oab-colunas button').click()
        self.assertTrue(self.page.locator('.pub-oab-colunas').get_by_label('Campo Fora Da Pagina', exact=True).is_visible())
        self.page.locator('.pub-oab-colunas button').press('Escape')
        self.page.locator('input[data-publicacao-hash="pub-1"]').check()
        self.assertFalse(self.page.locator('.pub-oab-tabela-toolbar').is_visible())
        self.page.get_by_role('button', name='Próxima página', exact=True).click()
        self.page.locator('input[data-publicacao-hash="pub-6"]').wait_for()
        self.assertFalse(self.page.locator('input[data-publicacoes-todas]').is_checked())
        self.page.locator('input[data-publicacoes-todas]').check()
        self.assertIn('6 Selecionadas', self.page.locator('#pub-oab-selecionadas').inner_text())
        self.page.get_by_role('button', name='Página anterior', exact=True).click()
        self.assertTrue(self.page.locator('input[data-publicacao-hash="pub-1"]').is_checked())
        self.assertTrue(self.page.locator('input[data-publicacoes-todas]').evaluate('el => el.indeterminate'))
        self.page.locator('#pub-oab-marcar-tratada').click()
        self.page.wait_for_function('!_pubOabAtualizando && !_pubOabCarregando')
        self.assertEqual(set(self.pub_oab_posts[-1]['hashes']), {'pub-1', 'pub-6', 'pub-7', 'pub-8', 'pub-9', 'pub-10'})
        self.page.locator('input[data-publicacao-hash="pub-1"]').check()
        self.page.get_by_label('Itens por página:', exact=True).select_option('10')
        self.page.wait_for_function("document.querySelectorAll('input[data-publicacao-hash]').length === 10")
        self.assertEqual(self.page.locator('input[data-publicacao-hash]:checked').count(), 0)
        self.assertIn('1–10 de 11', self.page.locator('.pub-oab-paginacao').inner_text())
        self.assertFalse(self.errors)

    def test_publicacoes_webcomponents_m_expansao_independente_tooltip_e_toque(self):
        self.open_publicacoes_oab()
        nome = 'Parte Ativa Com Nome Muito Extenso ' * 5
        self.pub_oab_items[0]['dados'] = {'texto': 'TEXTO original sem Alteração.',
            'destinatarios': [{'nome': nome, 'polo': 'A'}, {'nome': 'Banco', 'polo': 'P'}]}
        self.page.evaluate('carregarPublicacoesOab()')
        row = self.page.locator('.pub-oab-linha').first
        self.assertEqual(row.evaluate('el => el.getBoundingClientRect().height'), 40)
        name = row.locator('.pub-oab-nome-processo')
        name.focus()
        self.assertTrue(self.page.locator('.pub-oab-tooltip-nome:popover-open').is_visible())
        name.press('Escape')
        row.get_by_role('button', name='Expandir publicação:', exact=False).click()
        self.assertTrue(self.page.locator('.pub-oab-publicacao-completa').first.is_visible())
        self.assertEqual(self.page.locator('input[data-publicacao-hash]:checked').count(), 0)
        self.page.locator('input[data-publicacao-hash]').first.check()
        self.assertTrue(self.page.locator('.pub-oab-publicacao-completa').first.is_visible())
        self.page.get_by_role('button', name='Próxima página', exact=True).is_disabled()
        self.page.emulate_media(media='screen')
        self.page.set_viewport_size({'width': 390, 'height': 900})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.assertFalse(self.errors)

    def test_publicacoes_lote_parcial_mantem_falhas_e_nao_repete_envio(self):
        self.open_publicacoes_oab()
        self.page.locator('input[data-publicacoes-todas]').check()
        def responder(route):
            return route.fulfill(json={'atualizadas': 1, 'hashes_atualizados': ['pub-1'], 'hashes_falharam': ['pub-2']})
        self.context.route('**/publicacoes-oab/status', responder)
        self.page.locator('#pub-oab-marcar-tratada').click()
        self.page.wait_for_function('!_pubOabAtualizando && !_pubOabCarregando')
        self.assertFalse(self.page.locator('input[data-publicacao-hash="pub-1"]').is_checked())
        self.assertTrue(self.page.locator('input[data-publicacao-hash="pub-2"]').is_checked())
        self.assertIn('Atualização parcial', self.page.locator('#toast-global').inner_text())
        self.assertFalse(self.errors)

    def test_publicacoes_webcomponents_m_toque_amplia_alvos_e_erro_preserva_selecao(self):
        self.context = self.browser.new_context(viewport={"width": 390, "height": 900}, has_touch=True, is_mobile=True)
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda erro: self.errors.append(str(erro)))
        self.context.route("**/*", self.route)
        self.page.goto(self.url)
        self.page.wait_for_function("typeof abrirCaso === 'function'")
        self.open_publicacoes_oab()
        self.assertGreaterEqual(self.page.locator('.pub-oab-linha').first.evaluate('el => el.getBoundingClientRect().height'), 44)
        self.assertGreaterEqual(self.page.locator('.pub-oab-expandir').first.evaluate('el => el.getBoundingClientRect().width'), 44)
        self.page.locator('input[data-publicacao-hash]').first.check()
        self.context.route('**/publicacoes-oab?**', lambda route: route.fulfill(status=500, json={'mensagem': 'Falha de carregamento'}))
        self.page.locator('#pub-oab-atualizar').click()
        self.page.get_by_role('button', name='Tentar novamente', exact=True).wait_for()
        self.assertTrue(self.page.locator('input[data-publicacao-hash]').first.is_checked())
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.assertFalse(self.errors)

    def test_publicacoes_colunas_clique_no_nome_checkbox_e_teclado(self):
        self.open_publicacoes_oab()
        crashes = []
        self.page.on("crash", lambda: crashes.append(True))
        for largura in (1440, 390):
            self.page.set_viewport_size({"width": largura, "height": 900})
            self.page.locator(".pub-oab-colunas button").click()
            label = self.page.locator('.pub-oab-coluna-opcao label[for="pub-oab-coluna-orgao"]')
            campo = self.page.locator("#pub-oab-coluna-orgao")
            for _ in range(4):
                antes = campo.is_checked()
                label.click()
                self.assertEqual(campo.is_checked(), not antes)
                self.page.wait_for_function("() => document.querySelector('cds-table-header-cell[data-coluna=orgao]').hidden !== document.getElementById('pub-oab-coluna-orgao').checked")
                campo.click()
                self.assertEqual(campo.is_checked(), antes)
                self.page.wait_for_function("() => document.querySelector('cds-table-header-cell[data-coluna=orgao]').hidden !== document.getElementById('pub-oab-coluna-orgao').checked")
            antes = campo.is_checked()
            campo.focus()
            campo.press("Space")
            self.assertEqual(campo.is_checked(), not antes)
            self.page.wait_for_function("() => document.querySelector('cds-table-header-cell[data-coluna=orgao]').hidden !== document.getElementById('pub-oab-coluna-orgao').checked")
            self.assertTrue(campo.evaluate("el => el === document.activeElement"))
            self.page.locator(".pub-oab-colunas button").press("Escape")
        self.assertFalse(crashes)
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
        self.page.locator("#lista-publicacoes-oab cds-table").wait_for()
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
        busca = self.page.locator(".pub-oab-inline-form cds-search input")
        self.assertTrue(busca.evaluate("el => el === el.getRootNode().activeElement"))
        busca.fill("Caso")
        self.assertTrue(botao.is_visible(), "Consulta inline não deve filtrar as linhas da DataTable")
        form = self.page.locator(".pub-oab-inline-form")
        form.get_by_role("button", name="Caso de teste", exact=False).click()
        self.assertTrue(form.locator(".pub-oab-confirmacao").is_visible())
        self.assertTrue(form.get_by_role("button", name="Confirmar Vínculo", exact=True).is_enabled())
        form.get_by_role("button", name="Cancelar", exact=True).click()
        self.page.wait_for_function("document.querySelector('.pub-oab-combo .cds--menu-button__trigger') === document.activeElement")
        self.assertTrue(botao.evaluate("el => el === document.activeElement"))
        self.assertFalse(self.errors)

    def test_publicacoes_acoes_compactas_menu_e_barra_contextual(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]["dados"]["link"] = "https://example.test/publicacao"
        self.page.evaluate("carregarPublicacoesOab()")
        tabela = self.page.locator(".pub-oab-tabela")
        tabela.wait_for()
        acoes = tabela.locator('cds-table-body > cds-table-row').first.locator('cds-table-cell[data-label="Ações"]')
        self.assertEqual(acoes.locator('cds-icon-button.pub-oab-abrir').count(), 1)
        abrir = acoes.get_by_role('link', name='Abrir publicação no DJEN (nova aba)', exact=True)
        self.assertEqual(abrir.get_attribute('href'), 'https://example.test/publicacao')
        self.assertEqual(abrir.get_attribute('target'), '_blank')
        self.assertEqual(acoes.locator('.pub-oab-abrir svg[slot="icon"]').count(), 1)
        self.page.locator('.pub-oab-colunas button').click()
        self.page.locator('.pub-oab-colunas').get_by_label('Status', exact=True).check()
        self.page.locator('.pub-oab-colunas button').press('Escape')
        tag = tabela.locator('cds-tag.pub-oab-status').first
        self.assertEqual(tag.get_attribute('size'), 'sm')
        self.assertEqual(tag.locator('.pub-oab-status-texto').evaluate('el => getComputedStyle(el).fontSize'), '10px')
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
        self.page.get_by_role("form", name="Cadastrar Processo", exact=True).wait_for()
        self.assertFalse(self.errors)

    def test_publicacoes_nome_polos_texto_original_e_colunas_fixas(self):
        self.open_publicacoes_oab()
        texto = "INTIMAÇÃO: Fica a parte intimada. Art. 5º — NÃO MODIFICAR."
        self.pub_oab_items[0]["dados"] = {"siglaTribunal": "tjsp", "texto": texto,
            "destinatarios": [{"nome": "MARIA SILVA", "polo": "A"}, {"nome": "BANCO EXEMPLO", "polo": "P"}]}
        self.page.evaluate("localStorage.setItem('cnj_pub_oab_colunas_visiveis_v2', '[]')")
        self.page.evaluate("carregarPublicacoesOab()")
        row = self.page.locator(".pub-oab-tabela cds-table-body > cds-table-row").first
        self.assertEqual(row.locator('[data-coluna="nome"]').inner_text(), "Maria Silva X Banco Exemplo")
        self.assertEqual(row.locator('[data-coluna="tribunal"]').inner_text(), "TJSP")
        self.assertTrue(row.locator('[data-coluna="processo"]').is_visible())
        self.assertEqual(row.locator('.pub-oab-nome-processo').get_attribute("title"), "Maria Silva X Banco Exemplo")
        self.assertEqual(row.locator('.pub-oab-nome-processo').evaluate("el => getComputedStyle(el).whiteSpace"), "nowrap")
        self.page.locator(".pub-oab-colunas button").click()
        self.assertEqual(self.page.locator('#pub-oab-coluna-nome:disabled:checked, #pub-oab-coluna-tribunal:disabled:checked, #pub-oab-coluna-processo:disabled:checked').count(), 3)
        self.page.locator(".pub-oab-colunas button").press("Escape")
        row.get_by_role("button", name="Expandir publicação:", exact=False).click()
        full = self.page.locator(".pub-oab-publicacao-completa").first
        self.assertEqual(full.locator(".pub-oab-publicacao-texto").inner_text(), texto)
        self.assertEqual(full.locator(".pub-oab-publicacao-texto").evaluate("el => getComputedStyle(el).fontSize"), "10px")
        self.assertEqual(full.locator(".pub-oab-publicacao-texto").evaluate("el => getComputedStyle(el).textAlign"), "justify")
        self.assertGreater(full.locator("header strong").count(), 2)
        self.assertFalse(self.errors)

    def test_publicacoes_cadastro_inline_cliente_responsavel_e_confirmacao(self):
        self.open_publicacoes_oab()
        self.page.locator(".pub-oab-combo .cds--menu-button__trigger").first.click()
        self.page.get_by_role("menuitem", name="Cadastrar Processo", exact=True).click()
        form = self.page.get_by_role("form", name="Cadastrar Processo", exact=True)
        form.locator("cds-search input").fill("Cliente")
        form.get_by_role("button", name="Cliente de teste", exact=True).click()
        form.get_by_label("Responsável", exact=True).select_option("Ana")
        self.page.set_viewport_size({"width": 390, "height": 900})
        self.assertTrue(form.evaluate("el => el.getBoundingClientRect().width <= innerWidth && el.scrollWidth <= el.clientWidth"))
        self.assertEqual(self.pub_oab_posts, [])
        form.get_by_role("button", name="Confirmar Cadastro", exact=True).click()
        self.page.wait_for_function("document.getElementById('toast-global').textContent.includes('Processo Cadastrado')")
        self.assertEqual(self.pub_oab_posts, [{"cliente_id": "cliente-1", "responsavel": "Ana"}])
        self.assertFalse(self.errors)

    def test_publicacoes_vinculo_exige_selecao_e_confirma_numero_parte_cliente(self):
        self.open_publicacoes_oab()
        self.page.locator(".pub-oab-combo .cds--menu-button__trigger").first.click()
        self.page.get_by_role("menuitem", name="Vincular A Processo Existente", exact=True).click()
        form = self.page.get_by_role("form", name="Vincular A Processo Existente", exact=True)
        confirmar = form.get_by_role("button", name="Confirmar Vínculo", exact=True)
        self.assertTrue(confirmar.is_disabled())
        queries = []
        def responder(route):
            from urllib.parse import urlparse, parse_qs
            queries.append(parse_qs(urlparse(route.request.url).query)["q"][0])
            route.fulfill(json={"casos": [self.case]})
        self.context.route("**/casos?q=*", responder)
        for termo in ("1000607", "Maria", "Cliente"):
            form.locator("cds-search input").fill(termo)
            form.get_by_role("button", name="Caso de teste", exact=False).click()
            self.assertTrue(form.locator(".pub-oab-confirmacao").is_visible())
            self.assertTrue(confirmar.is_enabled())
        self.assertEqual(queries, ["1000607", "Maria", "Cliente"])
        self.assertFalse(any(m == "POST" and p.endswith("/publicacoes") for m, p in self.requests))
        confirmar.click()
        self.page.wait_for_function("document.getElementById('toast-global').textContent.includes('Publicação Vinculada')")
        self.assertIn(("POST", "/casos/caso-1/publicacoes"), self.requests)
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
        self.open_publicacoes_oab()
        self.page.locator(".pub-oab-combo .cds--menu-button__trigger").first.click()
        self.page.get_by_role("menuitem", name="Vincular A Processo Existente", exact=True).click()
        form = self.page.get_by_role("form", name="Vincular A Processo Existente", exact=True)
        form.locator("cds-search input").fill("Caso")
        form.get_by_role("button", name="Caso de teste", exact=False).click()
        form.get_by_role("button", name="Confirmar Vínculo", exact=True).click()
        self.page.wait_for_function("!document.querySelector('.pub-oab-inline-form')")
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


    def test_auditoria_consulta_global_lenta_parcial_e_recuperacao(self):
        self.connect()
        pendentes = []
        self.context.route("**/clientes", lambda rota: pendentes.append(rota))
        self.page.locator("#btn-busca-toggle").click()
        self.page.locator("cds-search:has(+ #header-busca-input) input").fill("Cliente")
        self.page.wait_for_function("document.getElementById('header-busca-resultados').textContent.includes('Carregando')")
        self.page.wait_for_function("document.getElementById('header-busca-input').value === 'Cliente'")
        self.assertTrue(pendentes)
        pendentes.pop().fulfill(status=500, json={"mensagem": "Falha simulada"})
        self.page.get_by_text("Consulta incompleta", exact=True).wait_for()
        self.assertNotIn("Nenhum resultado.", self.page.locator("#header-busca-resultados").inner_text())
        self.page.get_by_role("button", name="Tentar novamente", exact=True).click()
        self.page.wait_for_timeout(100)
        pendentes.pop().fulfill(json={"clientes": [self.contact]})
        self.page.locator(".header-busca-resultado-item").filter(has_text="Cliente de teste").wait_for()
        self.assertEqual(self.page.locator("#header-busca-input").input_value(), "Cliente")
        self.page.locator("cds-search:has(+ #header-busca-input) input").press("Escape")
        self.assertTrue(self.page.locator("#header-busca-painel").is_hidden())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-busca-toggle")
        self.assertFalse(self.errors)

    def test_auditoria_integracoes_sem_acesso_http_e_resposta_invalida(self):
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-integracoes'))")
        self.assertEqual(self.page.locator("#integracao-google-status").inner_text(), "Acesso necessário")
        self.page.locator("#aba-acesso-botao").click()
        self.connect()
        resposta = {"status": 401, "json": {"mensagem": "Sem acesso"}}
        self.context.route("**/integracoes/status", lambda rota: rota.fulfill(**resposta))
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-integracoes'))")
        self.page.wait_for_function("document.getElementById('integracoes-resultado').textContent.includes('Acesso expirado')")
        for payload in ({"status": 500, "json": {}}, {"status": 200, "json": {}}, {"status": 200, "body": "invalido"}):
            resposta.clear(); resposta.update(payload)
            self.page.locator("#integracoes-atualizar").click()
            self.page.wait_for_function("document.getElementById('integracao-google-status').textContent === 'Falha na verificação'")
        resposta.clear(); resposta.update({"json": {"google": True, "asaas": False}})
        self.page.locator("#integracoes-atualizar").click()
        self.page.wait_for_function("document.getElementById('integracao-google-status').textContent === 'Configurado'")
        self.assertEqual(self.page.locator("#integracao-asaas-status").inner_text(), "Não configurado")
        self.assertFalse(self.errors)

    def test_auditoria_storage_falha_nao_favorita_e_recupera(self):
        self.page.evaluate("() => { window.setItemOriginal = Storage.prototype.setItem; Storage.prototype.setItem = function(){ throw new Error('quota'); }; }")
        self.assertFalse(self.page.evaluate("alternarFavorito('tjsp', '10006070420255020401')"))
        self.assertFalse(self.page.evaluate("ehFavorito('tjsp', '10006070420255020401')"))
        self.assertFalse(self.page.evaluate("alternarCasoFavorito('caso-1')"))
        self.assertIn("Não foi possível guardar", self.page.locator("#toast-global").inner_text())
        self.page.evaluate("() => { Storage.prototype.setItem = window.setItemOriginal; }")
        self.assertTrue(self.page.evaluate("alternarFavorito('tjsp', '10006070420255020401')"))
        self.page.reload()
        self.page.wait_for_function("typeof ehFavorito === 'function'")
        self.assertTrue(self.page.evaluate("ehFavorito('tjsp', '10006070420255020401')"))
        self.assertFalse(self.errors)

    def test_auditoria_grupos_repetiveis_rotulados_sem_ids_duplicados(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.page.evaluate("gruposContato.enderecos.definirValores([{rua:'Rua A'}, {rua:'Rua B'}]); gruposContato.emails.definirValores([{email:'a@example.test'}, {email:'b@example.test'}])")
        self.assertTrue(self.page.evaluate("[...document.querySelectorAll('.campo-repetivel input, .campo-repetivel select')].every(c => c.labels.length === 1 && c.labels[0].textContent.trim())"))
        self.assertTrue(self.page.evaluate("(() => { const ids = [...document.querySelectorAll('[id]')].map(c=>c.id); return ids.length === new Set(ids).size; })()"))
        grupos = self.page.locator("#contato-enderecos-lista [role=group]")
        self.assertEqual(grupos.count(), 2)
        self.assertEqual(grupos.nth(1).get_attribute("aria-labelledby"), grupos.nth(1).locator(".grupo-repetivel-titulo").get_attribute("id"))
        self.assertFalse(self.errors)

    def test_auditoria_menu_movel_e_alternador_teclado(self):
        self.connect()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.locator("#btn-menu-toggle").click()
        self.page.locator("#aba-casos-botao").click()
        self.page.wait_for_function("document.getElementById('btn-menu-toggle').getAttribute('aria-expanded') === 'false'")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "aba-casos")
        self.page.locator("#casos-vista-tabela-botao").focus()
        self.page.keyboard.press("End")
        self.assertEqual(self.page.locator("#casos-vista-cards-botao").get_attribute("aria-pressed"), "true")
        self.page.keyboard.press("Home")
        self.assertEqual(self.page.locator("#casos-vista-tabela-botao").get_attribute("aria-pressed"), "true")
        self.page.locator("#btn-menu-toggle").click()
        self.page.locator("#aba-casos-botao").focus()
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-menu-toggle")
        self.assertFalse(self.errors)

    def test_auditoria_atividades_agregadas_filtro_falha_e_conclusao(self):
        self.connect()
        casos = [{**self.case, "id": f"caso-{i}", "titulo": f"Processo {i}", "responsavel": "Ana" if i == 1 else "Bia"} for i in (1, 2, 3)]
        atividades = {str(i): [{"id": i, "titulo": f"Providência {i}", "tipo": "prazo" if i == 2 else "tarefa", "status": "pendente", "data": None}] for i in (1, 2, 3)}
        atividades['1'].append({"id": 9, "titulo": "Já concluída", "tipo": "tarefa", "status": "concluida"})
        falha = [True]
        self.context.route("**/casos", lambda rota: rota.fulfill(json={"casos": casos}))
        def responder(rota):
            i = rota.request.url.split('/caso-')[1].split('/')[0]
            if i == '3' and falha[0]:
                return rota.fulfill(status=500, json={"mensagem": "Falha simulada"})
            if rota.request.method == 'PATCH':
                atividades[i][0]['status'] = 'concluida'
                return rota.fulfill(json=atividades[i][0])
            rota.fulfill(json={"atividades": atividades[i]})
        self.context.route("**/casos/caso-*/atividades**", responder)
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-atividades'))")
        self.page.get_by_text("Lista incompleta", exact=True).wait_for()
        self.assertEqual(self.page.locator("#atividades-lista article").count(), 2)
        self.assertNotIn("Já concluída", self.page.locator("#atividades-lista").inner_text())
        self.page.locator("#atividades-tipo").select_option('prazo')
        self.assertEqual(self.page.locator("#atividades-lista article").count(), 1)
        self.page.locator("#atividades-tipo").select_option('')
        self.page.locator("#atividades-responsavel").select_option('Ana')
        self.page.get_by_role('button', name='Concluir atividade: Providência 1', exact=True).click()
        self.page.wait_for_function("!document.getElementById('atividades-lista').textContent.includes('Providência 1')")
        falha[0] = False
        self.page.locator("#atividades-responsavel").select_option('')
        self.page.locator("#atividades-atualizar").click()
        self.page.wait_for_function("document.getElementById('atividades-status').textContent.includes('Revisados 3')")
        self.assertEqual(self.page.locator("#atividades-lista article").count(), 2)
        self.assertFalse(self.errors)

    def test_auditoria_layout_atividades_e_enderecos_desktop_mobile(self):
        self.connect()
        pasta = Path(__file__).parent / 'output' / 'playwright' / 'auditoria-gtd'
        pasta.mkdir(parents=True, exist_ok=True)
        self.context.route('**/casos/caso-1/atividades', lambda rota: rota.fulfill(json={'atividades': [
            {'id': 1, 'titulo': 'Conferir intimação e registrar a providência necessária no processo ' + 'X' * 90, 'tipo': 'prazo', 'status': 'pendente', 'data': '2026-10-30'}]}))
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-atividades'))")
        self.page.locator('#atividades-lista article').wait_for()
        for largura in (1440, 390, 320):
            self.page.set_viewport_size({'width': largura, 'height': 900})
            self.page.wait_for_timeout(150)
            self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
            self.page.screenshot(path=str(pasta / f'atividades-{largura}.png'), full_page=True)
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.page.evaluate("gruposContato.enderecos.definirValores([{rua:'Rua de teste', numero:'123', cidade:'São Paulo'}, {rua:'Outro endereço', numero:'456'}])")
        for largura in (1440, 390):
            self.page.set_viewport_size({'width': largura, 'height': 900})
            self.page.wait_for_timeout(150)
            self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
            self.page.locator('#contato-enderecos-lista').screenshot(path=str(pasta / f'enderecos-{largura}.png'))
        self.assertFalse(self.errors)

    def test_auditoria_publicacao_atividade_falha_persistencia_e_origem(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]['caso_id'] = 'caso-1'
        self.pub_oab_items[0]['dados'] = {'texto': 'Texto integral da publicação de teste'}
        salvas = []
        falha = [True]
        def responder(rota):
            if rota.request.method == 'POST':
                if falha[0]:
                    return rota.fulfill(status=500, json={'mensagem': 'Falha simulada'})
                salvas.append({**rota.request.post_data_json, 'id': 42, 'status': 'pendente'})
                return rota.fulfill(json=salvas[-1])
            rota.fulfill(json={'atividades': salvas})
        self.context.route('**/casos/caso-1/atividades', responder)
        self.context.route('**/casos/caso-1/publicacoes', lambda rota: rota.fulfill(json={'publicacoes': self.pub_oab_items[:1]}))
        self.page.evaluate('carregarPublicacoesOab()')
        self.page.locator('.pub-oab-tabela').wait_for()
        self.page.locator('.pub-oab-tabela .cds--menu-button__trigger').first.click()
        self.page.get_by_role('menuitem', name='Criar Atividade', exact=True).click()
        self.page.locator('#atividade-titulo').fill('Conferir intimação')
        self.page.locator('#atividade-observacoes').fill('Verificar providência necessária')
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.get_by_text('Falha simulada', exact=True).wait_for()
        self.assertEqual(self.page.locator('#atividade-titulo').input_value(), 'Conferir intimação')
        self.assertEqual(len(salvas), 0)
        self.assertEqual(len(self.pub_oab_posts), 0)
        falha[0] = False
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.get_by_role('button', name='Ver publicação de origem', exact=True).wait_for()
        self.assertIn('Publicação de origem (DJEN): pub-1', salvas[0]['observacoes'])
        self.assertEqual(len(self.pub_oab_posts), 0)
        self.page.reload()
        self.page.wait_for_function("typeof abrirCaso === 'function'")
        self.page.locator("#aba-acesso-botao").click()
        self.open_case()
        self.page.locator('#caso-subaba-atividades-botao').click()
        self.page.get_by_role('button', name='Ver publicação de origem', exact=True).click()
        self.page.get_by_text('Texto integral da publicação de teste', exact=True).wait_for()
        self.assertFalse(self.errors)


    def test_tema_persistencia_teclado_e_sincronizacao_entre_paginas(self):
        self.page.get_by_role("switch", name="Tema", exact=True).wait_for()
        self.assertEqual(self.page.locator("html").get_attribute("data-carbon-theme"), "white")
        segunda = self.context.new_page()
        segunda.goto(self.url)
        segunda.get_by_role("switch", name="Tema", exact=True).wait_for()
        self.page.get_by_role("switch", name="Tema", exact=True).focus()
        self.page.keyboard.press("Space")
        self.page.wait_for_function("document.documentElement.dataset.carbonTheme === 'g100'")
        segunda.wait_for_function("document.documentElement.dataset.carbonTheme === 'g100'")
        self.assertEqual(self.page.evaluate("getComputedStyle(document.body).backgroundColor"), "rgb(22, 22, 22)")
        self.page.reload()
        self.page.get_by_role("switch", name="Tema", exact=True).wait_for()
        self.assertEqual(self.page.get_by_role("switch", name="Tema", exact=True).get_attribute("aria-checked"), "true")
        self.page.locator("#tema-interface label").click()
        self.page.wait_for_function("document.documentElement.dataset.carbonTheme === 'white'")
        self.assertFalse(self.errors)

    def test_tema_armazenamento_indisponivel_mantem_interface_funcional(self):
        self.context.add_init_script("""(() => {
          const ler = Storage.prototype.getItem, guardar = Storage.prototype.setItem;
          Storage.prototype.getItem = function(k) { if(k === 'cnj_tema') throw new Error('bloqueado'); return ler.call(this,k); };
          Storage.prototype.setItem = function(k,v) { if(k === 'cnj_tema') throw new Error('bloqueado'); return guardar.call(this,k,v); };
        })()""")
        self.page.reload()
        self.page.locator("#tema-interface label").click()
        self.page.wait_for_function("document.documentElement.dataset.carbonTheme === 'g100'")
        self.assertIn("Não foi possível lembrar", self.page.locator("#theme-status").inner_text())
        self.page.reload()
        self.page.get_by_role("switch", name="Tema", exact=True).wait_for()
        self.assertEqual(self.page.locator("html").get_attribute("data-carbon-theme"), "white")
        self.assertFalse(self.errors)

    def test_tema_cobre_paginas_publicas_admin_e_autorizacao(self):
        import server
        from unittest.mock import Mock
        paginas = {
            '/guia': (Path(__file__).parent / 'guia-do-usuario.html').read_text(encoding='utf-8'),
            '/documentacao': (Path(__file__).parent / 'documentacao-funcionalidades.html').read_text(encoding='utf-8'),
            '/cadastro': server._pagina_cadastro(),
            '/termos': server._pagina_termos(),
            '/oauth/authorize': server._pagina_autorizacao({}),
            '/admin': server._pagina_admin(Mock(), None),
        }
        self.context.add_init_script("localStorage.setItem('cnj_tema', 'g100'); document.addEventListener('DOMContentLoaded', () => {window.temaInicial = document.documentElement.dataset.carbonTheme;});")
        base = self.url.split('/static/')[0]
        pasta = Path(__file__).parent / 'output' / 'playwright' / 'temas'
        pasta.mkdir(parents=True, exist_ok=True)
        for caminho, html in paginas.items():
            self.context.route('**' + caminho, lambda rota, request, html=html: rota.fulfill(content_type='text/html', body=html))
            self.page.goto(base + caminho)
            self.page.get_by_role("switch", name="Tema", exact=True).wait_for()
            with self.subTest(pagina=caminho):
                self.assertEqual(self.page.evaluate('window.temaInicial'), 'g100')
                self.assertEqual(self.page.evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(22, 22, 22)')
                self.assertEqual(self.page.get_by_role("switch", name="Tema", exact=True).get_attribute('aria-checked'), 'true')
                if caminho in ('/cadastro', '/admin', '/guia'):
                    self.page.screenshot(path=str(pasta / (caminho.strip('/') + '-g100.png')))
        self.assertFalse(self.errors)

    def test_tema_shell_responsivo_tabela_e_formulario_escuros(self):
        pasta = Path(__file__).parent / 'output' / 'playwright' / 'temas'
        pasta.mkdir(parents=True, exist_ok=True)
        self.open_publicacoes_oab()
        self.page.locator("#tema-interface label").click()
        self.page.wait_for_function("document.documentElement.dataset.carbonTheme === 'g100'")
        self.assertEqual(self.page.locator('cds-table').evaluate("e => getComputedStyle(e).getPropertyValue('--cds-background').trim()"), '#161616')
        for largura in (1440, 768, 390, 320):
            self.page.set_viewport_size({'width': largura, 'height': 960})
            self.page.wait_for_timeout(150)
            self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
            for seletor in ('cds-toggle#tema-interface', '#aba-acesso-botao'):
                rect = self.page.locator(seletor).bounding_box()
                self.assertGreaterEqual(rect['x'], 0)
                self.assertLessEqual(rect['x'] + rect['width'], largura + 1)
            if largura in (1440, 390): self.page.screenshot(path=str(pasta / f'publicacoes-g100-{largura}.png'))
        self.page.set_viewport_size({'width':1440,'height':960})
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.assertEqual(self.page.locator('#contato-nome').evaluate('e => getComputedStyle(e).color'), 'rgb(244, 244, 244)')
        self.page.screenshot(path=str(pasta / 'cliente-g100.png'))
        self.page.locator("#tema-interface label").click()
        self.page.screenshot(path=str(pasta / 'cliente-white.png'))
        self.assertFalse(self.errors)


if __name__ == "__main__":
    unittest.main()
