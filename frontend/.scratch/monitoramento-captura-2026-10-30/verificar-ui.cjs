async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('about:blank');
  await page.unroute('**/mcp');
  let lista = [];
  let renovar = 0;
  let falharRemocao = true;
  await page.route('**/mcp', async route => {
    const req = route.request().postDataJSON();
    if (req.method === 'notifications/initialized') return route.fulfill({ status: 202, body: '' });
    let result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'teste-local', version: '1' } };
    if (req.method === 'tools/call') {
      const { name, arguments: args } = req.params;
      let valor = {};
      if (name === 'listar_monitoramentos') valor = { monitoramentos: lista, limite: 5, email_configurado: false, historico: { monitoramentos: [] } };
      if (name === 'monitorar_publicacoes') {
        if (!args.numero_oab || args.uf_oab !== 'SP') throw Error('Critério enviado incorretamente');
        lista.push({ id: 'mon-teste', criterio: args, criado_em: '2026-10-30T15:00:00Z', expira_em: '2027-04-28T15:00:00Z', verificacao: { ultima_tentativa: '2026-10-30T15:00:00Z', estado: 'concluida', emails_pendentes: 1, paginas: 2, encontradas: 21 } });
        valor = lista[0];
      }
      if (name === 'renovar_monitoramento') { renovar++; valor = { id: args.id, expira_em: '2027-04-28T15:00:00Z' }; }
      if (name === 'remover_monitoramento') {
        if (falharRemocao) { falharRemocao = false; valor = { erro: true, mensagem: 'Falha simulada de remoção. Tente novamente.' }; }
        else { lista = []; valor = { removido: true }; }
      }
      result = { content: [{ type: 'text', text: JSON.stringify(valor) }] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'mcp-session-id': 'teste-local' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem('cnj_token', 'token-exclusivo-de-teste-local'); } catch {} });
  await page.route('**/notificacoes?*', route => route.fulfill({ json: { notificacoes: [], nao_lidas: 0 } }));
  await page.route('**/responsaveis/me', route => route.fulfill({ json: { nome: 'Teste local', email: 'teste@exemplo.com' } }));
  await page.goto('http://127.0.0.1:5180/novo/#monitoramentos');
  await page.getByRole('button', { name: 'Criar monitoramento', exact: true }).click();
  await page.getByLabel('Número da OAB', { exact: true }).fill('123');
  await page.getByLabel('UF da OAB', { exact: true }).selectOption('SP');
  await page.getByLabel('Nome para identificação (opcional)', { exact: true }).fill('Teste de monitoramento');
  await page.getByRole('button', { name: 'Criar monitoramento', exact: true }).last().click();
  await page.getByRole('heading', { name: 'OAB 123/SP' }).waitFor();
  await page.getByRole('button', { name: 'Renovar por 180 dias', exact: true }).click();
  await page.getByText('Monitoramento renovado por 180 dias, preservando seu histórico.').waitFor();
  if (renovar !== 1) throw Error('Renovação duplicada');
  await page.getByRole('button', { name: 'Remover', exact: true }).first().click();
  await page.getByRole('button', { name: 'Remover', exact: true }).last().click();
  await page.getByRole('dialog', { name: 'Remover monitoramento' }).getByText('Falha simulada de remoção. Tente novamente.').waitFor();
  if (!await page.getByRole('dialog').isVisible()) throw Error('Modal fechou em erro de domínio');
  await page.screenshot({ path: '.scratch/monitoramento-captura-2026-10-30/erro-recuperavel.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Remover', exact: true }).last().click();
  await page.getByText('Nenhum monitoramento ativo', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const fecharMenu = page.getByRole('button', { name: 'Fechar menu', exact: true });
  if (await fecharMenu.isVisible()) await fecharMenu.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.scratch/monitoramento-captura-2026-10-30/mobile-final.png', fullPage: true, animations: 'disabled' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw Error('Overflow horizontal no mobile');
  console.log('OK: cadastro OAB, renovação, erro de domínio recuperável, remoção e mobile sem overflow.');
}
