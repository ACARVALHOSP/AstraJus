async (page) => {
  page.setDefaultTimeout(10000);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'AstraJus',exact:true}).click();
  await page.getByRole('heading',{name:'Meu dia',exact:true}).waitFor();
  await page.locator('.home-cartao').first().waitFor();
  for (const width of [320,672,1056]) {
    await page.setViewportSize({width,height:900});
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Overflow '+width);
  }
  await page.setViewportSize({width:1600,height:1120});
  await page.route('**/casos',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({casos:[]})}));
  await page.evaluate(()=>{localStorage.setItem('cnj_token','fixture-other-account');location.hash='/inicio'});
  await page.reload();
  await page.getByText('Nenhuma atividade nesta coluna com os filtros atuais.').first().waitFor();
  if(await page.locator('.home-cartao').count())throw Error('Dados de outra conta');
  await page.getByRole('button',{name:'Nova atividade',exact:true}).click();
  await page.getByText('Cadastre um processo para associar a nova atividade.').waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.evaluate(()=>localStorage.removeItem('cnj_token'));
  await page.reload();
  await page.getByRole('button',{name:'Ir para Acesso',exact:true}).waitFor();
  if(await page.locator('.home-cartao').count())throw Error('Dados após sair');
  return {ok:true,checks:['320px','672px','1056px','troca de conta','estado vazio','sem conexão']};
}
