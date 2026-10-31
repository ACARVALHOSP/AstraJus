async page => {
  const nome = 'Maria Aparecida de Oliveira Santos com sobrenome muito longo';
  const clientes = [{id:'c1',nome,tipo_pessoa:'fisica',perfil:'cliente',telefone:'(11) 99999-0000',email:'maria.aparecida.'+'sobrenome'.repeat(14)+'@exemplo.com.br',etiquetas:['Cliente especial']},{id:'c2',nome:'Comercial São Paulo Ltda.',tipo_pessoa:'juridica',perfil:'cliente',email:'financeiro@exemplo.com.br',telefone:'(11) 3333-4444'}];
  const casos = [{id:'p1',titulo:'Ação de obrigação de fazer com pedido de tutela antecipada e indenização por danos materiais e morais',cliente_id:'c1',processos:['10012345620268260100'],acao:'Procedimento comum cível',foro:'Foro Central Cível da Comarca de São Paulo',pasta:'0042',status:'Em andamento',ultima_movimentacao:'Conclusos para decisão',responsavel:'Ana Exemplo da Silva'}, {id:'p2',titulo:'Execução de título extrajudicial',cliente_id:'c2',processos:['10056789020268260100'],acao:'Execução',status:'Em andamento'}];
  const lancamentos=[{id:'l1',descricao:'Honorários contratuais — acompanhamento da ação de obrigação de fazer',cliente_id:'c1',caso_id:'p1',vencimento:'2026-10-30',valor:2450,direcao:'RECEITA',responsavel:'Ana Exemplo',pago:false},{id:'l2',descricao:'Custas iniciais',cliente_id:'c2',caso_id:'p2',vencimento:'2026-11-05',valor:387.42,direcao:'DESPESA',pago:true}];
  const publicacao={hash:'pub1',status:'nao_tratada',numero_processo:'10012345620268260100',criado_em:'2026-10-30T13:00:00Z',dados:{siglaTribunal:'TJSP',nomeOrgao:'1ª Vara Cível do Foro Central da Capital',nomeClasse:'Procedimento comum cível',data_disponibilizacao:'2026-10-30',tipoComunicacao:'Intimação',destinatarios:[{nome,polo:'A'},{nome:'Comercial São Paulo Ltda.',polo:'P'}],texto:'Inteiro teor da publicação. '+ 'Descrição extensa para conferir a leitura. '.repeat(15)}};
  await page.route('**/*', async route => {
    const url=new URL(route.request().url());
    const p=url.pathname;
    const responses={
      '/clientes':{clientes}, '/casos':{casos}, '/lancamentos':{lancamentos},
      '/responsaveis':{responsaveis:['Ana Exemplo','Carlos Silva']},
      '/responsaveis/me':{usuario:{login:'ana',nome_completo:'Ana Exemplo da Silva',nivel_acesso:'administrador'}},
      '/notificacoes':{notificacoes:[],total:0,nao_lidas:0},
      '/pagamentos':{cobrancas:[{id:'cb1',cliente_id:'c1',cliente_nome:nome,value:2450,dueDate:'2026-10-30',billingType:'BOLETO',status:'PENDING',invoiceUrl:'https://example.com/cobranca'}]},
      '/publicacoes-oab':{publicacoes:[publicacao],total:1,pagina:1,hashes_disponiveis:['pub1']},
      '/publicacoes-oab/status':{disponivel:true},
      '/admin/usuarios/api':{usuarios:[{usuario_id:'u1',login:'ana',nome_completo:'Ana Exemplo da Silva com sobrenome extenso',email:'ana.'+'sobrenome'.repeat(12)+'@exemplo.com.br',nivel_acesso:'administrador',status:'ativo',criado_em:'2026-10-01T12:00:00Z',ultimo_acesso_em:'2026-10-30T15:30:00Z'}]},
      '/admin/usuarios/historico':{historico:[{ocorrido_em:'2026-10-30T15:30:00Z',ator:'usuario:ana',usuario:nome,acao:'atualizar',campos:'["nome_completo", "email"]'}]},
      '/admin/usuarios/acessos':{acessos:[{ocorrido_em:'2026-10-30T15:30:00Z',usuario:nome}]},
      '/casos/p1':casos[0], '/clientes/c1':clientes[0],
      '/casos/p1/vinculos':{vinculos:[{caso_id:'p2',titulo:casos[1].titulo,cliente_nome:clientes[1].nome,acao:'Execução de título extrajudicial',tipo:'execucao'}]},
      '/casos/p1/atividades':{atividades:[]}, '/casos/p1/publicacoes':{publicacoes:[]}, '/casos/p1/movimentacoes':{movimentacoes:[]},
    };
    if (p==='/mcp') {
      const body=route.request().postDataJSON();
      let result={protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'teste',version:'1'}};
      if(body.method==='tools/call') result={content:[{type:'text',text:JSON.stringify({comunicacoes:[publicacao.dados],itens:[publicacao.dados],total:1})}]};
      await route.fulfill({json:{jsonrpc:'2.0',id:body.id,result}}); return;
    }
    if(p in responses){await route.fulfill({json:responses[p]});return;}
    await route.continue();
  });
  await page.goto('http://127.0.0.1:5185/novo/');
  await page.evaluate(() => {
    localStorage.setItem('cnj_token','token-de-teste');
    localStorage.setItem('cnj_historico',JSON.stringify([{tipo:'processo',args:{},resumo:'Consulta processual com descrição extensa para conferência da tabela',quando:'2026-10-30T12:00:00Z'}]));
    localStorage.setItem('cnj_favoritos',JSON.stringify([{tribunal:'tjsp',numero:'10012345620268260100'}]));
  });
  await page.reload();
}
