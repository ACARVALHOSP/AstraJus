import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).parent
numero = '10018401920265020072'
caso = dict(id='c1', titulo='Bruno da Silva Miguel X Carrefour Comercio E Industria Ltda', processos=[numero], cliente_id='cli1', clientes_adicionais=[], acao='Reclamação Trabalhista', foro='72ª Vara do Trabalho', responsavel='Ariel')
clientes = [dict(id='cli1', nome='Bruno da Silva Miguel', perfil='cliente'), dict(id='cli2', nome='Carrefour Comercio E Industria Ltda', perfil='parte_contraria')]
capa = dict(nome_processo=caso['titulo'], tipo_justica='Justiça do Trabalho', tribunal='TRT2', classe='Reclamação Trabalhista', orgao_julgador=caso['foro'], data_distribuicao='20260102123000', assuntos=['Verbas rescisórias'], cidade='São Paulo', uf='SP', grau='G1', nivel_sigilo=0, atualizado_em='2026-10-30T12:00:00Z', monitorando=False, partes=[dict(nome=clientes[0]['nome'], polo='A'), dict(nome=clientes[1]['nome'], polo='P'), dict(nome='Terceiro sem polo')], advogados=[dict(advogado=dict(nome='Ariel de Souza Carvalho', numero_oab='450598', uf_oab='SP'))], movimentos=[dict(nome='Distribuído', dataHora='2026-01-02T12:00:00'), dict(nome='Audiência designada', dataHora='2026-10-29T10:00:00')], valor_causa=0)
requests = []
fail = {'patch': False, 'update': False, 'get': False, 'clients': False}

