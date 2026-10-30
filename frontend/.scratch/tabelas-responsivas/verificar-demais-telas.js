async page => {
  async function conferir(rotulo) {
    await page.locator('.tabela-fluida:visible').first().waitFor();
    for (const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      for (const tabela of await page.locator('.tabela-adaptavel:visible').all()) {
        const m=await tabela.evaluate(t=>({caixa:t.clientWidth,conteudo:t.scrollWidth}));
        if(m.conteudo>m.caixa+1) throw new Error(JSON.stringify({rotulo,width,m}));
      }
    }
  }
  await page.goto('http://127.0.0.1:5185/novo/#/administracao');
  await page.getByRole('button',{name:'Acessar administração',exact:true}).click();
  await conferir('usuarios e acessos vazios');
  await page.getByRole('button',{name:'Carregar acessos',exact:true}).click();
  await conferir('acessos preenchidos');
  await page.getByRole('tab',{name:'Histórico administrativo',exact:true}).click();
  await page.getByRole('button',{name:'Carregar histórico',exact:true}).click();
  await conferir('historico administrativo');
  await page.goto('http://127.0.0.1:5185/novo/#/contatos');
  await page.locator('tbody button.contato-nome-link').first().click();
  await page.getByRole('tab',{name:'Processos vinculados',exact:true}).click();
  await conferir('processos do contato');
  await page.getByRole('tab',{name:'Financeiro',exact:true}).click();
  await conferir('financeiro do contato');
  await page.route('**/capa',route=>route.fulfill({json:{}}));
  await page.goto('http://127.0.0.1:5185/novo/#/casos');
  await page.locator('.casos-celula-principal button.texto-tabela').first().click();
  await page.getByRole('tab',{name:'Vínculos',exact:true}).click();
  await conferir('vinculos do processo');
  await page.goto('http://127.0.0.1:5185/novo/#/publicacoes');
  await page.getByRole('textbox',{name:'Número do processo',exact:true}).fill('10012345620268260100');
  await page.getByRole('button',{name:'Consultar publicações',exact:true}).click();
  await conferir('publicacoes de consulta');
  await page.locator('.cds--table-expand__button').first().click();
  if(!await page.locator('tr[data-child-row]').first().isVisible()) throw new Error('Expansao Carbon de consulta');
  if(await page.locator('.tabela-adaptavel').evaluate(t=>t.scrollWidth>t.clientWidth+1)) throw new Error('Expansao Carbon ultrapassou largura');
}
