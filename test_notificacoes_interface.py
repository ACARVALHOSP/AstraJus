"""Central de notificações com APIs interceptadas, sem serviços externos."""
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import test_interface as base


class NotificacoesInterfaceTest(base.InterfaceTest):
    def setUp(self):
        self.lidas = set()
        self.falha_feed = False
        self.destino_revogado = False
        self.destino_tipo = 'publicacoes_monitoradas'
        self.paginas = []
        self.reter_feed = False
        self.requisicao_retida = None
        super().setUp()

    def route(self, route):
        req = route.request
        url = urlparse(req.url)
        if url.path == '/notificacoes':
            self.requests.append((req.method, url.path))
            if self.reter_feed:
                self.requisicao_retida = route
                return
            if self.falha_feed:
                return route.fulfill(status=503, json={'mensagem': 'Serviço indisponível. Tente novamente.'})
            query = parse_qs(url.query)
            self.paginas.append(query)
            ids = ['3'] if 'cursor' in query else ['1', '2']
            itens = [{'id': i, 'titulo': 'Atividade atribuída', 'mensagem': f'Providência {i}', 'criado_em': '2026-10-26T12:00:00+00:00', 'lida_em': '2026-10-26T13:00:00+00:00' if i in self.lidas else None} for i in ids]
            if query.get('estado') == ['nao_lidas']:
                itens = [i for i in itens if not i['lida_em']]
            return route.fulfill(json={'notificacoes': itens, 'nao_lidas': 3-len(self.lidas), 'proximo_cursor': None if 'cursor' in query else 'cursor-opaco'})
        if url.path.startswith('/notificacoes/'):
            self.requests.append((req.method, url.path))
            if url.path.endswith('/destino'):
                if self.destino_revogado:
                    return route.fulfill(status=404, json={'mensagem': 'Notificação indisponível.'})
                destino = {'tipo': self.destino_tipo}
                if self.destino_tipo == 'atividade':
                    destino.update(caso_id='caso-1', atividade_id=1)
                return route.fulfill(json={'destino': destino})
            assert req.method == 'PATCH' and req.post_data_json == {'lida': True}
            self.lidas.add(url.path.rsplit('/', 1)[1])
            return route.fulfill(json={'id': url.path.rsplit('/', 1)[1], 'lida_em': '2026-10-26T13:00:00+00:00'})
        if url.path == '/casos/caso-1/atividades' and req.method == 'GET':
            return route.fulfill(json={'atividades': [{'id':1, 'titulo':'Providência 1', 'tipo':'tarefa', 'status':'pendente'}]})
        return super().route(route)

    def abrir_feed(self):
        self.page.locator('#btn-notificacoes-toggle').click()
        self.page.wait_for_function("document.querySelector('#notificacoes-lista').getAttribute('aria-busy') !== 'true'")

    def test_feed_leitura_paginacao_filtro_e_teclado(self):
        self.connect()
        self.page.wait_for_function("document.querySelector('#notificacoes-contador').count === 3")
        self.abrir_feed()
        self.assertTrue(self.page.locator('#notificacoes-popover').evaluate('(e) => e.open && e.tabTip'))
        self.assertEqual(self.page.locator('#notificacoes-lista li').count(), 2)
        self.assertFalse(self.lidas)
        self.page.locator('#notificacoes-mais').click()
        self.page.wait_for_function("document.querySelectorAll('#notificacoes-lista li').length === 3")
        self.assertEqual(self.paginas[-1]['cursor'], ['cursor-opaco'])
        self.page.locator('#notificacoes-lista').get_by_role('button', name='Marcar como lida', exact=True).first.click()
        self.page.wait_for_function("document.querySelector('#notificacoes-contador').count === 2")
        self.assertEqual(self.lidas, {'1'})
        self.page.locator('#notificacoes-filtro').check()
        self.page.wait_for_function("document.querySelectorAll('#notificacoes-lista li').length === 1")
        self.assertEqual(self.paginas[-1]['estado'], ['nao_lidas'])
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.locator('#header-notificacoes-painel').is_hidden())
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'btn-notificacoes-toggle')
        self.assertFalse(self.errors)

    def test_feed_destino_revalidado_sem_marcar_leitura(self):
        self.connect()
        self.abrir_feed()
        self.page.locator('#notificacoes-lista').get_by_role('button', name='Abrir', exact=True).first.click()
        self.page.wait_for_function("!document.querySelector('#aba-publicacoes-oab').hidden")
        self.assertFalse(self.lidas)
        self.destino_revogado = True
        self.abrir_feed()
        self.page.locator('#notificacoes-lista').get_by_role('button', name='Abrir', exact=True).first.click()
        self.page.wait_for_function("document.querySelector('#notificacoes-status').textContent.includes('indisponível')")
        self.assertEqual(self.page.locator('#notificacoes-lista li').count(), 0)
        self.assertTrue(self.page.locator('#notificacoes-contador').is_hidden())
        self.assertFalse(self.lidas)
        self.assertFalse(self.errors)

    def test_feed_falha_retry_sessao_e_resposta_atrasada(self):
        self.abrir_feed()
        self.assertIn('Conecte-se', self.page.locator('#notificacoes-status').inner_text())
        self.connect()
        self.falha_feed = True
        self.abrir_feed()
        self.page.get_by_role('button', name='Tentar novamente', exact=True).click()
        self.assertTrue(self.page.locator('#notificacoes-contador').is_hidden())
        self.falha_feed = False
        self.page.get_by_role('button', name='Tentar novamente', exact=True).click()
        self.page.wait_for_function("document.querySelectorAll('#notificacoes-lista li').length === 2")
        self.reter_feed = True
        self.page.locator('#notificacoes-atualizar').click()
        self.page.wait_for_timeout(100)
        self.assertIsNotNone(self.requisicao_retida)
        self.page.evaluate('conectarComToken(null)')
        self.requisicao_retida.fulfill(json={'notificacoes': [{'id':'99','titulo':'Antigo','mensagem':'Não exibir','criado_em':'2026-10-26'}], 'nao_lidas': 99})
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.locator('#notificacoes-lista li').count(), 0)
        self.assertTrue(self.page.locator('#notificacoes-contador').is_hidden())
        self.assertFalse(self.errors)

    def test_feed_abre_atividade_e_vazio_confirmado(self):
        self.connect()
        self.destino_tipo = 'atividade'
        self.abrir_feed()
        self.page.locator('#notificacoes-lista').get_by_role('button', name='Abrir', exact=True).first.click()
        self.page.locator('#atividade-titulo').wait_for(state='visible')
        self.assertEqual(self.page.locator('#atividade-titulo').input_value(), 'Providência 1')
        self.assertFalse(self.lidas)
        self.page.keyboard.press('Escape')
        self.lidas.update(['1','2','3'])
        self.abrir_feed()
        self.page.locator('#notificacoes-filtro').check()
        self.page.wait_for_function("document.querySelector('#notificacoes-status').textContent.includes('Nenhuma notificação não lida')")
        self.assertTrue(self.page.locator('#notificacoes-contador').is_hidden())
        self.assertIn('0 não lidas', self.page.locator('#notificacoes-rotulo').inner_text())
        self.assertFalse(self.errors)

    def test_feed_layout_carbon_white_g100_mobile(self):
        self.connect()
        self.abrir_feed()
        saida = Path('output/playwright/i05-integrado')
        saida.mkdir(parents=True, exist_ok=True)
        for largura in [1440, 390]:
            self.page.set_viewport_size({'width': largura, 'height': 1000})
            self.page.wait_for_timeout(150)
            self.assertEqual(self.page.evaluate('document.documentElement.scrollWidth'), largura)
            rect = self.page.locator('#header-notificacoes-painel').bounding_box()
            self.assertGreaterEqual(rect['x'], 0)
            self.assertLessEqual(rect['x']+rect['width'], largura)
            self.page.screenshot(path=str(saida/f'white-{largura}.png'), full_page=True)
        self.page.evaluate("document.documentElement.classList.remove('cds--white'); document.documentElement.classList.add('cds--g100')")
        self.page.screenshot(path=str(saida/'g100-390.png'), full_page=True)
        self.page.locator('#btn-busca-toggle').click()
        self.assertTrue(self.page.locator('#header-notificacoes-painel').is_hidden())
        self.assertFalse(self.errors)


def load_tests(loader, tests, pattern):
    # Executar somente os novos fluxos; a suíte base é executada separadamente.
    import unittest
    return unittest.TestSuite(NotificacoesInterfaceTest(n) for n in NotificacoesInterfaceTest.__dict__ if n.startswith('test_'))
