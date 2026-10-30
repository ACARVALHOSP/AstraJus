async page => {
  await page.setViewportSize({width:390,height:900});
  await page.goto('http://127.0.0.1:5185/novo/#/contatos');
  await page.getByRole('checkbox',{name:'Selecionar todas as linhas'}).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Atualizar perfil',exact:true}).click();
  await page.route('**/clientes/acoes-em-massa',route=>route.fulfill({json:{mudancas:[{id:'c1',nome:'Maria Aparecida de Oliveira Santos com sobrenome muito longo',atual:'contato',depois:'cliente',alterado:true}],alterados:1,sem_alteracao:0}}));
  await page.getByRole('button',{name:'Revisar alterações',exact:true}).click();
  await page.locator('[role=dialog] .tabela-fluida').waitFor();
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(await page.locator('[role=dialog] .tabela-adaptavel').evaluate(t=>t.scrollWidth>t.clientWidth+1)) throw new Error('Revisao em lote: '+width);
  }
  await page.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.goto('http://127.0.0.1:5185/novo/#/financeiro');
  await page.getByRole('button',{name:'Novo lançamento',exact:true}).click();
  await page.getByRole('textbox',{name:'Valor (R$) *',exact:true}).fill('2450,00');
  await page.getByRole('textbox',{name:'Vencimento *',exact:true}).fill('30/10/2026');
  await page.keyboard.press('Tab');
  await page.getByRole('checkbox',{name:'Parcelar',exact:true}).focus();
  await page.keyboard.press('Space');
  await page.locator('[role=dialog] .previa-parcelas-tabela').waitFor();
  for(const width of [1440,768,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(await page.locator('[role=dialog] .tabela-adaptavel').evaluate(t=>t.scrollWidth>t.clientWidth+1)) throw new Error('Parcelas: '+width);
  }
  await page.screenshot({path:'.scratch/tabelas-responsivas/parcelas-mobile.png',fullPage:true});
}
