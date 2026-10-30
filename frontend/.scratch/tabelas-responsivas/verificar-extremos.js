async page => {
  await page.route('**/lancamentos',route=>route.fulfill({json:{lancamentos:[{id:'extremo',descricao:'DescriçãoSemEspaços'.repeat(12),valor:12345678901234.56,vencimento:'2026-10-30',direcao:'RECEITA',pago:false}]}}));
  await page.goto('http://127.0.0.1:5185/novo/#/financeiro');
  await page.reload();
  await page.locator('.tabela-fluida').waitFor();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const m=await page.locator('.tabela-adaptavel').evaluate(t=>({caixa:t.clientWidth,conteudo:t.scrollWidth}));
    if(m.conteudo>m.caixa+1) throw new Error(JSON.stringify({width,m}));
    const sobrepostas=await page.locator('.tabela-fluida tbody td').evaluateAll(celulas=>celulas.filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.textContent));
    if(sobrepostas.length) throw new Error('Celulas sobrepostas: '+JSON.stringify({width,sobrepostas}));
  }
  await page.unroute('**/lancamentos');
}
