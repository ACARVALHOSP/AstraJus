async (page) => {
  page.setDefaultTimeout(10000);
  await page.unroute('**/*');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const day = n => { const d = new Date(); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const cases = [{id:'p1',titulo:'Silva × Banco Nacional',responsavel:'Mariana Costa'},{id:'p2',titulo:'Oliveira × Seguradora',responsavel:'Pedro Lima'}];
  const activities = {
    p1: [
      {id:1,titulo:'Preparar contestação',tipo:'prazo',status:'pendente',responsavel:'Mariana Costa',data:day(-2)},
      {id:2,titulo:'Revisar recurso',tipo:'prazo',status:'em_andamento',responsavel:'Pedro Lima',data:day(-1)},
      {id:3,titulo:'Receber documentos',tipo:'tarefa',status:'aguardando',responsavel:'Mariana Costa',data:day(3)},
      {id:4,titulo:'Enviar relatório',tipo:'tarefa',status:'concluida',responsavel:'Pedro Lima',data:day(-1)},
    ],
    p2: [
      {id:5,titulo:'Conferir documentos',tipo:'tarefa',status:'pendente',responsavel:'Pedro Lima',data:day(0)},
      {id:6,titulo:'Elaborar manifestação',tipo:'prazo',status:'em_andamento',responsavel:'Mariana Costa',data:day(0)},
      {id:7,titulo:'Acompanhar laudo',tipo:'tarefa',status:'aguardando',responsavel:'Pedro Lima',data:day(7)},
      {id:8,titulo:'Protocolar petição',tipo:'prazo',status:'concluida',responsavel:'Mariana Costa',data:day(-2)},
      {id:9,titulo:'Protocolar manifestação',tipo:'prazo',status:'pendente',responsavel:'Mariana Costa',data:day(0)},
    ],
  };
  let patchFail = false, failProcess = false, failPubs = false, checkFail = false;
  const patches = [];
  await page.route('**/*', async route => {
    const req=route.request(), url=new URL(req.url()), path=url.pathname;
    const json = (data, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/mcp') {
      const body=req.postDataJSON(); return json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fixture',version:'1'}}});
    }
    if(path==='/responsaveis/me') return json({usuario:{login:'mariana',nome_completo:'Mariana Costa',nivel_acesso:'administrador'}});
    if(path==='/responsaveis') return json({responsaveis:['Mariana Costa','Pedro Lima']});
    if(path==='/notificacoes') return json({notificacoes:[],proximo_cursor:null,nao_lidas:0});
    if(path==='/publicacoes-oab') return failPubs ? json({mensagem:'Publicações indisponíveis'},503) : json({publicacoes:[],total:4,pagina:1});
    if(path==='/casos') return json({casos:cases});
    const checklist=path.match(/^\/casos\/([^/]+)\/atividades\/(\d+)\/checklist$/);
    if(checklist) return checkFail ? json({mensagem:'Checklist indisponível'},503) : json({itens:[{id:1,texto:'Conferir',concluido:true},{id:2,texto:'Revisar',concluido:false}]});
    const act=path.match(/^\/casos\/([^/]+)\/atividades(?:\/(\d+))?$/);
    if(act) {
      if(req.method()==='PATCH') {
        patches.push(req.postDataJSON());
        if(patchFail) return json({mensagem:'Falha simulada ao salvar'},503);
        const a=activities[act[1]].find(a=>a.id===Number(act[2])); Object.assign(a,req.postDataJSON()); return json(a);
      }
      if(req.method()==='POST') {const a={...req.postDataJSON(),id:10,status:'pendente'};activities[act[1]].push(a);return json(a,201);}
      return failProcess && act[1]==='p2' ? json({mensagem:'Indisponível'},503) : json({atividades:activities[act[1]]});
    }
    return route.continue();
  });
  await page.setViewportSize({width:1600,height:1120});
  await page.goto('http://127.0.0.1:5179/novo/');
  await page.evaluate(()=>localStorage.removeItem('cnj_token'));
  await page.reload();
  await page.getByRole('heading',{name:'Meu dia',exact:true}).waitFor();
  await page.getByRole('button',{name:'Ir para Acesso',exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('cnj_token','fixture-home-only'));
  await page.reload();
  await page.getByRole('button',{name:'Preparar contestação',exact:true}).waitFor();
  await page.getByRole('button',{name:'Atualizar',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('.home-titulo-quadro button')?.disabled, null, {timeout:10000});
  const check = (ok,msg)=>{if(!ok)throw Error(msg);};
  check(await page.locator('.home-cartao').count()===9,'9 cartões esperados');
  for(const [c,n] of [['atrasadas','2'],['hoje','3'],['semana','2'],['publicacoes','4']]) check(await page.locator(`.home-metrica-${c} strong`).innerText()===n,`Resumo ${c}`);
  await page.screenshot({path:'.scratch/home-kanban/desktop.png',fullPage:true});
  await page.locator('.home-metrica-atrasadas').click();
  check(await page.locator('.home-cartao').count()===2,'Filtro atrasadas');
  await page.getByRole('button',{name:'Limpar filtros'}).click();
  await page.locator('#home-executor').selectOption('Pedro Lima');
  check(await page.locator('.home-cartao').count()===4,'Filtro executor');
  await page.getByRole('button',{name:'Limpar filtros'}).click();
  await page.getByLabel('Alterar status: Preparar contestação',{exact:true}).selectOption('em_andamento');
  await page.locator('.home-coluna-em_andamento').getByRole('button',{name:'Preparar contestação',exact:true}).waitFor();
  check(patches[0].status==='em_andamento','PATCH status');
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.locator('.home-coluna-em_andamento').getByRole('button',{name:'Preparar contestação',exact:true}).waitFor();
  patchFail=true;
  await page.getByLabel('Alterar status: Preparar contestação',{exact:true}).selectOption('concluida');
  await page.getByText('Falha simulada ao salvar',{exact:false}).waitFor();
  check(await page.locator('.home-coluna-em_andamento').getByRole('button',{name:'Preparar contestação',exact:true}).count()===1,'Falha deve preservar coluna');
  patchFail=false;
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('button',{name:'Preparar contestação',exact:true}).waitFor();
  const source=page.locator('.home-coluna-pendente .home-cartao').filter({hasText:'Conferir documentos'});
  await source.dragTo(page.locator('.home-coluna-aguardando .home-coluna-titulo'));
  await page.locator('.home-coluna-aguardando').getByRole('button',{name:'Conferir documentos',exact:true}).waitFor();
  await page.getByRole('button',{name:'Nova atividade',exact:true}).click();
  await page.locator('#home-nova-processo').selectOption('p1');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.locator('#atividade-titulo').fill('Preparar audiência');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.getByRole('button',{name:'Preparar audiência',exact:true}).waitFor();
  await page.getByRole('button',{name:'Alternar tema',exact:true}).click();
  await page.screenshot({path:'.scratch/home-kanban/dark.png',fullPage:true});
  await page.getByRole('button',{name:'Alternar tema',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.locator('#home-coluna').selectOption('aguardando');
  check(await page.locator('.home-coluna-container:visible').count()===1,'Uma coluna no celular');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Sem overflow horizontal');
  await page.screenshot({path:'.scratch/home-kanban/mobile.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  check(await page.locator('.home-coluna-aguardando').evaluate(e=>parseFloat(getComputedStyle(e).transitionDuration))<=0.00001,'Movimento reduzido');
  await page.setViewportSize({width:1600,height:1120});
  failProcess=true;failPubs=true;checkFail=true;
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByText('Painel parcialmente carregado',{exact:true}).waitFor();
  check(await page.locator('.home-metrica-publicacoes strong').innerText()==='—','Falha não vira zero publicações');
  check(await page.getByRole('button',{name:'Revisar recurso',exact:true}).count()===1,'Preservar processo disponível');
  await page.screenshot({path:'.scratch/home-kanban/falha-parcial.png',fullPage:true});
  failProcess=false;failPubs=false;checkFail=false;
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await page.getByRole('button',{name:'Preparar audiência',exact:true}).waitFor();
  await page.locator('.home-metrica-publicacoes').click();
  await page.getByRole('heading',{name:'Publicações monitoradas',exact:true}).waitFor().catch(()=>{});
  check(await page.locator('#pub-oab-filtro-status').inputValue()==='nao_tratada','Triagem deve abrir filtrada');
  check(errors.length===0,'Erros JS: '+errors.join('; '));
  console.log(JSON.stringify({ok:true,checks:['resumos','filtros','persistência após atualizar','falha PATCH','arraste','nova atividade','tema escuro','celular sem overflow','movimento reduzido','falha parcial','triagem filtrada'],patches,errors}));
}
