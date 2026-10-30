async page => {
  const resultados=[];
  for (const tela of ['casos','contatos','financeiro','pagamentos','historico','publicacoes-oab']) {
    await page.goto('http://127.0.0.1:5185/novo/#/'+tela);
    await page.locator('.tabela-fluida').first().waitFor();
    for (const largura of [1440,1024,768,390,320]) {
      await page.setViewportSize({width:largura,height:900});
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const medidas=await page.locator('.tabela-adaptavel').evaluateAll(tabelas => tabelas.map(t => ({largura:t.clientWidth,conteudo:t.scrollWidth,compacta:t.classList.contains('tabela-adaptavel--compacta'),colunas:t.querySelectorAll('thead th').length})));
      resultados.push({tela,largura,medidas});
      for(const m of medidas) if(m.conteudo>m.largura+1) throw new Error(JSON.stringify({tela,largura,medidas}));
      const sobrepostas=await page.locator('.tabela-fluida tbody td:visible').evaluateAll(celulas=>celulas.filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.textContent));
      if(sobrepostas.length) throw new Error(JSON.stringify({tela,largura,sobrepostas}));
    }
  }
  console.log(JSON.stringify(resultados));
}
