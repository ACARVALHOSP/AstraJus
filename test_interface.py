"""Regressões do painel, offline: python -m unittest test_interface -v.

Requer Playwright e Chromium instalados. APIs são interceptadas; nenhum token real é usado.
"""
import os
import re
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

    def test_contatos_filtros_acentos_telefone_e_recuperacao(self):
        self.connect()
        self.page.locator("#aba-contatos-botao").click()
        self.page.wait_for_selector(".contato-nome-link")
        self.page.evaluate("""() => {
            _cache.clientes = [
                {id:'cliente-1', nome:'Álvaro Nunes', tipo_pessoa:'fisica', telefone:'(11) 99999-0000', email:'alvaro@example.com'},
                {id:'cliente-2', nome:'Beta Ltda', tipo_pessoa:'juridica'},
                {id:'cliente-3', nome:'李明'}
            ];
            renderizarListaContatos();
        }""")
        self.assertEqual(self.page.locator("[data-selecionar-cliente]").count(), 3)
        self.assertEqual(self.page.locator(".contatos-tabela th").all_text_contents(), ["", "Nome", "Tipo", "Perfil", "Telefone", "E-mail", "Etiquetas", "Ações"])
        self.assertEqual(self.page.locator('a[href="tel:11999990000"]').count(), 1)
        self.assertEqual(self.page.locator('a[href="mailto:alvaro%40example.com"]').count(), 1)
        self.assertIn("Pessoa jurídica", self.page.locator(".contatos-tabela").inner_text())
        self.assertIn("李明", self.page.locator(".contatos-tabela").inner_text())
        self.page.locator("#contatos-az").get_by_role("button", name="A", exact=True).click()
        self.page.locator("cds-search:has(+ #contatos-busca) input").fill("alvaro")
        self.assertEqual(self.page.locator(".contato-nome-link").all_text_contents(), ["Álvaro Nunes"])
        self.page.locator("#contatos-az").get_by_role("button", name="B", exact=True).click()
        self.assertIn("Nenhum cliente corresponde", self.page.locator("#lista-contatos").inner_text())
        self.assertIn("Inicial: B", self.page.locator("#contatos-status").inner_text())
        self.assertIn("alvaro", self.page.locator("#contatos-status").inner_text())
        self.page.locator("#contatos-limpar-filtros").click()
        self.assertEqual(self.page.locator(".contato-nome-link").count(), 3)
        self.assertEqual(self.page.locator("#contatos-busca").input_value(), "")
        self.page.locator("cds-search:has(+ #contatos-busca) input").fill("11999990000")
        self.assertEqual(self.page.locator(".contato-nome-link").all_text_contents(), ["Álvaro Nunes"])
        self.assertFalse(self.errors)

    def test_contato_falha_preserva_edicao_e_salvar_restabelece_retorno(self):
        self.connect()
        self.page.locator("#aba-contatos-botao").click()
        self.page.locator(".contato-nome-link").click()
        self.page.wait_for_function("document.getElementById('contato-nome').value === 'Cliente de teste'")
        self.page.locator("#contato-nome").fill("Cliente atualizado")
        self.fail_save = True
        self.page.locator("#contato-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("document.getElementById('resultado-contato-cadastro').textContent.includes('Falha simulada')")
        self.assertTrue(self.page.locator("#contatos-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#contato-nome").input_value(), "Cliente atualizado")
        self.fail_save = False
        self.page.locator("#contato-voltar").click()
        self.choose("salvar")
        self.page.wait_for_selector("#contatos-vista-lista", state="visible")
        self.assertEqual(self.contact["nome"], "Cliente atualizado")
        self.assertEqual(self.page.evaluate("document.activeElement.dataset.clienteId"), "cliente-1")
        self.assertFalse(self.errors)

    def test_contatos_abas_teclado_e_retorno_foco(self):
        self.connect()
        self.page.locator("#aba-contatos-botao").click()
        self.page.locator(".contato-nome-link").click()
        self.page.wait_for_function("document.getElementById('contato-detalhe-nome').textContent === 'Cliente De Teste'")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "contato-detalhe-nome")
        self.page.locator("#contato-subaba-cadastro-botao").focus()
        self.page.keyboard.press("ArrowRight")
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "contato-subaba-processos-botao")
        self.assertEqual(self.page.locator("#contato-subaba-processos-botao").get_attribute("aria-selected"), "true")
        self.page.keyboard.press("Home")
        self.page.locator("#contato-cadastro-aba-pessoal-botao").focus()
        self.page.keyboard.press("ArrowRight")
        self.assertTrue(self.page.locator("#contato-cadastro-painel-documentacao").is_visible())
        self.page.keyboard.press("End")
        self.assertTrue(self.page.locator("#contato-cadastro-painel-complementar").is_visible())
        self.page.keyboard.press("Home")
        self.page.locator("#contato-voltar").click()
        self.assertEqual(self.page.evaluate("document.activeElement.dataset.clienteId"), "cliente-1")
        self.assertFalse(self.errors)

    def test_dropdowns_de_duas_opcoes_usam_radios_e_preservam_valor(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirNovoContato(); }")
        self.select_value(self.page.locator("#contato-tipo-pessoa"), "juridica")
        self.assertTrue(self.page.locator('cds-radio-button-group[data-select-id="contato-tipo-pessoa"]').is_visible())
        self.assertEqual(self.page.locator("#contato-cpf-cnpj-label").text_content(), "CNPJ")

    def test_nova_atividade_modal_e_confirmacao_sobreposta(self):
        self.open_case()
        self.page.evaluate("() => _abrirModalAtividade('caso-1')")
        modal = self.page.locator("#modal-atividade")
        self.assertEqual(modal.evaluate("el => el.tagName"), "CDS-MODAL")
        self.page.locator("#atividade-titulo").fill("Atividade de teste")
        modal.get_by_role("button", name="Cancelar", exact=True).click()
        confirmacao = self.page.locator("#modal-edicao-pendente")
        self.page.wait_for_selector("#modal-edicao-pendente.is-visible")
        self.assertTrue(modal.evaluate("el => el.inert"))
        self.assertGreater(int(confirmacao.evaluate("el => el.style.zIndex")), int(modal.evaluate("el => el.style.zIndex")))
        self.choose("continuar")
        self.assertFalse(modal.evaluate("el => el.inert"))
        self.assertEqual(self.page.locator("#atividade-titulo").input_value(), "Atividade de teste")
        modal.get_by_role("button", name="Cancelar", exact=True).click()
        self.choose("descartar")
        self.assertFalse(modal.evaluate("el => el.open"))

    def test_progresso_indeterminado_aguarda_todas_operacoes(self):
        self.connect()
        self.page.evaluate("() => { window.fimA = cnjUI.iniciar('Consulta A'); window.fimB = cnjUI.iniciar('Consulta B'); }")
        progress = self.page.locator(".app-progresso-global cds-progress-bar").last
        self.assertFalse(progress.evaluate("el => el.value != null"))
        self.page.evaluate("() => window.fimA()")
        self.assertEqual(progress.evaluate("el => el.status"), "active")
        self.page.evaluate("() => window.fimB(true)")
        self.assertEqual(progress.evaluate("el => el.status"), "error")
        self.assertFalse(self.page.locator(".espera-spinner").count())

    def test_progresso_falha_retornada_e_relacoes_acessiveis(self):
        self.connect()
        self.page.evaluate("""async () => {
          const regiao = document.createElement('section');
          regiao.id = 'regiao-teste-progresso';
          regiao.setAttribute('aria-describedby', 'ajuda-original');
          document.body.append(regiao);
          await cnjUI.executar(async () => ({ok:false, mensagem:'Falha de rede'}), 'Consultando CEP', regiao);
        }""")
        barra = self.page.locator('.app-progresso-global cds-progress-bar').last
        self.assertEqual(barra.get_attribute('status'), 'error')
        self.assertTrue(barra.get_by_role('progressbar', name='Consultando CEP', exact=True).is_visible())
        self.assertIn('Falha de rede', barra.get_by_role('status').inner_text())
        self.assertNotIn('Loading', barra.inner_text())
        self.assertFalse(self.page.locator('#regiao-teste-progresso').get_attribute('aria-busy'))
        self.assertIn('ajuda-original progresso-', self.page.locator('#regiao-teste-progresso').get_attribute('aria-describedby'))
        self.assertLessEqual(barra.bounding_box()['width'], 480)

    def test_progresso_reutilizado_preserva_renderizacao_lit(self):
        self.connect()
        self.page.evaluate("""async () => {
          await customElements.whenDefined('cds-progress-bar');
          const regiao = document.createElement('section');
          regiao.id = 'regiao-reuso-progresso';
          document.body.append(regiao);
          for (let i = 0; i < 4; i++) {
            const fim = cnjUI.iniciar('Operação ' + i, regiao);
            const barra = regiao.previousElementSibling.querySelector('cds-progress-bar');
            await barra.updateComplete;
            fim(i === 1, 'Falha temporária');
            await barra.updateComplete;
          }
        }""")
        barra = self.page.locator('#regiao-reuso-progresso').locator('xpath=preceding-sibling::*[1]').locator('cds-progress-bar')
        self.assertEqual(barra.get_attribute('status'), 'finished')
        self.assertIn('Operação concluída', barra.get_by_role('status').inner_text())
        self.assertFalse(self.errors)

    def test_notificacoes_abertas_reposicionam_ao_redimensionar(self):
        self.connect()
        self.page.locator('#btn-notificacoes-toggle').click()
        for width in (1440, 320, 768, 390, 1440):
            self.page.set_viewport_size({'width': width, 'height': 960})
            self.page.wait_for_timeout(350)
            painel = self.page.locator('#header-notificacoes-painel')
            self.assertTrue(painel.is_visible())
            rect = painel.bounding_box()
            self.assertGreaterEqual(rect['x'], 0)
            self.assertLessEqual(rect['x'] + rect['width'], width)
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.locator('#header-notificacoes-painel').is_hidden())
        self.assertFalse(self.errors)

    def select_value(self, native, value):
        """Escolhe no controle Carbon e confere o valor legado usado pelos handlers."""
        if native.input_value() == value:
            return
        label = native.evaluate("(el, value) => [...el.options].find(o => o.value === value).textContent", value)
        host = native.locator("xpath=preceding-sibling::*[1]")
        if host.evaluate("el => el.tagName") == "CDS-RADIO-BUTTON-GROUP":
            host.get_by_text(label, exact=True).click()
        else:
            host.get_by_role("combobox").click()
            host.get_by_role("option", name=label, exact=True).click()
        self.assertEqual(native.input_value(), value)

    def open_case(self):
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-casos')); await abrirCaso('caso-1'); }")

    def open_painel_prazo(self, preparar):
        self.connect()
        self.page.evaluate("""() => {
          window.consultasFeriados = [];
          cliente.chamarTool = async (nome, parametros) => {
            consultasFeriados.push({nome, parametros});
            return {feriados: []};
          };
        }""")
        self.page.evaluate(preparar)
        self.page.evaluate("""() => {
          const painel = painelCalculoPrazo({data_disponibilizacao:'2026-10-23', siglaTribunal:'TJSP'});
          painel.hidden = false;
          document.querySelector('.app-corpo').appendChild(painel);
        }""")
        return self.page.locator('.prazo-painel')

    def test_prazo_storage_leitura_bloqueada_usa_padrao_e_calcula(self):
        painel = self.open_painel_prazo("""() => {
          const ler = Storage.prototype.getItem;
          Storage.prototype.getItem = function(chave) {
            if (chave === 'cnj_prazo_municipio') throw new DOMException('Bloqueado', 'SecurityError');
            return ler.call(this, chave);
          };
        }""")
        municipio = painel.get_by_label('Município/comarca', exact=True)
        self.assertEqual(municipio.input_value(), 'São Paulo')
        self.assertIn('Não foi possível ler', painel.locator('.prazo-preferencia-status').inner_text())
        municipio.fill('Campinas')
        painel.get_by_label('Dias', exact=True).fill('7')
        painel.get_by_role('button', name='Calcular', exact=True).click()
        self.page.wait_for_function("document.querySelector('.prazo-resultado').textContent.includes('Vencimento:')")
        consultas = self.page.evaluate('consultasFeriados')
        self.assertEqual(len(consultas), 2)
        self.assertTrue(all(c['nome'] == 'buscar_feriados_forenses' and c['parametros']['municipio'] == 'Campinas' for c in consultas))
        self.assertEqual(municipio.input_value(), 'Campinas')
        self.assertEqual(painel.get_by_label('Dias', exact=True).input_value(), '7')
        self.assertTrue(painel.get_by_role('button', name='Calcular', exact=True).is_enabled())
        self.assertFalse(self.errors)

    def test_prazo_storage_gravacao_bloqueada_calcula_e_recupera(self):
        painel = self.open_painel_prazo("""() => {
          localStorage.setItem('cnj_prazo_municipio', 'Santos');
          window.gravarPrazoOriginal = Storage.prototype.setItem;
          Storage.prototype.setItem = function(chave, valor) {
            if (chave === 'cnj_prazo_municipio') throw new DOMException('Sem espaço', 'QuotaExceededError');
            return gravarPrazoOriginal.call(this, chave, valor);
          };
        }""")
        municipio = painel.get_by_label('Município/comarca', exact=True)
        self.assertEqual(municipio.input_value(), 'Santos')
        municipio.fill('Campinas')
        painel.get_by_label('Dias', exact=True).fill('4')
        calcular = painel.get_by_role('button', name='Calcular', exact=True)
        calcular.click()
        self.page.wait_for_function("document.querySelector('.prazo-resultado').textContent.includes('Vencimento:')")
        self.assertIn('Não foi possível lembrar', painel.locator('.prazo-preferencia-status').inner_text())
        self.assertEqual(self.page.evaluate("localStorage.getItem('cnj_prazo_municipio')"), 'Santos')
        self.assertEqual(municipio.input_value(), 'Campinas')
        self.assertIn('Campinas', painel.locator('.prazo-resultado').inner_text())
        self.assertTrue(all(c['parametros']['municipio'] == 'Campinas' for c in self.page.evaluate('consultasFeriados')))
        self.page.evaluate('() => { Storage.prototype.setItem = gravarPrazoOriginal; }')
        calcular.click()
        self.page.wait_for_function("localStorage.getItem('cnj_prazo_municipio') === 'Campinas'")
        self.assertFalse(painel.locator('.prazo-preferencia-status').is_visible())
        self.assertTrue(calcular.is_enabled())
        self.assertFalse(self.errors)

    def test_prazo_storage_indisponivel_nao_mascara_erro_de_calculo(self):
        painel = self.open_painel_prazo("""() => {
          Object.defineProperty(window, 'localStorage', {configurable:true, get() { throw new DOMException('Bloqueado', 'SecurityError'); }});
          cliente.chamarTool = async () => { throw new Error('Falha simulada na consulta de feriados.'); };
        }""")
        municipio = painel.get_by_label('Município/comarca', exact=True)
        municipio.fill('Campinas')
        calcular = painel.get_by_role('button', name='Calcular', exact=True)
        calcular.click()
        self.page.wait_for_function("document.querySelector('.prazo-resultado').textContent.includes('Falha simulada')")
        self.assertIn('Não foi possível lembrar', painel.locator('.prazo-preferencia-status').inner_text())
        self.assertNotIn('Vencimento:', painel.locator('.prazo-resultado').inner_text())
        self.assertEqual(municipio.input_value(), 'Campinas')
        self.assertTrue(calcular.is_enabled())
        self.assertFalse(self.errors)

    def test_prazo_rotulos_associados_e_foco_independente_entre_paineis(self):
        self.page.evaluate("""() => {
          for (let i = 0; i < 2; i++) {
            const painel = painelCalculoPrazo({data_disponibilizacao:'2026-10-23', siglaTribunal:'TJSP'});
            painel.hidden = false;
            document.querySelector('.app-corpo').appendChild(painel);
          }
        }""")
        paineis = self.page.locator('.prazo-painel')
        self.assertEqual(paineis.count(), 2)
        ids = paineis.locator('input, select').evaluate_all("campos => campos.map(c => c.id)")
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(ids))
        for i in range(2):
            painel = paineis.nth(i)
            self.assertEqual(painel.get_by_role('spinbutton', name='Dias', exact=True).count(), 1)
            self.assertEqual(painel.get_by_role('combobox', name='Contagem a partir de', exact=True).count(), 1)
            self.assertEqual(painel.get_by_role('textbox', name='Município/comarca', exact=True).count(), 1)
            for rotulo in painel.locator('label[for]').all():
                if not rotulo.evaluate("label => label.getRootNode() === document && label.getClientRects().length > 0"):
                    continue  # O label legado é substituído pelo label público Carbon.
                rotulo.click()
                self.assertTrue(rotulo.evaluate("label => document.activeElement === document.getElementById(label.htmlFor)"))
            dias = painel.get_by_label('Dias', exact=True)
            dias.focus()
            dias.press('Tab')
            self.assertTrue(painel.get_by_role('combobox', name='Contagem a partir de', exact=True).evaluate("el => el.getRootNode().activeElement === el"))
            self.page.keyboard.press('Tab')
            self.assertTrue(painel.get_by_label('Município/comarca', exact=True).evaluate("el => el === document.activeElement"))
        paineis.nth(1).get_by_label('Dias', exact=True).fill('7')
        self.assertEqual(paineis.nth(0).get_by_label('Dias', exact=True).input_value(), '15')
        self.assertEqual(paineis.nth(1).get_by_label('Dias', exact=True).input_value(), '7')
        self.assertFalse(self.errors)

    def test_grid_tokens_nomes_e_capitalizacao_de_interface(self):
        self.case["titulo"] = "AÇÃO DE MARIA DA SILVA"
        self.contact["nome"] = "MARIA DA SILVA"
        self.open_case()
        self.assertEqual(self.page.locator("#caso-detalhe-titulo").inner_text(), "Ação De Maria Da Silva")
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.assertEqual(self.page.locator("#contato-detalhe-nome").inner_text(), "Maria Da Silva")
        self.assertEqual(self.page.locator("#contato-nome").input_value(), "MARIA DA SILVA")
        for largura in (320, 390, 672, 768, 1056, 1312, 1440, 1584):
            for tema in ("white", "g100"):
                self.page.set_viewport_size({"width": largura, "height": 1000})
                self.page.evaluate("tema => window.AstraJusTema.aplicar(tema)", tema)
                medidas = self.page.locator(".cadastro-painel:not([hidden])").evaluate("el => { const s = getComputedStyle(el); return {colunas: s.gridTemplateColumns.split(' ').length, gap: s.columnGap}; }")
                self.assertEqual(medidas["colunas"], 4 if largura < 672 else 8 if largura < 1056 else 16)
                self.assertEqual(medidas["gap"], "16px")
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (largura, tema))
        fonte = self.page.locator("#contato-detalhe-nome").evaluate("el => getComputedStyle(el).fontSize")
        self.assertEqual(fonte, "28px")
        if os.environ.get("AUDIT_SCREENSHOTS"):
            destino = Path(os.environ["AUDIT_SCREENSHOTS"])
            destino.mkdir(parents=True, exist_ok=True)
            for largura in (390, 1440):
                for tema in ("white", "g100"):
                    self.page.set_viewport_size({"width": largura, "height": 1000})
                    self.page.evaluate("tema => window.AstraJusTema.aplicar(tema)", tema)
                    self.page.screenshot(path=str(destino / f"cadastro-{tema}-{largura}.png"), full_page=True)
        self.assertFalse(self.errors)

    def test_grid_publicacoes_preserva_dados_nomes_e_tabela_m(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]["dados"] = {"siglaTribunal": "tjsp", "texto": "TEXTO original: NÃO ALTERAR.",
            "destinatarios": [{"nome": "MARIA DA SILVA", "polo": "A"}, {"nome": "BANCO EXEMPLO", "polo": "P"}]}
        self.page.evaluate("carregarPublicacoesOab()")
        row = self.page.locator(".pub-oab-linha").first
        self.assertEqual(row.locator('.pub-oab-nome-processo').text_content(), "Maria Da Silva X Banco Exemplo")
        self.assertEqual(row.locator('[data-coluna]:not([hidden])').count(), 3)
        self.assertEqual(self.page.evaluate("_valorPubOab('DESPACHO')"), "Despacho")
        self.assertEqual(self.page.evaluate("_valorPubOab('aBc-ID/OAB', true)"), "aBc-ID/OAB")
        self.assertEqual(self.page.evaluate("_valorPubOab({nome:'MARIA DA SILVA', uf_oab:'SP', numero_oab:'0123'})"),
                         "Nome: Maria Da Silva; UF da OAB: SP; Número da OAB: 0123")
        self.assertEqual(self.page.locator('.pub-oab-tabela-contagem').inner_text(), "2 publicações")
        for largura in (320, 390, 672, 768, 1056, 1312, 1440, 1584):
            for tema in ("white", "g100"):
                self.page.set_viewport_size({"width": largura, "height": 1000})
                self.page.evaluate("tema => window.AstraJusTema.aplicar(tema)", tema)
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (largura, tema))
                self.assertEqual(row.evaluate("el => el.getBoundingClientRect().height"), 40)
                if os.environ.get("AUDIT_SCREENSHOTS") and largura in (390, 1440):
                    destino = Path(os.environ["AUDIT_SCREENSHOTS"])
                    destino.mkdir(parents=True, exist_ok=True)
                    self.page.screenshot(path=str(destino / f"publicacoes-{tema}-{largura}.png"), full_page=True)
        self.assertFalse(self.errors)

    def test_rotulos_djen_separados_dos_nomes_e_preferencias_preservadas(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]["dados"] = {"dataDaCaptura": "2026-10-25", "URLDocumento": "https://example.test/AbC"}
        self.page.evaluate("carregarPublicacoesOab()")
        self.page.locator('.pub-oab-tabela').wait_for()
        self.assertEqual(self.page.evaluate("_rotuloCampoDjen('dataDaCaptura')"), "Data da captura")
        self.assertEqual(self.page.evaluate("_rotuloCampoDjen('URLDocumento')"), "URL documento")
        self.assertEqual(self.page.evaluate("_rotuloCampoDjen('numeroOAB')"), "Numero OAB")
        self.assertEqual(self.page.evaluate("formatarNomeExibicao('MARIA DA SILVA')"), "Maria Da Silva")
        self.page.locator('.pub-oab-colunas button').click()
        self.assertTrue(self.page.locator('.pub-oab-colunas').get_by_label('Data da captura', exact=True).is_visible())
        self.assertTrue(self.page.locator('.pub-oab-colunas').get_by_label('URL documento', exact=True).is_visible())
        self.page.locator('.pub-oab-colunas button').press('Escape')
        chave = 'cnj_pub_oab_colunas_visiveis_v2'
        preferencia = '["capturado","djen:dataDaCaptura","campo-antigo"]'
        self.page.evaluate("([chave, valor]) => localStorage.setItem(chave, valor)", [chave, preferencia])
        self.page.evaluate("carregarPublicacoesOab()")
        self.page.locator('cds-table-header-cell[data-coluna="capturado"]:visible').wait_for()
        self.assertTrue(self.page.locator('cds-table-header-cell[data-coluna="djen:dataDaCaptura"]').is_visible())
        self.assertEqual(self.page.locator('.pub-oab-linha').first.locator('[data-coluna]:not([hidden])').count(), 5)
        self.assertEqual(self.page.evaluate("chave => localStorage.getItem(chave)", chave), preferencia)
        self.assertEqual(self.page.locator('.pub-oab-linha').first.locator('[data-coluna="djen:dataDaCaptura"]').text_content(), "2026-10-25")
        self.assertFalse(self.errors)

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

    def test_publicacoes_calendario_filtra_recolhe_e_reabre_com_ultimas(self):
        self.open_publicacoes_oab()
        self.page.evaluate("_pubOabMes = '2026-10'; _pubOabDatas = {'2026-10-28': 2}; _renderizarCalendarioPubOab()")
        with self.page.expect_request(lambda req: '/publicacoes-oab?' in req.url and 'data=2026-10-28' in req.url):
            self.page.locator('#pub-oab-calendario button[data-publicacoes]').click()
        self.page.wait_for_function("!_pubOabCarregando")
        self.assertIn('28/10/2026', self.page.locator('#pub-oab-periodo').inner_text())
        self.assertEqual(self.page.evaluate('_pubOabData'), '2026-10-28')
        self.page.locator('#pub-oab-calendario-toggle').click()
        self.assertFalse(self.page.locator('#pub-oab-calendario-painel').is_visible())
        self.page.locator('#pub-oab-calendario-toggle').click()
        self.assertTrue(self.page.locator('#pub-oab-calendario-painel').is_visible())
        self.page.locator('#pub-oab-ultimas').click()
        self.page.wait_for_function("!_pubOabCarregando")
        self.assertEqual(self.page.locator('#pub-oab-periodo').inner_text(), 'Últimas publicações')
        self.page.evaluate("_pubOabData='2026-10-23'; _pubOabPagina=3")
        self.page.locator('#aba-contatos-botao').click()
        self.page.locator('#aba-publicacoes-oab-botao').click()
        self.page.wait_for_function("!_pubOabCarregando")
        self.assertEqual(self.page.evaluate('[_pubOabData, _pubOabPagina]'), ['', 1])
        self.page.set_viewport_size({'width':390, 'height':844})
        self.assertLessEqual(self.page.locator('#pub-oab-calendario-painel').bounding_box()['width'], 390)
        self.assertFalse(self.errors)

    def test_dt01_lote_fecha_menu_e_bloqueia_acoes_de_linha(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[0]['dados']['link'] = 'https://example.test/publicacao'
        self.page.evaluate('carregarPublicacoesOab()')
        self.page.wait_for_function('!_pubOabCarregando')
        self.page.locator('.pub-oab-overflow').last.click()
        self.assertTrue(self.page.locator('.pub-oab-combo-menu:popover-open').is_visible())
        self.page.locator('input[data-publicacao-hash]').first.check()
        self.assertEqual(self.page.locator('.pub-oab-combo-menu:popover-open').count(), 0)
        self.assertTrue(self.page.locator('[data-pub-oab-acao]').evaluate_all('els => els.every(el => el.disabled)'))
        self.assertTrue(self.page.locator('[data-pub-oab-acao]').evaluate_all('els => els.every(el => el.inert)'))
        self.page.locator('.pub-oab-overflow').last.evaluate("el => el.dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        self.assertEqual(self.page.locator('.pub-oab-combo-menu:popover-open').count(), 0)
        self.assertTrue(self.page.locator('#pub-oab-marcar-tratada').is_enabled())
        self.page.locator('[data-cancelar-lote]').click()
        self.assertTrue(self.page.locator('[data-pub-oab-acao]').evaluate_all('els => els.every(el => !el.disabled)'))
        self.assertFalse(self.errors)

    def test_dt01_formulario_pausado_preserva_valores_e_retorna(self):
        self.open_publicacoes_oab()
        self.page.locator('.pub-oab-overflow').first.click()
        self.page.get_by_role('menuitem', name='Vincular a processo existente', exact=True).click()
        form = self.page.locator('.pub-oab-inline-form')
        campo = form.locator('cds-search input')
        campo.fill('Caso')
        form.get_by_role('button', name='Caso De Teste', exact=False).click()
        confirmar = form.get_by_role('button', name='Confirmar vínculo', exact=True)
        self.page.locator('input[data-publicacao-hash]').last.check()
        self.assertTrue(form.evaluate('el => el.inert'))
        self.assertTrue(self.page.locator('.pub-oab-inline-suspensao').is_visible())
        form.evaluate("el => el.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))")
        self.assertFalse(any(m == 'POST' and p.endswith('/publicacoes') for m, p in self.requests))
        self.page.locator('[data-cancelar-lote]').click()
        self.assertFalse(form.evaluate('el => el.inert'))
        self.assertEqual(campo.input_value(), 'Caso')
        self.assertTrue(confirmar.is_enabled())
        confirmar.click()
        self.page.wait_for_function('!_pubOabInlineEnviando && !_pubOabCarregando')
        self.assertTrue(any(m == 'POST' and p.endswith('/publicacoes') for m, p in self.requests))
        self.assertFalse(self.errors)

    def test_dt01_envio_inline_bloqueia_selecao_e_lote_ate_falha(self):
        self.open_publicacoes_oab()
        self.page.locator('.pub-oab-overflow').first.click()
        self.page.get_by_role('menuitem', name='Vincular a processo existente', exact=True).click()
        form = self.page.locator('.pub-oab-inline-form')
        form.locator('cds-search input').fill('Caso')
        form.get_by_role('button', name='Caso De Teste', exact=False).click()
        pendentes = []
        self.context.route('**/casos/caso-1/publicacoes', lambda route: pendentes.append(route))
        form.get_by_role('button', name='Confirmar vínculo', exact=True).click()
        self.page.wait_for_function('_pubOabInlineEnviando')
        self.assertTrue(self.page.locator('input[data-publicacao-hash]').evaluate_all('els => els.every(el => el.disabled)'))
        self.page.evaluate("_aplicarStatusPubOab(['pub-2'], 'tratada')")
        self.assertEqual(self.pub_oab_posts, [])
        self.assertEqual(len(pendentes), 1)
        pendentes[0].fulfill(status=500, json={'mensagem': 'Falha simulada. Tente novamente.'})
        self.page.wait_for_function('!_pubOabInlineEnviando')
        self.assertTrue(form.get_by_role('button', name='Confirmar vínculo', exact=True).is_enabled())
        self.assertTrue(self.page.locator('input[data-publicacao-hash]').evaluate_all('els => els.every(el => !el.disabled)'))
        self.assertEqual(form.locator('cds-search input').input_value(), 'Caso')
        self.assertFalse(self.errors)

    def test_dt02_dt03_dt04_ordem_alturas_cabecalho_longo_e_temas(self):
        self.open_publicacoes_oab()
        chave = 'informacoesComplementaresRecebidasNaCapturaDaPublicacaoComNomeDeCampoMuitoLongo'
        self.pub_oab_items[0]['dados'][chave] = 'Valor de teste'
        self.page.evaluate("chave => localStorage.setItem('cnj_pub_oab_colunas_visiveis_v2', JSON.stringify(['djen:'+chave]))", chave)
        self.page.evaluate('carregarPublicacoesOab()')
        self.page.wait_for_function('!_pubOabCarregando')
        row = self.page.locator('.pub-oab-linha').first
        self.assertEqual(row.locator('cds-table-cell').evaluate_all('els => els.slice(0,2).map(el => el.dataset.label)'), ['Expandir', 'Selecionar'])
        header = self.page.locator('cds-table-header-cell[data-coluna="djen:'+chave+'"] .pub-oab-cabecalho')
        texto = header.locator('.pub-oab-cabecalho-texto')
        self.assertEqual(texto.evaluate('el => getComputedStyle(el).webkitLineClamp'), '2')
        self.assertLessEqual(texto.evaluate('el => el.getBoundingClientRect().height'), 32)
        header.focus()
        tooltip = self.page.locator('#'+header.get_attribute('aria-describedby'))
        self.assertTrue(tooltip.is_visible())
        self.assertEqual(tooltip.text_content(), texto.text_content())
        header.press('Escape')
        self.assertFalse(tooltip.is_visible())
        for largura in (1440, 390):
            for tema in ('white', 'g100'):
                self.page.set_viewport_size({'width':largura,'height':1000})
                self.page.evaluate('tema => window.AstraJusTema.aplicar(tema)', tema)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.assertEqual(self.page.locator('.pub-oab-tabela-toolbar').evaluate('el => el.getBoundingClientRect().height'), 48)
                self.assertEqual(self.page.locator('cds-table-header-row').evaluate('el => el.getBoundingClientRect().height'), 40)
                self.assertEqual(row.evaluate('el => el.getBoundingClientRect().height'), 40)
        self.page.set_viewport_size({'width':1440,'height':1000})
        self.page.locator('input[data-publicacao-hash]').first.check()
        self.assertEqual(self.page.locator('#pub-oab-batch').evaluate('el => el.getBoundingClientRect().height'), 48)
        self.assertFalse(self.errors)

    def test_dt05_duas_acoes_inline_mesmos_handlers_e_bloqueio_de_lote(self):
        self.open_publicacoes_oab()
        self.pub_oab_items[1].update({'status':'tratada','numero_processo':None})
        self.page.evaluate('carregarPublicacoesOab()')
        self.page.wait_for_function('!_pubOabCarregando')
        row = self.page.locator('.pub-oab-linha').last
        self.assertEqual(row.locator('.pub-oab-acao-inline').count(), 2)
        self.assertEqual(row.locator('.pub-oab-overflow').count(), 0)
        self.assertEqual(row.locator('.pub-oab-acao-inline svg[slot="icon"]').count(), 2)
        vincular = row.get_by_role('button', name='Vincular a processo existente:', exact=False)
        self.page.locator('input[data-publicacao-hash]').first.check()
        self.assertTrue(row.locator('[data-pub-oab-acao]').evaluate_all('els => els.every(el => el.disabled)'))
        self.page.locator('[data-cancelar-lote]').click()
        vincular.click()
        form = self.page.locator('.pub-oab-inline-form')
        self.assertTrue(form.is_visible())
        form.get_by_role('button', name='Cancelar', exact=True).click()
        row.get_by_role('button', name='Arquivar:', exact=False).click()
        self.page.wait_for_function('!_pubOabAtualizando && !_pubOabCarregando')
        self.assertEqual(self.pub_oab_posts[-1], {'hashes':['pub-2'],'status':'arquivada'})
        self.assertFalse(self.errors)

    def test_financeiro_contato_totais_isolamento_e_estados(self):
        itens = [
            {"cliente_id": "cliente-1", "caso_id": "caso-1", "descricao": "Honorários recebidos", "valor": 100.10, "direcao": "RECEITA", "pago": True, "vencimento": "2026-10-01"},
            {"cliente_id": "cliente-1", "descricao": "Honorários pendentes", "valor": 50.20, "direcao": "RECEITA", "pago": False},
            {"cliente_id": "cliente-1", "descricao": "Custas pagas", "valor": 30.05, "direcao": "DESPESA", "pago": True},
            {"cliente_id": "cliente-1", "descricao": "Custas pendentes", "valor": 10.15, "direcao": "DESPESA", "pago": False},
            {"cliente_id": "outro", "caso_id": "caso-1", "descricao": "Não exibir", "valor": 9999, "direcao": "RECEITA", "pago": True},
        ]
        falhar = False
        def responder(route):
            if falhar:
                return route.fulfill(status=500, json={"mensagem": "Falha simulada"})
            route.fulfill(json={"lancamentos": itens})
        self.context.route("**/lancamentos", responder)
        self.connect()
        self.page.evaluate("async () => { await selecionarAba(abas.find(a => a.painel.id === 'aba-contatos')); await abrirContato('cliente-1'); }")
        self.page.locator("#contato-subaba-financeiro-botao").click()
        painel = self.page.locator("#contato-financeiro")
        painel.locator("tbody tr").first.wait_for()
        self.assertEqual(painel.locator("tbody tr").count(), 4)
        self.assertNotIn("Não exibir", painel.inner_text())
        self.assertEqual(painel.locator("dd").all_text_contents(), ["R$\u00a0150,30", "R$\u00a040,20", "R$\u00a0100,10", "R$\u00a030,05", "R$\u00a050,20", "R$\u00a010,15", "R$\u00a070,05"])
        pasta = Path("output/financeiro-cliente")
        pasta.mkdir(parents=True, exist_ok=True)
        for tema in ("white", "g100"):
            self.page.evaluate("tema => { document.documentElement.classList.remove('cds--white', 'cds--g100'); document.documentElement.classList.add('cds--' + tema); document.documentElement.dataset.carbonTheme = tema; }", tema)
            for largura in (1440, 390):
                self.page.set_viewport_size({"width": largura, "height": 1000})
                self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                self.page.screenshot(path=str(pasta / f"{tema}-{largura}.png"), full_page=True)
        falhar = True
        self.page.locator("#contato-financeiro-atualizar").click()
        self.page.wait_for_function("document.getElementById('contato-financeiro').textContent.includes('Não foi possível')")
        falhar = False
        itens.clear()
        self.page.locator("#contato-financeiro-atualizar").click()
        self.page.wait_for_function("document.getElementById('contato-financeiro').textContent.includes('Nenhum lançamento')")
        self.assertEqual(painel.locator("table").count(), 0)
        self.page.evaluate("abrirNovoContato()")
        self.assertTrue(self.page.locator("#contato-subaba-financeiro-botao").is_hidden())
        self.assertFalse(self.errors)

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
        self.page.get_by_role("columnheader", name="Nome do processo", exact=True).wait_for()
        self.page.locator(".pub-oab-colunas button").click()
        for rotulo in ("Divulgado", "Capturado", "Tipo"):
            self.page.locator(".pub-oab-colunas").get_by_label(rotulo, exact=True).check()
        self.page.locator(".pub-oab-colunas button").press("Escape")
        self.assertTrue(self.page.get_by_role("columnheader", name="Divulgado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Capturado", exact=True).is_visible())
        self.assertTrue(self.page.get_by_role("columnheader", name="Tipo", exact=True).is_visible())
        self.assertEqual(tabela.locator('cds-table-body > cds-table-row').first.locator('[data-coluna="nome"]').inner_text(), "Maria Da Silva X Parte passiva não informada")
        self.page.locator(".pub-oab-colunas button").click()
        for rotulo in ("Tipo de documento", "Advogados", "Número da OAB", "Texto", "Hash", "Link", "Meio"):
            self.page.locator(".pub-oab-colunas").get_by_label(rotulo, exact=True).check()
        self.page.locator(".pub-oab-colunas button").press("Escape")
        linha = tabela.locator('cds-table-body > cds-table-row').first
        self.assertEqual(linha.locator('[data-coluna="advogados"]').inner_text(), "João Dos Santos")
        self.assertEqual(linha.locator('[data-coluna="hash"]').inner_text(), "aBc123")
        self.assertEqual(linha.locator('[data-coluna="link"]').inner_text(), "https://example.test/AbC")
        self.assertEqual(linha.locator('[data-coluna="djen:meio"]').inner_text(), "Diário eletrônico")
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
        self.assertTrue(self.page.locator('.pub-oab-colunas').get_by_label('Campo fora da pagina', exact=True).is_visible())
        self.page.locator('.pub-oab-colunas button').press('Escape')
        self.page.locator('input[data-publicacao-hash="pub-1"]').check()
        self.assertFalse(self.page.locator('.pub-oab-tabela-toolbar').is_visible())
        self.page.get_by_role('button', name='Próxima página', exact=True).click()
        self.page.locator('input[data-publicacao-hash="pub-6"]').wait_for()
        self.assertFalse(self.page.locator('input[data-publicacoes-todas]').is_checked())
        self.page.locator('input[data-publicacoes-todas]').check()
        self.assertIn('6 selecionadas', self.page.locator('#pub-oab-selecionadas').inner_text())
        self.page.get_by_role('button', name='Página anterior', exact=True).click()
        self.assertTrue(self.page.locator('input[data-publicacao-hash="pub-1"]').is_checked())
        self.assertTrue(self.page.locator('input[data-publicacoes-todas]').evaluate('el => el.indeterminate'))
        self.page.locator('#pub-oab-marcar-tratada').click()
        self.page.wait_for_function('!_pubOabAtualizando && !_pubOabCarregando')
        self.assertEqual(set(self.pub_oab_posts[-1]['hashes']), {'pub-1', 'pub-6', 'pub-7', 'pub-8', 'pub-9', 'pub-10'})
        self.page.locator('input[data-publicacao-hash="pub-1"]').check()
        self.select_value(self.page.locator('#pub-oab-tamanho'), '10')
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
        self.select_value(self.page.locator("#pub-oab-filtro-status"), "arquivada")
        self.page.get_by_text("Nenhuma publicação com este status", exact=True).wait_for()
        self.assertEqual(self.page.locator("#pub-oab-arquivar").count(), 0)
        self.assertEqual(self.page.locator("#pub-oab-marcar-tratada").count(), 0)
        self.select_value(self.page.locator("#pub-oab-filtro-status"), "")
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
        form.get_by_role("button", name="Caso De Teste", exact=False).click()
        self.assertTrue(form.locator(".pub-oab-confirmacao").is_visible())
        self.assertTrue(form.get_by_role("button", name="Confirmar vínculo", exact=True).is_enabled())
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
        self.assertIn("1 selecionada", self.page.locator("#pub-oab-selecionadas").inner_text())
        self.page.get_by_role("button", name="Cancelar seleção", exact=True).click()
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
        self.page.get_by_role("menuitem", name="Cadastrar processo", exact=True).click()
        self.page.get_by_role("form", name="Cadastrar processo", exact=True).wait_for()
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
        self.page.get_by_role("menuitem", name="Cadastrar processo", exact=True).click()
        form = self.page.get_by_role("form", name="Cadastrar processo", exact=True)
        form.locator("cds-search input").fill("Cliente")
        form.get_by_role("button", name="Cliente De Teste", exact=True).click()
        self.select_value(form.locator('select[id$="-responsavel"]'), "Ana")
        self.page.set_viewport_size({"width": 390, "height": 900})
        self.assertTrue(form.evaluate("el => el.getBoundingClientRect().width <= innerWidth && el.scrollWidth <= el.clientWidth"))
        self.assertEqual(self.pub_oab_posts, [])
        form.get_by_role("button", name="Confirmar cadastro", exact=True).click()
        self.page.wait_for_function("document.getElementById('toast-global').textContent.includes('Processo cadastrado')")
        self.assertEqual(self.pub_oab_posts, [{"cliente_id": "cliente-1", "responsavel": "Ana"}])
        self.assertFalse(self.errors)

    def test_publicacoes_vinculo_exige_selecao_e_confirma_numero_parte_cliente(self):
        self.open_publicacoes_oab()
        self.page.locator(".pub-oab-combo .cds--menu-button__trigger").first.click()
        self.page.get_by_role("menuitem", name="Vincular a processo existente", exact=True).click()
        form = self.page.get_by_role("form", name="Vincular a processo existente", exact=True)
        confirmar = form.get_by_role("button", name="Confirmar vínculo", exact=True)
        self.assertTrue(confirmar.is_disabled())
        queries = []
        def responder(route):
            from urllib.parse import urlparse, parse_qs
            queries.append(parse_qs(urlparse(route.request.url).query)["q"][0])
            route.fulfill(json={"casos": [self.case]})
        self.context.route("**/casos?q=*", responder)
        for termo in ("1000607", "Maria", "Cliente"):
            form.locator("cds-search input").fill(termo)
            form.get_by_role("button", name="Caso De Teste", exact=False).click()
            self.assertTrue(form.locator(".pub-oab-confirmacao").is_visible())
            self.assertTrue(confirmar.is_enabled())
        self.assertEqual(queries, ["1000607", "Maria", "Cliente"])
        self.assertFalse(any(m == "POST" and p.endswith("/publicacoes") for m, p in self.requests))
        confirmar.click()
        self.page.wait_for_function("document.getElementById('toast-global').textContent.includes('Publicação vinculada')")
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
        self.assertEqual(self.page.locator("#caso-detalhe-titulo").inner_text(), "Caso De Teste")
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
            {"nome": "Autora Djen", "polo": "A"}, {"nome": "Segunda Autora", "polo": "ATIVO"},
            {"nome": "Autora Djen", "polo": "A"}, {"nome": "Réu Djen", "polo": "P"},
            {"nome": "Sem Polo"}],
            "advogados": [{"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"},
                          {"nome": "Ana Silva", "numero_oab": "12345", "uf_oab": "sp"}]}
        self.context.route("**/casos/caso-1/processos/*/capa", lambda route: route.fulfill(json=capa))
        self.open_case()
        dados = self.page.locator("#lista-capa-processos .capa-card-auto")
        for texto in ["Autora Djen", "Segunda Autora", "Réu Djen", "Sem Polo", "Ana Silva — OAB 12345/SP"]:
            self.assertIn(texto, dados.inner_text())
        self.assertEqual(dados.inner_text().count("Autora Djen"), 1)
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
        self.assertEqual(self.page.locator('#modal-novo-caso [role="dialog"], #modal-novo-caso [role="alertdialog"]').count(), 0)
        self.assertEqual(self.page.locator("#modal-novo-caso").evaluate("el => getComputedStyle(el).position"), "static")
        self.page.locator("#btn-novo-caso").focus()
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-novo-caso")
        self.page.locator("#modal-novo-caso").focus()
        self.page.keyboard.press("Escape")
        self.page.locator("#modal-novo-caso").wait_for(state="hidden")
        self.assertFalse(self.page.locator("#modal-novo-caso").is_visible())
        self.assertEqual(self.page.evaluate("document.activeElement.id"), "btn-novo-caso")
        self.assertFalse(self.page.locator("main").evaluate("el => el.closest('[inert]') !== null"))

    def test_demais_fluxos_continuam_secoes_no_documento(self):
        self.connect()
        ids = self.page.locator(".fluxo-pagina").evaluate_all("els => els.map(el => el.id)")
        self.assertEqual(len(ids), 4)
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
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("continuar")
        self.assertTrue(self.page.locator("#caso-vista-detalhe").is_visible())
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Título pendente")
        self.page.locator("#caso-voltar").click()
        self.choose("descartar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.page.locator("#editar-caso-responsavel").input_value(), "Ana")
        self.page.evaluate("abrirCaso('caso-1')")
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Título salvo")
        self.page.locator("#caso-voltar").click()
        self.choose("salvar")
        self.page.wait_for_function("!document.getElementById('caso-vista-lista').hidden")
        self.assertEqual(self.case["responsavel"], "Título salvo")
        self.assertFalse(self.errors)

    def test_falha_ao_salvar_preserva_edicao_e_bloqueia_saida(self):
        self.open_case()
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Não perder")
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
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Título pendente")
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
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Título pendente")
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
        self.page.get_by_role("menuitem", name="Vincular a processo existente", exact=True).click()
        form = self.page.get_by_role("form", name="Vincular a processo existente", exact=True)
        form.locator("cds-search input").fill("Caso")
        form.get_by_role("button", name="Caso De Teste", exact=False).click()
        form.get_by_role("button", name="Confirmar vínculo", exact=True).click()
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
            label = self.page.locator("#contato-cadastro-aba-pessoal-botao span")
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
            self.assertTrue(self.page.locator(".cadastro-tabs").evaluate("el => el.getBoundingClientRect().right <= innerWidth"))
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
        self.select_value(self.page.locator("#editar-caso-responsavel"), "Título pendente")
        self.page.locator("#caso-voltar").click()
        self.page.wait_for_selector("#modal-edicao-pendente.is-visible")
        for width in (1440, 768, 390, 320):
            self.page.set_viewport_size({"width": width, "height": 960})
            self.page.wait_for_timeout(300)  # Aguarda a transição de entrada/reposicionamento do Carbon.
            container = self.page.locator("#modal-edicao-pendente cds-modal-footer").bounding_box()
            for item in self.page.locator("#modal-edicao-pendente cds-modal-footer button").all():
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
        self.assertEqual(self.page.locator("#casos-vista-tabela-botao").get_attribute("aria-pressed"), "true")
        self.page.keyboard.press("Home")
        self.assertEqual(self.page.locator("#casos-vista-cards-botao").get_attribute("aria-pressed"), "true")
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
        self.select_value(self.page.locator("#atividades-tipo"), 'prazo')
        self.assertEqual(self.page.locator("#atividades-lista article").count(), 1)
        self.select_value(self.page.locator("#atividades-tipo"), '')
        self.select_value(self.page.locator("#atividades-responsavel"), 'Ana')
        self.page.get_by_role('button', name='Concluir atividade: Providência 1', exact=True).click()
        self.page.wait_for_function("!document.getElementById('atividades-lista').textContent.includes('Providência 1')")
        falha[0] = False
        self.select_value(self.page.locator("#atividades-responsavel"), '')
        self.page.locator("#atividades-atualizar").click()
        self.page.wait_for_function("document.getElementById('atividades-status').textContent.includes('Revisados 3')")
        self.assertEqual(self.page.locator("#atividades-lista article").count(), 2)
        self.assertFalse(self.errors)

    def test_revisao_atividades_filtra_executor_independente_do_processo(self):
        self.connect()
        casos = [
            {**self.case, "id": "caso-1", "responsavel": "Ana"},
            {**self.case, "id": "caso-2", "responsavel": "Bia"},
        ]
        atividades = {
            "caso-1": [
                {"id": 1, "titulo": "Delegada para Bia", "responsavel": "Bia", "tipo": "prazo", "status": "pendente"},
                {"id": 2, "titulo": "Execução de Ana", "responsavel": "Ana", "tipo": "tarefa", "status": "pendente"},
                {"id": 3, "titulo": "Atividade legada", "responsavel": None, "tipo": "tarefa", "status": "pendente"},
            ],
            "caso-2": [
                {"id": 4, "titulo": "Outra atividade de Bia", "responsavel": "Bia", "tipo": "tarefa", "status": "pendente"},
            ],
        }
        self.context.route("**/casos", lambda rota: rota.fulfill(json={"casos": casos}))
        def responder(rota):
            caso_id = rota.request.url.split("/casos/")[1].split("/")[0]
            rota.fulfill(json={"atividades": atividades[caso_id]})
        self.context.route("**/casos/caso-*/atividades", responder)
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-atividades'))")
        self.page.wait_for_function("document.getElementById('atividades-status').textContent.includes('Revisados 2')")
        executor = self.page.locator("#atividades-executor")
        processo = self.page.locator("#atividades-responsavel")
        lista = self.page.locator("#atividades-lista")
        self.assertEqual(lista.locator("article").count(), 4)
        self.select_value(executor, "responsavel:Bia")
        self.assertEqual(lista.locator("article").count(), 2)
        self.select_value(processo, "Ana")
        self.assertEqual(lista.locator("article").count(), 1)
        self.assertIn("Delegada Para Bia", lista.inner_text())
        self.assertIn("Responsável pelo processo: Ana", lista.inner_text())
        self.assertIn("Responsável pela atividade: Bia", lista.inner_text())
        self.select_value(self.page.locator("#atividades-tipo"), "tarefa")
        self.assertEqual(lista.locator("article").count(), 0)
        self.select_value(self.page.locator("#atividades-tipo"), "")
        self.page.locator("#atividades-atualizar").click()
        self.page.wait_for_function("!document.getElementById('atividades-atualizar').disabled")
        self.assertEqual(executor.input_value(), "responsavel:Bia")
        self.assertEqual(lista.locator("article").count(), 1)
        self.select_value(executor, "responsavel:Ana")
        self.assertIn("Execução De Ana", lista.inner_text())
        self.select_value(executor, "sem-responsavel")
        self.assertEqual(lista.locator("article").count(), 1)
        self.assertIn("Atividade Legada", lista.inner_text())
        self.assertIn("Responsável pela atividade: Sem responsável", lista.inner_text())
        atividades["caso-1"].pop()
        self.page.locator("#atividades-atualizar").click()
        self.page.wait_for_function("!document.getElementById('atividades-atualizar').disabled")
        self.assertEqual(executor.input_value(), "")
        self.assertEqual(lista.locator("article").count(), 2)
        self.assertFalse(self.errors)

    def test_editar_atividade_preserva_responsavel_em_falha_e_envia_eu_mesmo(self):
        atividade = {"id": 1, "titulo": "Conferir publicação", "tipo": "tarefa", "status": "pendente", "responsavel": "Bia"}
        envios = []
        falha = [False]
        def responsaveis(rota):
            if falha[0]:
                return rota.fulfill(status=500, json={"mensagem": "Falha simulada"})
            rota.fulfill(json={"responsaveis": ["Ana", "Bia"]})
        def responder(rota):
            if rota.request.method == "PATCH":
                corpo = rota.request.post_data_json
                envios.append(corpo)
                atividade.update(corpo)
                atividade["responsavel"] = corpo["responsavel"] or "Ana"
                return rota.fulfill(json=atividade)
            if rota.request.url.endswith("/checklist"):
                return rota.fulfill(json={"itens": []})
            rota.fulfill(json={"atividades": [atividade]})
        self.context.route("**/responsaveis", responsaveis)
        self.context.route("**/casos/caso-1/atividades**", responder)
        self.open_case()
        falha[0] = True
        self.page.evaluate("() => _abrirModalAtividade('caso-1', {id:1, titulo:'Conferir publicação', tipo:'tarefa', responsavel:'Bia'})")
        self.assertEqual(self.page.locator("#atividade-responsavel").input_value(), "Bia")
        self.assertIn("responsável atual foi preservado", self.page.locator("#resultado-atividade").inner_text())
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.wait_for_function("!document.getElementById('modal-atividade').open")
        self.assertEqual(envios[-1]["responsavel"], "Bia")
        falha[0] = False
        self.page.evaluate("() => _abrirModalAtividade('caso-1', {id:1, titulo:'Conferir publicação', tipo:'tarefa', responsavel:'Bia'})")
        self.select_value(self.page.locator("#atividade-responsavel"), "")
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.wait_for_function("!document.getElementById('modal-atividade').open")
        self.assertIsNone(envios[-1]["responsavel"])
        self.page.locator("#lista-atividades").get_by_text("Responsável: Ana", exact=True).wait_for()
        self.assertFalse(self.errors)

    def test_auditoria_layout_atividades_e_enderecos_desktop_mobile(self):
        self.connect()
        pasta = Path(__file__).parent / 'output' / 'playwright' / 'auditoria-gtd'
        pasta.mkdir(parents=True, exist_ok=True)
        self.context.route('**/casos/caso-1/atividades', lambda rota: rota.fulfill(json={'atividades': [
            {'id': 1, 'titulo': 'Conferir intimação e registrar a providência necessária no processo ' + 'X' * 90, 'tipo': 'prazo', 'status': 'pendente', 'data': '2026-10-30', 'responsavel': 'Bia'}]}))
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-atividades'))")
        self.page.locator('#atividades-lista article').wait_for()
        self.page.wait_for_function("!document.querySelector('.app-progresso-global:not([hidden])')")
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
        self._verificar_publicacao_atividade_compatibilidade(estruturada=False)

    def test_publicacao_atividade_estruturada_sem_marcador_e_com_origem_apos_recarga(self):
        self._verificar_publicacao_atividade_compatibilidade(estruturada=True)

    def _verificar_publicacao_atividade_compatibilidade(self, estruturada):
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
            rota.fulfill(json={'atividades': salvas, 'origem_djen_estruturada': estruturada})
        self.context.route('**/casos/caso-1/atividades', responder)
        self.context.route('**/casos/caso-1/publicacoes', lambda rota: rota.fulfill(json={'publicacoes': self.pub_oab_items[:1]}))
        self.page.evaluate('carregarPublicacoesOab()')
        self.page.locator('.pub-oab-tabela').wait_for()
        self.page.locator('.pub-oab-tabela .cds--menu-button__trigger').first.click()
        self.page.get_by_role('menuitem', name='Criar atividade', exact=True).click()
        self.page.locator('#atividade-titulo').fill('Conferir intimação')
        self.page.locator('#atividade-observacoes').fill('Verificar providência necessária')
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.locator('#resultado-atividade').get_by_text('Falha simulada', exact=True).wait_for()
        self.assertEqual(self.page.locator('#atividade-titulo').input_value(), 'Conferir intimação')
        self.assertEqual(len(salvas), 0)
        self.assertEqual(len(self.pub_oab_posts), 0)
        falha[0] = False
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.get_by_role('button', name='Ver publicação de origem', exact=True).wait_for()
        if estruturada:
            self.assertEqual(salvas[0]['origem_djen_hash'], 'pub-1')
            self.assertEqual(salvas[0]['observacoes'], 'Verificar providência necessária')
        else:
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

    def test_origem_null_nao_reinterpreta_marcador_nem_reenvia_origem_ao_editar(self):
        self.open_case()
        atividade = {'id': 1, 'titulo': 'Revisar origem', 'tipo': 'tarefa', 'origem_djen_hash': None,
                     'observacoes': 'Publicação de origem (DJEN): pub-antiga'}
        self.page.evaluate('(atividade) => _renderizarAtividades("caso-1", [atividade])', atividade)
        self.assertEqual(self.page.get_by_role('button', name='Ver publicação de origem', exact=True).count(), 0)
        self.page.evaluate('(atividade) => _abrirModalAtividade("caso-1", atividade)', atividade)
        self.assertEqual(self.page.locator('#atividade-observacoes').input_value(), atividade['observacoes'])
        self.assertEqual(self.page.locator('#form-atividade').get_attribute('data-publicacao-hash'), '')
        self.assertEqual(self.page.locator('#form-atividade').get_attribute('data-origem-estruturada'), 'true')
        pedidos = []
        def gravar(rota):
            pedidos.append(rota.request.post_data_json)
            rota.fulfill(json={**atividade, **pedidos[-1]})
        self.context.route('**/casos/caso-1/atividades/1', gravar)
        self.page.locator('#atividade-titulo').fill('Título atualizado')
        self.page.locator("button[form='form-atividade'][type='submit']").click()
        self.page.wait_for_function("!document.getElementById('modal-atividade').open")
        self.assertNotIn('origem_djen_hash', pedidos[0])
        self.assertEqual(pedidos[0]['observacoes'], atividade['observacoes'])
        self.assertFalse(self.errors)

    def test_desvincular_publicacao_limpa_origem_e_impede_recuperacao_pelo_hash(self):
        atividade = {'id': 1, 'titulo': 'Revisar origem', 'tipo': 'tarefa', 'origem_djen_hash': 'pub-1'}
        publicacoes = [{'hash': 'pub-1', 'dados': {'texto': 'Conteúdo vinculado de teste'}}]
        self.context.route('**/casos/caso-1/atividades', lambda rota: rota.fulfill(json={'atividades': [atividade], 'origem_djen_estruturada': True}))
        def responder(rota):
            if rota.request.method == 'DELETE':
                publicacoes.clear()
                return rota.fulfill(json={'desvinculada': True})
            rota.fulfill(json={'publicacoes': publicacoes})
        self.context.route('**/casos/caso-1/publicacoes**', responder)
        self.open_case()
        self.page.locator('#caso-subaba-atividades-botao').click()
        self.page.get_by_role('button', name='Ver publicação de origem', exact=True).click()
        self.page.locator('#atividade-origem').get_by_text('Conteúdo vinculado de teste', exact=True).wait_for()
        self.page.locator('#caso-subaba-publicacoes-botao').click()
        self.page.get_by_role('button', name='Desvincular', exact=True).click()
        self.page.locator('#modal-confirmar-ok').click()
        self.page.wait_for_function("document.getElementById('atividade-origem').textContent === ''")
        self.page.locator('#caso-subaba-atividades-botao').click()
        self.page.get_by_role('button', name='Ver publicação de origem', exact=True).click()
        self.page.locator('#atividade-origem').get_by_text('Publicação de origem indisponível', exact=True).wait_for()
        self.assertNotIn('Conteúdo vinculado de teste', self.page.locator('#atividade-origem').inner_text())
        self.assertFalse(any(caminho == '/publicacoes-oab' for _, caminho in self.requests))
        self.assertFalse(self.errors)

    def test_agenda_atividade_retry_conflito_resolucao_cancelamento_e_layout(self):
        atividade = {'id': 1, 'titulo': 'Conferir publicação', 'tipo': 'prazo', 'status': 'pendente', 'data': '2026-10-30', 'hora': None, 'agenda': None}
        pedidos = []
        falha = [True]
        def responder(rota):
            request = rota.request
            if request.url.endswith('/agenda'):
                pedidos.append((request.method, request.headers.get('idempotency-key'), request.post_data_json))
                if falha[0]:
                    falha[0] = False
                    return rota.fulfill(status=500, json={'mensagem': 'Falha simulada da agenda. Tente novamente.'})
                if request.method == 'POST' and not atividade['agenda']:
                    atividade['agenda'] = {'id': 'vinculo-1', 'estado': 'sincronizado', 'versao': 1}
                elif request.method == 'PATCH':
                    atividade['titulo'] = 'Título da agenda'
                    atividade['data'] = '2026-11-02'
                    atividade['agenda'].update(estado='sincronizado', versao=3)
                elif request.method == 'DELETE':
                    atividade['agenda'].update(estado='cancelado', versao=4)
                return rota.fulfill(json={'agenda': atividade['agenda']})
            rota.fulfill(json={'atividades': [atividade], 'agenda_disponivel': True, 'origem_djen_estruturada': True})
        self.context.route('**/casos/caso-1/atividades**', responder)
        self.open_case()
        self.page.locator('#caso-subaba-atividades-botao').click()
        self.page.get_by_role('button', name='Vincular à agenda: Conferir publicação', exact=True).click()
        self.page.locator('#toast-global').get_by_text('Falha simulada da agenda. Tente novamente.', exact=True).wait_for()
        self.page.get_by_role('button', name='Vincular à agenda: Conferir publicação', exact=True).click()
        self.page.get_by_text('Agenda: Sincronizado', exact=True).wait_for()
        self.assertEqual(pedidos[0][1], pedidos[1][1])
        self.assertTrue(pedidos[0][1])
        atividade['agenda'].update(estado='divergente', versao=2, data_remota='2026-11-02', titulo_remoto='Título da agenda')
        self.page.get_by_role('button', name='Atualizar agenda: Conferir publicação', exact=True).click()
        self.page.get_by_text('Agenda: Dados diferentes na agenda', exact=True).wait_for()
        self.page.wait_for_function("!document.querySelector('.app-progresso-global:not([hidden])')")
        while self.page.locator('#toast-global .cds--inline-notification__close-button').count():
            self.page.locator('#toast-global .cds--inline-notification__close-button').first.click()
        pasta = Path(__file__).parent / 'output' / 'playwright' / 'i04'
        pasta.mkdir(parents=True, exist_ok=True)
        for tema in ('white', 'g100'):
            self.page.evaluate('(tema) => AstraJusTema.aplicar(tema)', tema)
            for largura in (1440, 390):
                self.page.set_viewport_size({'width': largura, 'height': 1000})
                self.page.wait_for_timeout(300)  # aguarda transição responsiva do drawer e controles
                self.page.evaluate('_sideNavAbrir()' if largura > 768 else '_sideNavFechar()')
                if largura <= 768:
                    self.page.wait_for_function("document.getElementById('side-nav').getBoundingClientRect().right <= 1")
                self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
                self.page.screenshot(path=str(pasta / f'agenda-{tema}-{largura}.png'), full_page=True)
        self.page.set_viewport_size({'width': 1440, 'height': 1000})
        self.page.get_by_role('button', name='Usar data e título da agenda: Conferir publicação', exact=True).click()
        self.page.locator('#modal-confirmar-ok').click()
        self.page.get_by_text('Agenda: Sincronizado', exact=True).wait_for()
        self.assertEqual(pedidos[-1][0], 'PATCH')
        self.assertEqual(pedidos[-1][2], {'vinculo_id': 'vinculo-1', 'versao': 2, 'comando': 'aceitar_data_da_agenda'})
        self.page.get_by_role('button', name='Cancelar evento: Título da agenda', exact=True).click()
        self.page.locator('#modal-confirmar-ok').click()
        self.page.get_by_text('Agenda: Evento cancelado; atividade preservada', exact=True).wait_for()
        self.assertEqual(atividade['status'], 'pendente')
        self.assertEqual(pedidos[-1][0], 'DELETE')
        self.assertEqual(self.page.get_by_role('button', name='Vincular à agenda: Título da agenda', exact=True).count(), 1)
        self.assertFalse(self.errors)

    def test_agenda_atividade_sem_data_hora_e_integracao_desconectada(self):
        atividade = {'id': 1, 'titulo': 'Atividade com hora', 'tipo': 'reuniao', 'status': 'pendente', 'data': '2026-10-30', 'hora': '10:00'}
        disponivel = [True]
        self.context.route('**/casos/caso-1/atividades', lambda rota: rota.fulfill(json={'atividades': [atividade], 'agenda_disponivel': disponivel[0]}))
        self.open_case()
        self.page.locator('#caso-subaba-atividades-botao').click()
        self.page.get_by_text('Para vincular à agenda, informe uma data e deixe a hora vazia.', exact=True).wait_for()
        self.assertEqual(self.page.get_by_role('button', name='Vincular à agenda: Atividade com hora', exact=True).count(), 0)
        disponivel[0] = False
        atividade['agenda'] = {'id': 'vinculo-antigo', 'estado': 'falha', 'versao': 2, 'erro': 'Reconecte a conta original.'}
        self.page.evaluate('_carregarAtividades("caso-1")')
        self.page.get_by_text('Conecte sua agenda individual em Integrações e atualize as atividades.', exact=True).wait_for()
        self.assertEqual(self.page.get_by_role('button', name='Atualizar agenda: Atividade com hora', exact=True).count(), 1)
        self.assertFalse(self.errors)

    def test_resposta_de_origem_atrasada_nao_reabre_conteudo_invalidado(self):
        self.open_case()
        pendentes = []
        self.context.route('**/casos/caso-1/publicacoes', lambda rota: pendentes.append(rota))
        self.page.evaluate('() => { void mostrarOrigemAtividade("caso-1", "pub-1"); }')
        self.page.wait_for_timeout(100)
        self.assertEqual(len(pendentes), 1)
        self.page.evaluate('invalidarOrigemAtividade()')
        pendentes[0].fulfill(json={'publicacoes': [{'hash': 'pub-1', 'dados': {'texto': 'Resposta antiga'}}]})
        self.page.wait_for_function("!document.querySelector('.app-progresso-global:not([hidden])')")
        self.assertEqual(self.page.locator('#atividade-origem').inner_text(), '')
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


    def test_lancamento_reais_envio_e_recuperacao(self):
        self.connect()
        self.page.evaluate("_abrirModalHonorario()")
        self.page.locator("#honorario-descricao").fill("Honorários de teste")
        self.page.locator("#honorario-responsavel").fill("Ana")
        self.page.locator("#honorario-vencimento").fill("10/11/2026")
        self.page.locator("#honorario-descricao").click()
        for ident, selected in (("honorario-caso", "caso-1"), ("honorario-cliente", "cliente-1")):
            host = self.page.locator(f'[data-select-id="{ident}"]')
            host.locator('[role="combobox"]').click()
            host.locator(f'cds-dropdown-item[value="{selected}"]').click()
        valor = self.page.locator("#honorario-valor")
        for invalido in ("0", "-1", "1.50", "1,234", "abc"):
            valor.fill(invalido)
            self.assertFalse(valor.evaluate("e => e.checkValidity()"), invalido)
        valor.fill("1.500,00")
        self.assertTrue(valor.evaluate("e => e.checkValidity()"))
        enviados = []
        def salvar(route):
            enviados.append(route.request.post_data_json)
            if len(enviados) == 1:
                route.fulfill(status=500, json={"mensagem":"Falha simulada no lançamento"})
            else:
                route.fulfill(status=201, json={"id":"lancamento-1"})
        self.context.route("**/lancamentos", salvar)
        botao = self.page.locator("button[form='form-honorario']")
        botao.click()
        self.page.locator("#resultado-honorario").get_by_text("Falha simulada no lançamento").wait_for()
        self.assertEqual(valor.input_value(), "1.500,00")
        self.assertEqual(self.page.locator("#honorario-descricao").input_value(), "Honorários de teste")
        self.page.locator('[data-select-id="honorario-direcao"] cds-radio-button[value="DESPESA"]').locator('label').click()
        self.page.wait_for_function("document.getElementById('honorario-direcao').value === 'DESPESA'")
        self.assertEqual(self.page.locator('[data-select-id="honorario-direcao"] cds-radio-button[checked]').count(), 1)
        botao.click()
        self.page.wait_for_function("!document.getElementById('modal-honorario').classList.contains('is-visible')")
        self.assertEqual(enviados[0]["valor"], 1500)
        self.assertEqual(enviados[0]["vencimento"], "2026-11-10")
        self.assertEqual(enviados[0]["direcao"], "RECEITA")
        self.assertEqual(enviados[1]["direcao"], "DESPESA")
        self.assertFalse(self.errors)

    def test_lancamento_retry_preserva_dados_e_layout(self):
        self.connect()
        falhar = [True]
        def carregar(route):
            if falhar[0]: route.fulfill(status=500, json={"mensagem":"Falha simulada"})
            else: route.fulfill(json={"casos":[self.case]})
        self.context.route("**/casos", carregar)
        self.page.evaluate("_cache.casos = []; _abrirModalHonorario()")
        self.page.locator("#honorario-carregamento").get_by_text("Tentar novamente").wait_for()
        self.page.locator("#honorario-descricao").fill("Preservar esta descrição")
        falhar[0] = False
        self.page.locator("#honorario-carregamento").get_by_text("Tentar novamente").click()
        self.page.wait_for_function("document.getElementById('honorario-caso').options.length === 2")
        self.assertEqual(self.page.locator("#honorario-descricao").input_value(), "Preservar esta descrição")
        self.assertIn("Processo 1", self.page.locator("#honorario-caso option").nth(1).text_content())
        pasta = Path(__file__).parent / "output" / "lancamento-frontend"
        pasta.mkdir(parents=True, exist_ok=True)
        for largura in (1440, 390):
            self.page.set_viewport_size({"width":largura,"height":1100})
            self.assertEqual(self.page.evaluate("document.documentElement.scrollWidth"), largura)
            self.page.locator("#modal-honorario").screenshot(path=str(pasta / f"lancamento-{largura}.png"))
        self.assertFalse(self.errors)

    def test_lancamento_modal_foco_fundo_e_edicao_pendente(self):
        self.connect()
        origem = self.page.locator('#btn-novo-lancamento')
        self.page.evaluate("selecionarAba(abas.find(a => a.painel.id === 'aba-financeiro'))")
        origem.focus()
        self.page.evaluate('_abrirModalHonorario()')
        modal = self.page.locator('#modal-honorario')
        self.assertEqual(modal.evaluate('e => e.tagName'), 'CDS-MODAL')
        self.assertFalse(modal.get_attribute('alert'))
        self.page.wait_for_function("document.activeElement.id === 'honorario-descricao'")
        self.assertTrue(self.page.locator('#conteudo').evaluate('e => !!e.closest("[inert]")'))
        for _ in range(18):
            self.page.keyboard.press('Tab')
            self.assertTrue(self.page.evaluate("!!document.activeElement.closest('#modal-honorario')"))
        self.page.mouse.click(3, 3)
        self.assertTrue(modal.evaluate('e => e.open'))
        self.page.locator('#honorario-descricao').fill('Descrição a preservar')
        self.page.keyboard.press('Escape')
        self.page.locator('#modal-edicao-pendente').wait_for(state='visible')
        self.assertTrue(modal.evaluate('e => e.inert'))
        self.choose('continuar')
        self.page.wait_for_function("!document.getElementById('modal-honorario').inert")
        self.assertEqual(self.page.locator('#honorario-descricao').input_value(), 'Descrição a preservar')
        self.page.locator('#modal-honorario-fechar').click()
        self.choose('descartar')
        self.page.wait_for_function("!document.getElementById('modal-honorario').open")
        self.assertFalse(self.page.locator('#conteudo').evaluate('e => !!e.closest("[inert]")'))
        self.assertTrue(origem.evaluate('e => e === document.activeElement'))
        self.assertFalse(self.errors)

    def test_lancamento_modal_temas_calendario_e_dropdown(self):
        self.connect()
        self.page.evaluate('_abrirModalHonorario()')
        pasta = Path(__file__).parent / 'output' / 'lancamento-modal'
        pasta.mkdir(parents=True, exist_ok=True)
        fundos = []
        for tema, largura in (('white', 1440), ('g100', 1440), ('g100', 390)):
            self.page.evaluate('tema => AstraJusTema.aplicar(tema)', tema)
            self.page.set_viewport_size({'width':largura, 'height':960})
            self.page.locator('#honorario-descricao').focus()
            self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
            fundos.append(self.page.locator('#honorario-descricao').evaluate('e => getComputedStyle(e).backgroundColor'))
            self.page.screenshot(path=str(pasta / f'{tema}-{largura}.png'))
        self.assertNotEqual(fundos[0], fundos[1])
        self.page.locator('#honorario-vencimento').click()
        calendario = self.page.locator('#modal-honorario .flatpickr-calendar')
        calendario.wait_for(state='visible')
        rect = calendario.bounding_box()
        self.assertGreaterEqual(rect['x'], 0)
        self.assertLessEqual(rect['x'] + rect['width'], 391)
        self.page.keyboard.press('Escape')
        calendario.wait_for(state='hidden')
        self.assertTrue(self.page.locator('#modal-honorario').evaluate('e => e.open'))
        host = self.page.locator('[data-select-id="honorario-cliente"]')
        host.locator('[role="combobox"]').click()
        opcao = host.locator('cds-dropdown-item[value="cliente-1"]')
        opcao.wait_for(state='visible')
        rect = opcao.bounding_box()
        self.assertGreaterEqual(rect['y'], 0)
        self.assertLessEqual(rect['y'] + rect['height'], 960)
        opcao.click()
        self.assertEqual(self.page.locator('#honorario-cliente').input_value(), 'cliente-1')
        self.assertFalse(self.errors)

if __name__ == "__main__":
    unittest.main()