def api(route):
    req = route.request
    path = req.url.split('5174')[-1].split('?')[0]
    method = req.method
    body = req.post_data_json if req.post_data else {}
    requests.append((method, path, body))
    status, data = 200, {}
    if path == '/mcp':
        if 'id' not in body:
            route.fulfill(status=202, body=''); return
        data = dict(jsonrpc='2.0', id=body['id'], result=dict(protocolVersion='2024-11-05', capabilities={}, serverInfo=dict(name='mock', version='1')))
    elif path == '/clientes':
        status, data = (503, {'mensagem': 'Clientes indisponíveis'}) if fail['clients'] else (200, {'clientes': clientes})
    elif path == '/casos': data = dict(casos=[caso])
    elif path == '/casos/c1': data = caso
    elif path.endswith('/capa/atualizar'):
        if fail['update']: status, data = 502, dict(mensagem='Falha DataJud de teste')
        else: data = capa
    elif path.endswith('/capa/monitorar'):
        capa['monitorando'] = method == 'POST'; data = {}
    elif path.endswith('/capa'):
        if method == 'PATCH':
            if fail['patch']: status, data = 500, dict(mensagem='Falha ao salvar de teste')
            else: capa.update(body); data = capa
        elif fail['get']: status, data = 503, dict(mensagem='Falha leitura')
        else: data = capa
    elif path == '/responsaveis': data = dict(responsaveis=['Ariel'])
    elif path == '/notificacoes': data = dict(nao_lidas=0, notificacoes=[])
    else: data = {}
    route.fulfill(status=status, json=data, headers={'mcp-session-id': 'mock'} if path == '/mcp' else {})

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport=dict(width=1440, height=1100))
    page.add_init_script("localStorage.setItem('cnj_token','mock');")
    page.route(re.compile(r'http://127\.0\.0\.1:5174/(mcp|casos|clientes|responsaveis|notificacoes)(/|\?|$)'), api)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5174/novo/#/casos')
    page.locator('button.texto-tabela').first.click()
    card = page.get_by_role('region', name='Capa do processo 1001840-19.2026.5.02.0072')
    expect(card.get_by_text('Cliente', exact=True)).to_have_count(1)
    expect(card.get_by_text('02/01/2026', exact=True)).to_be_visible()
    expect(card.get_by_text('29/10/2026 · Audiência designada')).to_be_visible()
    expect(card.get_by_text('Terceiro Sem Polo', exact=True)).to_be_visible()
    expect(card.get_by_text('Ariel De Souza Carvalho — OAB 450598/SP')).to_be_visible()
    expect(card.get_by_label('Valor da causa (R$)')).to_have_value('0')
    card.get_by_label('Área do direito', exact=True).fill('Direito do Trabalho')
    expect(card.get_by_role('button', name='Atualizar capa (DataJud + DJEN)', exact=True)).to_be_disabled()
    fail['patch'] = True
    card.get_by_role('button', name='Salvar capa', exact=True).click()
    expect(card.get_by_text('Falha ao salvar de teste')).to_be_visible()
    expect(card.get_by_label('Área do direito', exact=True)).to_have_value('Direito do Trabalho')
    fail['patch'] = False
    card.get_by_role('button', name='Salvar capa', exact=True).click()
    expect(card.get_by_text('Capa salva.', exact=True)).to_be_visible()
    patch = [r[2] for r in requests if r[0] == 'PATCH' and r[1].endswith('/capa')][-1]
    assert patch['valor_causa'] == 0 and patch['magistrado'] is None
    assert set(patch) == {'area_direito','magistrado','valor_causa','fase','status_processo'}
    fail['update'] = True
    card.get_by_role('button', name='Atualizar capa (DataJud + DJEN)', exact=True).click()
    expect(card.get_by_text('Falha DataJud de teste')).to_be_visible()
    fail['update'] = False
    card.get_by_role('button', name='Atualizar capa (DataJud + DJEN)', exact=True).click()
    expect(card.get_by_text('Capa atualizada com DataJud e DJEN.')).to_be_visible()
    assert [r[2] for r in requests if r[1].endswith('/atualizar')][-1] == {'tribunal':'trt2'}
    card.get_by_role('button', name='Monitorar automaticamente', exact=True).click()
    expect(card.get_by_role('button', name='Parar monitoramento', exact=True)).to_be_enabled()
    card.get_by_role('button', name='Parar monitoramento', exact=True).click()
    expect(card.get_by_role('button', name='Monitorar automaticamente', exact=True)).to_be_enabled()
    card.get_by_text('Mais informações', exact=True).click()
    expect(card.get_by_text('São Paulo / SP', exact=True)).to_be_visible()
    page.screenshot(path=str(OUT/'desktop.png'), full_page=True)
    for width in [390, 768]:
        page.set_viewport_size(dict(width=width, height=900))
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow {width}'
        page.screenshot(path=str(OUT/f'tela-{width}.png'), full_page=True)
    card.get_by_role('button', name='Ver movimentações', exact=True).click()
    expect(page.get_by_role('tab', name='Movimentações', exact=True)).to_have_attribute('aria-selected','true')
    page.get_by_role('tab', name='Cadastro', exact=True).click()
    # Erro de leitura e recuperação, seguido de cadastro sem CNJ.
    fail['get'] = True
    page.reload()
    page.locator('button.texto-tabela').first.click()
    page.get_by_role('button', name='Tentar novamente', exact=True).wait_for()
    fail['get'] = False
    page.get_by_role('button', name='Tentar novamente', exact=True).click()
    expect(card.get_by_text('Cliente', exact=True)).to_have_count(1)
    page.reload()
    page.locator('button.texto-tabela').first.wait_for()
    fail['clients'] = True
    page.locator('button.texto-tabela').first.click()
    expect(card.get_by_text('As tags de cliente estão indisponíveis.', exact=False)).to_be_visible()
    expect(card.get_by_text('Cliente', exact=True)).to_have_count(0)
    fail['clients'] = False
    caso['processos'] = []
    page.reload()
    page.locator('button.texto-tabela').first.click()
    expect(page.get_by_text('Este processo ainda não tem número CNJ para consultar a capa.')).to_be_visible()
    assert not errors, errors
    browser.close()
print('Fluxos de capa, cliente, gravação, falhas, atualização, monitoramento, abas e responsividade passaram.')





