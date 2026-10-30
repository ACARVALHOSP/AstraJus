const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require('playwright'); } catch { /* use the installed CLI's package */ }
  const cache = path.join(os.homedir(), 'AppData/Local/npm-cache/_npx');
  for (const entry of fs.readdirSync(cache)) { const p = path.join(cache, entry, 'node_modules/playwright'); if (fs.existsSync(p)) return require(p); }
  throw new Error('Defina PLAYWRIGHT_MODULE com o caminho do pacote Playwright instalado.');
}
const { chromium } = playwright();
const out = path.resolve('output/playwright/atividade-modal-pdf'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const requests = [], errors = [], results = [];
  let caseCreated = 0, activityCreated = 0, failCover = true, failStatus = false, batchPartial = false;
  const cases = [];
  const pubs = Array.from({ length: 7 }, (_, i) => ({ hash: `p${i+1}`, status: 'nao_tratada', numero_processo: `100000${i+1}0020268260001`, caso_id: i === 0 ? 'existente' : null, criado_em: '2026-10-30', dados: { siglaTribunal: 'TJSP', nomeOrgao: '1ª Vara Cível', nomeClasse: 'Procedimento comum', tipoComunicacao: 'Intimação', data_disponibilizacao: '2026-10-30', texto: 'Texto original: manifeste-se no prazo de 5 dias. NÃO ALTERAR.', link: 'https://comunica.pje.jus.br/consulta', destinatarios: [{ nome: 'ANA SILVA', polo: 'A' }, { nome: 'EMPRESA EXEMPLO', polo: 'P' }], meio: 'D', campoExtenso: 'Metadado de teste' } }));
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (!['localhost','127.0.0.1'].includes(u.hostname)) return route.abort();
    const body = req.method() !== 'GET' ? req.postDataJSON() : null;
    let data;
    if (p === '/mcp') {
      if (body.method === 'tools/call') {
        requests.push({ p, body }); const args = body.params.arguments;
        data = { content: [{ type: 'text', text: JSON.stringify({ municipio: args.municipio, ano: args.ano, feriados: [{ data: `${args.ano}-11-02`, descricao: 'Finados' }] }) }] };
      } else data = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
      return route.fulfill({ json: { jsonrpc:'2.0', id:body.id, result:data }, headers: { 'mcp-session-id':'fixture' } });
    }
    if (p === '/publicacoes-oab') {
      const filtered = pubs.filter(x => !u.searchParams.get('status') || x.status === u.searchParams.get('status'));
      const size = Number(u.searchParams.get('tamanho')), page = Math.min(Number(u.searchParams.get('pagina')), Math.max(1,Math.ceil(filtered.length/size)));
      data = { total: filtered.length, pagina: page, publicacoes: filtered.slice((page-1)*size,page*size), hashes_disponiveis: filtered.map(x=>x.hash), campos_djen: Object.keys(pubs[0].dados) };
    }
    if (p === '/publicacoes-oab/status') {
      requests.push({ p, body });
      if (failStatus) { failStatus=false; return route.fulfill({ status:503, json:{ mensagem:'Falha simulada ao marcar status' } }); }
      const failed = batchPartial ? body.hashes.slice(-1) : []; batchPartial=false;
      const success = body.hashes.filter(h=>!failed.includes(h)); for (const pub of pubs) if (success.includes(pub.hash)) pub.status=body.status;
      data = { hashes_atualizados:success, hashes_falharam:failed, atualizadas:success.length };
    }
    if (p === '/clientes') data={ clientes:[{ id:'cliente1',nome:'Ana Silva' }] };
    if (p === '/responsaveis') data={ responsaveis:['Responsável Teste'] };
    if (p === '/casos') data={ casos:cases.filter(c=>!u.searchParams.get('q') || c.processos.includes(u.searchParams.get('q'))) };
    if (/\/publicacoes-oab\/p\d+\/criar-caso$/.test(p)) {
      requests.push({p,body}); caseCreated++; const pub=pubs.find(x=>p.includes(`/${x.hash}/`));
      const c={id:'novo',titulo:'Ana Silva X Empresa Exemplo',processos:[pub.numero_processo]};cases.push(c);pub.caso_id=c.id;pub.status='tratada';data=c;
    }
    if (p.endsWith('/capa/atualizar')) { requests.push({p,body}); if(failCover){failCover=false;return route.fulfill({status:503,json:{mensagem:'Falha simulada na capa'}})} data={tribunal:'TJSP',cidade:'São Paulo'}; }
    if (p.endsWith('/capa')) data={ cidade:'São Paulo',tribunal:'TJSP' };
    if (p.endsWith('/atividades') && req.method()==='POST') { requests.push({p,body}); activityCreated++;data={id:activityCreated}; }
    if (p.startsWith('/notificacoes')) data={notificacoes:[],total:0,nao_lidas:0};
    if(data!==undefined)return route.fulfill({json:data});
    if(req.method()!=='GET')return route.fulfill({status:503,json:{mensagem:'Operação não simulada'}});
    return route.continue();
  });
  await context.addInitScript(()=>{localStorage.setItem('cnj_token','fixture-oab');if(!localStorage.getItem('cnj_pub_oab_colunas_visiveis_react_v1'))localStorage.setItem('cnj_pub_oab_colunas_visiveis_react_v1','["desconhecido"]')});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  async function check(label, fn){await fn();results.push(label);console.log('OK',label)}
  async function shot(label){await page.screenshot({path:path.join(out,label+'.png'),fullPage:true})}
  await page.goto('http://127.0.0.1:5199/novo/#/publicacoes-oab',{waitUntil:'domcontentloaded'});await page.getByRole('table').waitFor();await page.getByRole('checkbox',{name:'Selecionar publicação p1',exact:true}).waitFor();
  await check('Três colunas obrigatórias; opcional desconhecida ignorada',async()=>{assert.equal(await page.locator('thead th').count(),6);assert.equal(await page.getByRole('columnheader',{name:/Nome do processo/}).count(),1)});
  await page.getByRole('button',{name:'Colunas',exact:true}).click();
  await check('Obrigatórias marcadas e desabilitadas',async()=>{const c=page.getByRole('checkbox',{name:'Tribunal — sempre visível'});assert(await c.isChecked());assert(await c.isDisabled())});
  await page.locator('label[for="oab-coluna-status"]').click();await page.getByRole('columnheader',{name:/Status/}).waitFor();await check('Alternância imediata de Status',async()=>assert.equal(await page.locator('thead th').count(),7));
  await shot('01-colunas-white');await page.keyboard.press('Escape');
  await check('Escape devolve foco ao seletor',async()=>assert.equal(await page.getByRole('button',{name:'Colunas',exact:true}).evaluate(e=>e===document.activeElement),true));
  await page.getByRole('checkbox',{name:'Selecionar publicação p1',exact:true}).focus();await page.keyboard.press('Space');
  await check('Lote bloqueia ações individuais',async()=>{assert(await page.getByRole('button',{name:'Ações da publicação p1',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Abrir publicação DJEN p1 em nova aba',exact:true}).isDisabled())});
  await page.getByRole('button',{name:'Próxima página',exact:true}).click();await page.getByRole('checkbox',{name:'Selecionar publicação p6',exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Selecionar publicação p6',exact:true}).focus();await page.keyboard.press('Space');
  await check('Seleção persiste entre páginas',async()=>assert(await page.getByText('2 selecionados',{exact:true}).isVisible()));
  batchPartial=true;await page.getByRole('button',{name:'Marcar como tratada',exact:true}).click();await page.getByText(/1 atualizada\(s\); 1 falharam/).waitFor();
  await check('Lote usa IDs de páginas distintas e preserva falha',async()=>{assert.deepEqual(requests.find(x=>x.p==='/publicacoes-oab/status').body.hashes,['p1','p6']);assert(await page.getByRole('checkbox',{name:'Selecionar publicação p6',exact:true}).isChecked())});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button',{name:'Página anterior',exact:true}).click();await page.getByRole('checkbox',{name:'Selecionar publicação p1',exact:true}).waitFor();
  await page.getByRole('button',{name:'Expandir publicação p1',exact:true}).click();
  await check('Expansão preserva texto original e colspan',async()=>{assert(await page.locator('#oab-detalhes-p1').getByText(pubs[0].dados.texto,{exact:true}).isVisible());assert.equal(await page.locator('#oab-detalhes-p1 td').getAttribute('colspan'),'7')});
  await page.getByRole('button',{name:'Ações da publicação p2',exact:true}).click();await page.getByRole('menuitem',{name:'Criar / vincular processo',exact:true}).click();
  await page.getByLabel('Cliente',{exact:true}).selectOption('cliente1');await page.getByLabel('Responsável',{exact:true}).selectOption('Responsável Teste');
  await page.getByRole('button',{name:'Criar processo e preencher capa',exact:true}).click();await page.getByText('Falha simulada na capa',{exact:true}).waitFor();
  await check('Processo criado é preservado após falha de capa',async()=>assert.equal(caseCreated,1));
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await page.getByText('Processo criado, capa preenchida e publicação tratada.',{exact:true}).waitFor();
  await check('Retry de capa não duplica processo',async()=>assert.equal(caseCreated,1));
  await page.getByRole('button',{name:'Ações da publicação p1',exact:true}).click();await page.getByRole('menuitem',{name:'Criar atividade',exact:true}).click();
  await page.getByText(/Data final sugerida:/).waitFor();
  await check('Prazo usa município da capa, calendário e quantidade detectada',async()=>{assert.equal(await page.getByLabel('Quantidade de dias',{exact:true}).inputValue(),'5');assert.equal(await page.getByLabel('Data final (editável)',{exact:true}).inputValue(),'2026-11-10');assert.equal(await page.getByLabel('Município / comarca',{exact:true}).inputValue(),'São Paulo')});
  await check('Modal médio com cerca de 690 px em 1440 px',async()=>{const b=await page.getByRole('dialog').boundingBox();assert(b.width>600&&b.width<750)});
  await check('Referência externa removida',async()=>assert.equal(await page.locator('a[href*="pgmprazos"]').count(),0));
  await page.setViewportSize({width:390,height:844});await shot('02-atividade-mobile');
  await check('Modal cabe em tela móvel',async()=>assert(await page.getByRole('dialog').evaluate(e=>e.getBoundingClientRect().width<=innerWidth&&e.scrollWidth<=e.clientWidth)));
  await page.setViewportSize({width:1440,height:1000});
  const [impressao]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Imprimir / salvar PDF',exact:true}).click()]);
  await impressao.getByRole('heading',{name:'Demonstrativo do prazo',exact:true}).waitFor();
  await check('Documento isolado, completo e sem link externo',async()=>{assert(await impressao.evaluate(()=>opener===null));assert.equal(await impressao.locator('tbody tr').count(),12);assert.equal(await impressao.locator('a').count(),0);assert(await impressao.getByText(/Pendente de revisão/).isVisible());assert(await impressao.getByText('Finados',{exact:true}).isVisible());assert(await impressao.getByText('Vencimento calculado',{exact:true}).isVisible())});
  await impressao.evaluate(()=>{window.print=()=>{window.printCalled=true}});await impressao.getByRole('button',{name:'Imprimir / salvar PDF',exact:true}).click();
  await check('Botão aciona a impressão nativa',async()=>assert(await impressao.evaluate(()=>window.printCalled)));
  await impressao.emulateMedia({media:'print'});await impressao.screenshot({path:path.join(out,'demonstrativo-impressao.png'),fullPage:true});
  await check('Estilos de impressão preservam cabeçalho e ocultam botão',async()=>{assert.equal(await impressao.getByRole('button',{name:'Imprimir / salvar PDF',exact:true}).count(),0);assert.equal(await impressao.locator('thead').evaluate(e=>getComputedStyle(e).display),'table-header-group')});
  const pdf=await impressao.pdf({path:path.join(out,'demonstrativo.pdf'),preferCSSPageSize:true,printBackground:true});
  await check('Navegador gera PDF A4 do demonstrativo',async()=>assert.equal(pdf.subarray(0,4).toString(),'%PDF'));
  await impressao.close();
  await shot('02-atividade-white');
  await page.evaluate(()=>{window.abrirOriginal=window.open;window.open=()=>null});await page.getByRole('button',{name:'Imprimir / salvar PDF',exact:true}).click();
  await check('Popup bloqueado recebe feedback',async()=>assert(await page.getByText(/Permita a abertura de pop-ups/).isVisible()));await page.evaluate(()=>{window.open=window.abrirOriginal});
  failStatus=true;await page.getByRole('button',{name:'Criar com prazo pendente de revisão',exact:true}).click();await page.getByText(/Atividade já criada/).waitFor();
  await page.getByRole('button',{name:'Concluir atualização de status',exact:true}).click();await page.getByText(/Atividade criada com prazo pendente de revisão, sem vencimento confirmado/).waitFor();
  await check('Prazo incompleto salvo sem data e retry não duplica atividade',async()=>{assert.equal(activityCreated,1);const req=requests.find(x=>x.p.endsWith('/atividades'));assert.equal(req.body.data,null);assert(req.body.observacoes.includes('pendente_revisao'))});
  await page.evaluate(()=>{window.abrirOriginal=window.open;window.open=(...args)=>{window.openArgs=args;return null}});
  await page.getByRole('button',{name:'Abrir publicação DJEN p1 em nova aba',exact:true}).click();
  await check('DJEN abre nova aba com isolamento',async()=>assert.deepEqual(await page.evaluate(()=>window.openArgs),['https://comunica.pje.jus.br/consulta','_blank','noopener,noreferrer']));
  await page.getByRole('button',{name:'Ações da publicação p1',exact:true}).click();
  await check('Processo vinculado oferece abertura do cadastro',async()=>assert(await page.getByRole('menuitem',{name:'Abrir processo',exact:true}).isVisible()));
  await page.getByRole('menuitem',{name:'Criar atividade',exact:true}).click();await page.getByText(/Data final sugerida:/).waitFor();
  await page.getByLabel('Data final (editável)',{exact:true}).fill('2026-11-11');
  await page.locator('label[for="oab-prazo-revisado"]').click();
  await page.evaluate(()=>{window.open=window.abrirOriginal});
  const [ajuste]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Imprimir / salvar PDF',exact:true}).click()]);await ajuste.getByRole('heading',{name:'Demonstrativo do prazo',exact:true}).waitFor();
  await check('PDF distingue ajuste manual da contagem original',async()=>{assert(await ajuste.getByText(/Ajuste manual: 11\/11\/2026/).isVisible());assert.equal(await ajuste.locator('tbody tr').last().locator('td').first().textContent(),'10/11/2026');assert(await ajuste.getByText('11/11/2026',{exact:true}).isVisible())});
  await ajuste.evaluate(()=>{const tbody=document.querySelector('tbody');const rows=[...tbody.rows];for(let i=0;i<12;i++)for(const row of rows)tbody.append(row.cloneNode(true))});
  const longo=await ajuste.pdf({path:path.join(out,'demonstrativo-longo.pdf'),preferCSSPageSize:true});
  await check('Demonstrativo longo produz várias páginas',async()=>assert((longo.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1));await ajuste.close();
  await page.getByRole('button',{name:'Confirmar atividade e prazo',exact:true}).click();
  await page.getByText('Atividade criada com prazo revisado. Publicação marcada como tratada.',{exact:true}).waitFor();
  await check('Revisão permite alterar e confirmar vencimento',async()=>{const req=requests.filter(x=>x.p.endsWith('/atividades')).at(-1);assert.equal(req.body.data,'2026-11-11');assert(req.body.observacoes.includes('"ajuste_manual":true'));assert(new TextEncoder().encode(JSON.stringify(req.body)).length<4096)});
  for(const theme of ['white','g100']){
    await page.evaluate(t=>{localStorage.setItem('cnj_tema',t)},theme);await page.reload();await page.getByRole('checkbox',{name:'Selecionar publicação p1',exact:true}).waitFor();
    for(const width of [1440,768,390,320]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
      await check(`${theme} ${width}px sem overflow global`,async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)));
      await check(`${theme} ${width}px toolbar sem sobreposição`,async()=>assert(await page.evaluate(()=>[...document.querySelectorAll('.oab-toolbar button,.oab-toolbar select')].every(e=>e.getBoundingClientRect().bottom<=document.querySelector('table').getBoundingClientRect().top+1))));
      if(width===1440)await check(`${theme} densidade M e fonte de 12 px`,async()=>{const m=await page.evaluate(()=>({header:document.querySelector('thead tr').getBoundingClientRect().height,row:document.querySelector('tbody tr').getBoundingClientRect().height,font:getComputedStyle(document.querySelector('tbody td.oab-celula-tribunal')).fontSize}));assert(Math.abs(m.header-40)<=1);assert(Math.abs(m.row-40)<=1);assert.equal(m.font,'12px')});
      if(width===1440||width===390)await shot(`03-lista-${theme}-${width}`);
      if(width===320){await page.getByRole('button',{name:'Colunas',exact:true}).click();await shot(`05-colunas-${theme}-320`);console.log(await page.locator('.oab-colunas-conteudo').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth}}));await check(`${theme} seletor cabe em 320px`,async()=>assert(await page.locator('.oab-colunas-conteudo').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})));await page.keyboard.press('Escape');}
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  const menu=page.getByRole('button',{name:'Ações da publicação p1',exact:true});await menu.focus();await page.keyboard.press('Enter');await page.getByRole('menuitem',{name:'Abrir processo',exact:true}).waitFor();await shot('04-menu-g100');await page.keyboard.press('Escape');
  await check('Menu de ações abre por teclado e Escape devolve foco',async()=>assert(await menu.evaluate(e=>e===document.activeElement)));
  await check('Preferência persistiu no reload',async()=>assert.equal(await page.locator('thead th').count(),7));
  assert.deepEqual(errors,[]);results.push('Nenhum erro JavaScript');
  fs.writeFileSync(path.join(out,'resultado.json'),JSON.stringify({results,requests,errors},null,2));
  console.log(`${results.length} verificações de interface aprovadas.`);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
