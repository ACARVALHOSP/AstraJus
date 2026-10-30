async page => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.unrouteAll();
  await page.clock.install();
  const state = { lidas: new Set(), revogado: false, falha: false, atrasar: false, retida: null, nova: false, logs: [], errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  const itens = () => [
    {id:'1', titulo:'Atividade atribuída', mensagem:'Conferir documentos do processo', destino:{tipo:'atividade',caso_id:'p1',atividade_id:1}},
    {id:'2', titulo:'Nova publicação monitorada', mensagem:'Confira a publicação na área autorizada.', destino:{tipo:'publicacoes_processo',caso_id:'p1'}},
    {id:'3', titulo:'Nova publicação monitorada', mensagem:'Confira as publicações monitoradas.', destino:{tipo:'publicacoes_monitoradas'}},
    ...(state.nova ? [{id:'4',titulo:'Atividade atribuída',mensagem:'Segunda providência',destino:{tipo:'atividade',caso_id:'p2',atividade_id:2}}] : []),
  ].map(n => ({...n, criado_em:'2026-10-30T12:00:00Z', lida_em:state.lidas.has(n.id) ? '2026-10-30T13:00:00Z' : null})).filter(n => !state.revogado || n.id !== '1');
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
    if (p === '/mcp') {
      const b = req.postDataJSON();
      const result = b.method === 'tools/call' ? {content:[{type:'text',text:JSON.stringify({encontrado:false,mensagem:'Sem resultado fictício.'})}]} : {protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'simulado',version:'1'}};
      return route.fulfill({json:{jsonrpc:'2.0',id:b.id,result}});
    }
    if(p === '/notificacoes') {
      state.logs.push({p,query:Object.fromEntries(url.searchParams),token:req.headers().authorization});
      if(state.atrasar && url.searchParams.get('limite') === '20') {
        state.retida = route;
        state.atrasar = false;
        return;
      }
      if(state.falha) return route.fulfill({status:503,json:{mensagem:'Serviço temporariamente indisponível.'}});
      const todos = req.headers().authorization === 'Bearer sessao-b' ? [] : itens();
      const filtrados = url.searchParams.get('estado') === 'nao_lidas' ? todos.filter(n => !n.lida_em) : todos;
      const cursor = url.searchParams.get('cursor');
      const limite = Number(url.searchParams.get('limite'));
      return route.fulfill({json:{notificacoes:limite === 1 ? filtrados.slice(0,1) : cursor ? filtrados.slice(2) : filtrados.slice(0,2), nao_lidas:todos.filter(n => !n.lida_em).length,proximo_cursor:limite > 1 && !cursor && filtrados.length > 2 ? 'pagina-2' : null}});
    }
    if(p.startsWith('/notificacoes/')) {
      state.logs.push({p,method:req.method()});
      const id = p.split('/')[2];
      if(state.revogado && id === '1') return route.fulfill({status:404,json:{mensagem:'Notificação indisponível.'}});
      if(p.endsWith('/destino')) return route.fulfill({json:{destino:itens().find(n=>n.id===id).destino}});
      if(req.method() === 'PATCH') {
        state.lidas.add(id);
        return route.fulfill({json:{id,lida_em:'2026-10-30T13:00:00Z'}});
      }
    }
    const respostas = {
      '/responsaveis/me':{usuario:{login:'ana',nome_completo:'Ana Exemplo',nivel_acesso:'administrador'}},
      '/responsaveis':{responsaveis:['Ana Exemplo']},
      '/clientes':{clientes:[]},
      '/casos':{casos:[{id:'p1',titulo:'Processo fictício um',processos:[]},{id:'p2',titulo:'Processo fictício dois',processos:[]}]},
      '/casos/p1':{id:'p1',titulo:'Processo fictício um',processos:[]},
      '/casos/p2':{id:'p2',titulo:'Processo fictício dois',processos:[]},
      '/casos/p1/atividades':{atividades:[{id:1,titulo:'Conferir documentos do processo',tipo:'tarefa',status:'pendente'}]},
      '/casos/p2/atividades':{atividades:[{id:2,titulo:'Segunda providência',tipo:'tarefa',status:'pendente'}]},
      '/casos/p1/publicacoes':{publicacoes:[]},'/casos/p2/publicacoes':{publicacoes:[]},
      '/casos/p1/vinculos':{vinculos:[]},'/casos/p2/vinculos':{vinculos:[]},
      '/publicacoes-oab':{publicacoes:[],total:0,pagina:1,hashes_disponiveis:[]},
    };
    if(p.endsWith('/checklist')) return route.fulfill({json:{itens:[]}});
    if(p in respostas) return route.fulfill({json:respostas[p]});
    if(p.startsWith('/casos/') && p.endsWith('/capa')) return route.fulfill({json:{encontrado:false}});
    return route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('cnj_token','sessao-a'));
  await page.goto('http://127.0.0.1:5194/novo/');
  await page.getByRole('button',{name:'Notificações: 3 não lidas',exact:true}).waitFor();
  await page.getByRole('button',{name:'Notificações: 3 não lidas',exact:true}).click();
  await page.getByRole('region',{name:'Notificações',exact:true}).getByRole('button',{name:'Abrir atividade',exact:true}).waitFor();
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (predicate, message) => {
    for (let i=0;i<100;i++) { if(await predicate()) return; await page.waitForTimeout(25); }
    throw new Error(message);
  };
  const painel = page.locator('#painel-notificacoes');
  const sino = page.getByRole('button',{name:/^Notificações:/});
  const abrir = async () => { await sino.click(); await painel.waitFor(); await wait(async()=>!(await painel.locator('[aria-busy="true"]').count()),'feed não concluiu'); };
  const fechar = async () => { if(await painel.isVisible()) await page.keyboard.press('Escape'); };
  const resultados = [];
  ok(await painel.locator('li').count()===2,'primeira página');
  await painel.getByRole('button',{name:'Carregar mais',exact:true}).click();
  await wait(async()=>await painel.locator('li').count()===3,'paginação');
  ok(state.logs.some(n=>n.query?.cursor==='pagina-2'),'cursor não enviado');
  resultados.push('paginação');
  state.lidas.add('2');
  await painel.locator('label[for=notificacoes-filtro]').click();
  await wait(async()=>await painel.locator('li').count()===2,'filtro não recarregou');
  ok(state.logs.filter(n=>n.query?.limite==='20').at(-1).query.estado==='nao_lidas','filtro não enviado');
  ok(!state.logs.filter(n=>n.query?.limite==='20').at(-1).query.cursor,'cursor antigo no filtro');
  await painel.getByRole('button',{name:'Marcar como lida',exact:true}).first().click();
  await wait(async()=>await painel.locator('li').count()===1,'lida não removida do filtro');
  await page.getByRole('button',{name:'Notificações: 1 não lidas',exact:true}).waitFor();
  resultados.push('filtro imediato e leitura explícita');
  await painel.locator('label[for=notificacoes-filtro]').click();
  await painel.getByRole('button',{name:'Abrir atividade',exact:true}).waitFor();
  const leituras = state.logs.filter(n=>n.method==='PATCH').length;
  await painel.getByRole('button',{name:'Abrir atividade',exact:true}).click();
  await page.getByRole('dialog',{name:'Editar atividade',exact:true}).waitFor();
  ok(await page.locator('#atividade-titulo').inputValue()==='Conferir documentos do processo','atividade errada');
  ok(state.logs.filter(n=>n.method==='PATCH').length===leituras,'abrir marcou leitura');
  ok(state.logs.some(n=>n.p==='/notificacoes/1/destino'),'destino não revalidado');
  resultados.push('atividade exata e revalidação sem leitura');
  await page.keyboard.press('Escape');
  await abrir();
  await painel.getByRole('button',{name:'Abrir publicações',exact:true}).first().click();
  await page.getByRole('tab',{name:'Publicações',exact:true,selected:true}).waitFor();
  await page.getByRole('heading',{name:'Publicações vinculadas',exact:true}).waitFor();
  resultados.push('aba Publicações com Processos já aberto');
  state.nova=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Notificações: 2 não lidas',exact:true}).waitFor();
  const antesIntervalo=state.logs.length;
  await page.clock.fastForward(60_000);
  await wait(()=>state.logs.length>antesIntervalo,'intervalo não atualizou');
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }));
  const antesOculta=state.logs.length;
  await page.clock.fastForward(60_000);
  ok(state.logs.length===antesOculta,'polling com página oculta');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(()=>state.logs.length>antesOculta,'retorno à aba não atualizou');
  resultados.push('contador ao retornar, intervalo de 60 segundos e pausa em aba oculta');
  await abrir();
  await painel.getByRole('button',{name:'Carregar mais',exact:true}).click();
  await wait(async()=>await painel.locator('li').count()===4,'segunda página com evento novo');
  await painel.locator('li').filter({hasText:'Segunda providência'}).getByRole('button',{name:'Abrir atividade',exact:true}).click();
  await page.getByRole('dialog',{name:'Editar atividade',exact:true}).waitFor();
  ok(await page.locator('#atividade-titulo').inputValue()==='Segunda providência','navegação no mesmo módulo abriu atividade errada');
  resultados.push('outro processo sem sair do módulo');
  await page.keyboard.press('Escape');
  await abrir();
  await painel.getByRole('button',{name:'Carregar mais',exact:true}).click();
  await painel.locator('li').filter({hasText:'Confira as publicações monitoradas.'}).getByRole('button',{name:'Abrir publicações',exact:true}).click();
  await wait(async()=>page.url().endsWith('#/publicacoes-oab'),'não abriu publicações monitoradas');
  resultados.push('publicações monitoradas');
  await abrir();
  state.revogado=true;
  await painel.getByRole('button',{name:'Abrir atividade',exact:true}).click();
  await painel.getByText('Notificação indisponível.',{exact:true}).waitFor();
  ok(!(await painel.getByText('Conferir documentos do processo',{exact:true}).count()),'origem revogada preservada no feed');
  resultados.push('origem indisponível remove item e impede navegação');
  state.falha=true;
  await painel.getByRole('button',{name:'Atualizar',exact:true}).click();
  await painel.getByText('Serviço temporariamente indisponível.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Notificações: Contagem indisponível',exact:true}).waitFor();
  ok(!await painel.getByText('Nenhuma notificação nos últimos 180 dias.',{exact:true}).count(),'falha exibida como vazio');
  state.falha=false;
  await painel.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await wait(async()=>await painel.locator('li').count()===2,'nova tentativa não recuperou feed');
  resultados.push('erro distinto de vazio e nova tentativa');
  state.atrasar=true;
  state.retida=null;
  await painel.getByRole('button',{name:'Atualizar',exact:true}).click();
  await wait(()=>!!state.retida,'requisição atrasada ausente');
  await painel.locator('label[for=notificacoes-filtro]').click();
  await wait(async()=>await painel.locator('li').count()===2,'filtro novo não concluiu');
  await state.retida.fulfill({json:{notificacoes:[{id:'99',titulo:'Resposta antiga',mensagem:'Não exibir',criado_em:'2026-10-30',destino:{tipo:'publicacoes_monitoradas'}}],nao_lidas:99,proximo_cursor:null}}).catch(()=>{});
  await page.waitForTimeout(150);
  ok(!await painel.getByText('Resposta antiga',{exact:true}).count(),'resposta atrasada sobrescreveu filtro');
  resultados.push('resposta antiga descartada após mudança de filtro');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(100);
    const box=await painel.boundingBox();
    ok(box.x>=0 && box.x+box.width<=width,'painel fora da tela');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'rolagem horizontal');
    await page.screenshot({path:`output/playwright/notificacoes/white-${width}.png`,animations:'disabled'});
  }
  await fechar();
  ok(await sino.evaluate(el=>el===document.activeElement),'Escape não devolveu foco');
  await page.getByRole('button',{name:'Alternar tema',exact:true}).click();
  await abrir();
  await page.screenshot({path:'output/playwright/notificacoes/g100-390.png',animations:'disabled'});
  await page.emulateMedia({reducedMotion:'reduce'});
  ok(await painel.evaluate(el=>parseFloat(getComputedStyle(el).animationDuration)<0.01),'movimento reduzido não respeitado');
  resultados.push('white/g100, celular, Escape e movimento reduzido');
  await fechar();
  await page.evaluate(()=>window.location.hash='/acesso');
  await page.getByRole('heading',{name:'Acesso',exact:true}).waitFor();
  state.atrasar=true; state.retida=null;
  await sino.click();
  await wait(()=>!!state.retida,'requisição de sessão não retida');
  await page.getByRole('button',{name:'Esquecer',exact:true}).click();
  await page.getByRole('textbox',{name:'Seu token de acesso',exact:true}).fill('sessao-b');
  await page.getByRole('button',{name:'Conectar',exact:true}).click();
  await page.getByRole('button',{name:'Notificações: 0 não lidas',exact:true}).waitFor();
  await state.retida.fulfill({json:{notificacoes:[{id:'99',titulo:'Usuário anterior',mensagem:'Não exibir',criado_em:'2026-10-30',destino:{tipo:'publicacoes_monitoradas'}}],nao_lidas:99,proximo_cursor:null}}).catch(()=>{});
  await abrir();
  await painel.getByText('Nenhuma notificação nos últimos 180 dias.',{exact:true}).waitFor();
  ok(!await painel.getByText('Usuário anterior',{exact:true}).count(),'sessão antiga vazou');
  ok(state.errors.length===0,`erros JavaScript: ${state.errors.join('; ')}`);
  resultados.push('troca de sessão com resposta atrasada e vazio confirmado');
  return {resultados,errors:state.errors,requests:state.logs.length};
}



