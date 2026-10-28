'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let token = '', catalogo = [], selected = null, candidato = null, teste = null, snapshot = null, busy = false, historico = [], ambienteAtivo = '', driveConectado = false, captchaWidget = null;
  const names = {drive:'Google Drive',asaas:'Asaas',zapsign:'ZapSign',datajud:'DataJud',smtp:'SMTP',recaptcha:'reCAPTCHA',google_oauth:'Google OAuth'};
  const schema = {drive:[['pasta_raiz','ID da pasta institucional']],asaas:[['api_key','Nova chave da API',true]],zapsign:[['api_key','Nova chave da API',true]],datajud:[['api_key','Nova chave da API',true]],smtp:[['host','Servidor SMTP'],['porta','Porta TLS (465 ou 587)'],['usuario','Usuário'],['senha','Nova senha',true],['remetente','E-mail remetente']],recaptcha:[['site_key','Site key'],['secret','Nova secret key',true]],google_oauth:[['client_id','Client ID'],['client_secret','Novo client secret',true]]};
  function notify(text) { $('global-message').textContent = text; }
  function feedback(text) { $('feedback').hidden = !text; $('feedback').textContent = text; }
  async function api(path, data) {
    const r = await fetch('/admin/integracoes' + path, {method:data === undefined?'GET':'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data === undefined?undefined:JSON.stringify(data),cache:'no-store',redirect:'error'});
    const j = await r.json(); if (!r.ok) throw new Error(j.erro || 'Não foi possível concluir a operação.'); return j;
  }
  function invalidate() { candidato=null;teste=null;snapshot=null;$('activate').disabled=true;feedback(''); }
  function values() { const result={}; for(const input of $('fields').querySelectorAll('input')) result[input.name]=input.value;return result; }
  function key(item) { return item.provedor+':'+item.ambiente; }
  function renderCatalog() {
    $('catalog').replaceChildren();
    for(const scope of ['escritorio','sistema']) {
      const h=document.createElement('h3');h.className='group';h.textContent=scope==='escritorio'?'Escritório · Institucional':'Sistema · Configurações gerais';$('catalog').append(h);
      for(const item of catalogo.filter(i=>i.escopo===scope)) {
        const b=document.createElement('button');b.type='button';b.className='service';b.setAttribute('aria-pressed',String(selected && key(selected)===key(item)));
        const span=document.createElement('span');span.textContent=names[item.provedor];const small=document.createElement('small');small.textContent=item.provedor==='asaas'?(item.ambiente==='sandbox'?'Homologação':'Produção')+(item.ambiente===ambienteAtivo?' · Em uso':''):scope==='escritorio'?'Conta institucional':'Configuração geral';span.append(small);
        const status=document.createElement('span');status.className='tag';status.textContent=item.provedor==='drive'&&driveConectado?'Conta conectada':item.estado==='ativo'?'Configurado':'Não configurado';b.append(span,status);b.onclick=()=>{if(busy)return;selected=item;render();renderCatalog();};$('catalog').append(b);
      }
    }
    const p=document.createElement('p');p.className='help';p.textContent='Google Calendar é individual. Cada usuário autoriza a própria agenda na página Integrações do painel.';$('catalog').append(p);
  }
  function render() {
    invalidate();$('fields').replaceChildren();$('titulo').textContent=names[selected.provedor];$('scope').textContent=selected.escopo==='sistema'?'Sistema':'Escritório';
    $('current-state').textContent=(selected.estado==='ativo'?'Configuração ativa · versão '+selected.versao+(selected.testado_em?' · Testada em '+new Date(selected.testado_em*1000).toLocaleString('pt-BR'):' · Não testada'):'Não configurado')+(selected.provedor==='asaas'?' · '+(selected.ambiente==='sandbox'?'Homologação':'Produção'):'');
    for(const [name,label,secret] of schema[selected.provedor]) {
      const l=document.createElement('label');l.htmlFor='config-'+name;l.textContent=label;const input=document.createElement('input');input.id=l.htmlFor;input.name=name;input.type=secret?'password':'text';input.className='cds--text-input';input.autocomplete='off';input.maxLength=8192;input.value=secret?'':(selected.parametros[name]||'');
      input.addEventListener('input',invalidate);$('fields').append(l,input);
      if(secret){const p=document.createElement('p');p.className='help';p.textContent=selected.segredos[name]?'Credencial atual: '+selected.segredos[name]+'. Deixe vazio para preservar.':'Nenhuma credencial cadastrada.';$('fields').append(p);}
    }
    $('deactivate').hidden=!selected.versao;$('google').hidden=!['drive','google_oauth'].includes(selected.provedor);$('use-env').hidden=selected.provedor!=='asaas'||selected.ambiente===ambienteAtivo||!selected.versao;
    $('helper').textContent=selected.provedor==='google_oauth'?'Cadastre no Google a URL de retorno: '+location.origin+'/integracoes/google/callback. Autorize a conta, teste e ative.':selected.provedor==='smtp'?'O teste valida TLS e autenticação sem enviar e-mails. Ao alterar servidor ou usuário, informe novamente a senha.':selected.provedor==='recaptcha'?'Informe a nova site key, carregue e resolva o desafio. Depois teste a configuração.':'O teste verifica a conexão sem criar cobranças, documentos ou enviar e-mails.';
    $('captcha-challenge').replaceChildren();captchaWidget=null;
    if(selected.provedor==='recaptcha') {const b=document.createElement('button');b.type='button';b.className='cds--btn cds--btn--ghost';b.textContent='Carregar desafio reCAPTCHA';b.onclick=loadCaptcha;$('captcha-challenge').append(b);}
    $('history').replaceChildren();const entries=historico.filter(h=>h.provedor===selected.provedor&&h.ambiente===selected.ambiente);for(const h of entries){const p=document.createElement('p');p.textContent=new Date(h.instante*1000).toLocaleString('pt-BR')+' · '+h.autor+' · '+h.acao+' · '+h.resultado;$('history').append(p);}if(!entries.length)$('history').textContent='Nenhuma alteração registrada.';
  }
  async function loadCaptcha(){try{if(!window.grecaptcha){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://www.google.com/recaptcha/api.js?render=explicit';s.onload=resolve;s.onerror=reject;document.head.append(s);});}await new Promise(resolve=>grecaptcha.ready(resolve));const div=document.createElement('div');$('captcha-challenge').replaceChildren(div);captchaWidget=grecaptcha.render(div,{sitekey:values().site_key,callback:()=>{teste=null;$('activate').disabled=true;}});}catch{feedback('Não foi possível carregar o desafio. Verifique a site key.');}}
  async function reload(){const data=await api('/api');$('admins').hidden=!data.pode_gerir_administradores;catalogo=data.integracoes;historico=data.historico;$('global-history').replaceChildren();for(const h of historico){const p=document.createElement('p');p.textContent=new Date(h.instante*1000).toLocaleString('pt-BR')+' · '+h.autor+' · '+h.provedor+' · '+h.acao+' · '+h.resultado;$('global-history').append(p);}ambienteAtivo=data.asaas_ambiente;driveConectado=Boolean(data.drive_conectado);selected=catalogo.find(x=>selected&&key(x)===key(selected))||catalogo.find(x=>x.provedor==='zapsign');renderCatalog();render();}
  async function ensureCandidate(){const v=JSON.stringify(values());if(!candidato||snapshot!==v){const r=await api('/candidato',{provedor:selected.provedor,ambiente:selected.ambiente,dados:values(),base:selected.versao});candidato=r.candidato;snapshot=v;teste=null;}return candidato;}
  async function run(fn){if(busy)return;busy=true;$('config-form').setAttribute('aria-busy','true');$('test').disabled=true;try{await fn();}catch(e){feedback(e.message);}finally{busy=false;$('test').disabled=false;$('config-form').removeAttribute('aria-busy');}}
  $('admin-form').onsubmit=async e=>{e.preventDefault();try{await api('/administrador',{nome:$('admin-name').value.trim(),habilitado:$('admin-enabled').value==='true'});notify('Permissão administrativa atualizada.');}catch(e){notify(e.message);}};
  $('rotate').onclick=()=>run(async()=>{if(!confirm('Reencriptar as credenciais com a chave primária configurada no servidor?'))return;await api('/rotacionar',{confirmar:true});notify('Credenciais reencriptadas com a chave primária configurada.');});
  $('deactivate').onclick=()=>run(async()=>{if(!confirm('Desativar '+names[selected.provedor]+' neste ambiente? O serviço ficará indisponível.'))return;await api('/desativar',{provedor:selected.provedor,ambiente:selected.ambiente,base:selected.versao,confirmar:true});await reload();feedback('Integração desativada.');});
  $('login').onsubmit=async e=>{e.preventDefault();token=$('admin-key').value;$('admin-key').value='';try{await reload();$('login').hidden=true;$('workspace').hidden=false;notify('');}catch(e){token='';notify(e.message);}};
  $('logout').onclick=()=>{token='';catalogo=[];historico=[];selected=null;invalidate();$('fields').replaceChildren();$('catalog').replaceChildren();$('history').replaceChildren();$('workspace').hidden=true;$('login').hidden=false;$('admin-key').focus();};
  $('config-form').onsubmit=e=>{e.preventDefault();run(async()=>{const id=await ensureCandidate();const r=await api('/testar',{candidato:id,captcha_token:captchaWidget!==null?grecaptcha.getResponse(captchaWidget):undefined});teste=r.aprovado?r.teste:null;feedback(r.mensagem);$('activate').disabled=!r.aprovado;});};
  $('activate').onclick=()=>run(async()=>{if(snapshot!==JSON.stringify(values())){invalidate();return;}const production=selected.provedor==='asaas'&&selected.ambiente==='producao';if(production&&!confirm('Ativar esta chave Asaas no ambiente de PRODUÇÃO?'))return;await api('/ativar',{candidato,teste,confirmar_producao:production});await reload();feedback('Configuração ativada. As próximas chamadas usarão os novos valores.');});
  $('google').onclick=()=>run(async()=>{const data=selected.provedor==='google_oauth'?{candidato:await ensureCandidate()}:{};const r=await api('/google',data);const url=new URL(r.url);if(url.origin!=='https://accounts.google.com')throw new Error('URL de autorização inválida.');window.open(r.url,'_blank','noopener');feedback('Conclua a autorização na aba Google. Depois volte e teste a configuração.');});
  $('use-env').onclick=()=>run(async()=>{const prod=selected.ambiente==='producao';if(prod&&!confirm('Usar PRODUÇÃO nas próximas cobranças Asaas?'))return;await api('/ambiente',{ambiente:selected.ambiente,confirmar_producao:prod});await reload();feedback('Ambiente de cobranças atualizado.');});
})();
