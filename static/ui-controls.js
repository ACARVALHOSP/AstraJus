// Dropdowns, radios e feedback de operações. Os selects nativos permanecem
// como fonte dos valores de formulário para os handlers existentes.
(() => {
  const pares = new WeakMap();
  const valorSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indiceSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let sequencia = 0;
  const contextos = new Map();
  const regioesOcupadas = new WeakMap();
  function regiaoAtual() {
    const foco = document.activeElement;
    return foco?.closest('form, [role="tabpanel"], cds-modal-body') ||
      [...document.querySelectorAll('[role="tabpanel"]')].filter((el) => el.getClientRects().length).at(-1) ||
      document.querySelector('main') || document.body;
  }
  function iniciar(rotulo = 'Consultando informações', regiao = regiaoAtual(), tipo = 'externo') {
    regiao ||= regiaoAtual();
    const grupos = contextos.get(regiao) || new Map();
    contextos.set(regiao, grupos);
    let estado = grupos.get(tipo);
    if (!estado) {
      const painel = document.createElement('div');
      painel.className = `app-progresso-global app-feedback--${tipo}`;
      painel.id = `progresso-${++sequencia}`;
      const barra = document.createElement(tipo === 'externo' ? 'cds-progress-bar' : tipo === 'pagina' ? 'div' : 'cds-inline-loading');
      if (tipo === 'externo') barra.setAttribute('size', 'small');
      if (tipo === 'interno') barra.setAttribute('controlled', '');
      if (tipo === 'pagina') {
        barra.setAttribute('role', 'status');
        barra.setAttribute('aria-label', 'Carregando informações');
        for (let linha = 0; linha < 4; linha++) {
          const esqueleto = document.createElement('cds-skeleton-text');
          esqueleto.setAttribute('width', linha % 2 ? '80%' : '95%');
          esqueleto.setAttribute('aria-hidden', 'true');
          barra.append(esqueleto);
        }
      }
      painel.append(barra);
      if (regiao === document.body) regiao.prepend(painel);
      else regiao.before(painel);
      estado = { painel, barra, operacoes: new Map(), falha: '', retorno: null, dispensado: false };
      // A barra é irmã da região para sobreviver à atualização do conteúdo.
      // Acompanha a visibilidade da própria aba, inclusive durante consultas de fundo.
      new MutationObserver(() => { painel.hidden = regiao.hidden || estado.dispensado; })
        .observe(regiao, { attributes: true, attributeFilter: ['hidden'] });
      grupos.set(tipo, estado);
    }
    const { painel, barra, operacoes } = estado;
    if (!operacoes.size) {
      estado.falha = '';
      const ocupado = regioesOcupadas.get(regiao) || { quantidade: 0, original: regiao.getAttribute('aria-busy') };
      ocupado.quantidade++;
      regioesOcupadas.set(regiao, ocupado);
      barra.label = rotulo;
    }
    clearTimeout(estado.retorno);
    const id = ++sequencia;
    operacoes.set(id, rotulo);
    estado.dispensado = false;
    painel.hidden = regiao.hidden;
    regiao.setAttribute('aria-busy', 'true');
    const descricoes = new Set((regiao.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    descricoes.add(painel.id);
    regiao.setAttribute('aria-describedby', [...descricoes].join(' '));
    if (tipo === 'externo') barra.value = undefined;
    barra.status = 'active';
    if (tipo === 'interno') {
      barra.textContent = rotulo + '…';
      barra.setAttribute('icon-description', rotulo);
    }
    const atualizarAjuda = () => {
      const ajuda = operacoes.size > 1 ? `${operacoes.size} operações em andamento. Aguarde.` : 'Aguarde. A operação está em andamento.';
      if (tipo === 'externo') barra.helperText = ajuda;
      else if (tipo === 'interno') barra.textContent = operacoes.size > 1 ? ajuda : barra.label + '…';
    };
    atualizarAjuda();
    return (falhou = false, mensagem = '') => {
      if (!operacoes.delete(id)) return;
      if (falhou) estado.falha = mensagem || 'Não foi possível concluir a operação. Tente novamente.';
      if (operacoes.size) { atualizarAjuda(); return; }
      const ocupado = regioesOcupadas.get(regiao);
      if (ocupado && --ocupado.quantidade === 0) {
        if (ocupado.original === null) regiao.removeAttribute('aria-busy');
        else regiao.setAttribute('aria-busy', ocupado.original);
        regioesOcupadas.delete(regiao);
      }
      barra.status = estado.falha ? 'error' : 'finished';
      barra.helperText = estado.falha || 'Operação concluída.';
      if (tipo === 'interno') {
        barra.textContent = barra.helperText;
        barra.setAttribute('icon-description', estado.falha ? 'Falha' : 'Concluído');
      }
      if (tipo === 'pagina') { estado.dispensado = true; painel.hidden = true; }
      // Erros ficam visíveis para permitir leitura e recuperação.
      if (!estado.falha) estado.retorno = setTimeout(() => {
        estado.dispensado = true;
        painel.hidden = true;
        const ids = (regiao.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== painel.id);
        if (ids.length) regiao.setAttribute('aria-describedby', ids.join(' '));
        else regiao.removeAttribute('aria-describedby');
      }, 3000);
    };
  }
  async function executar(acao, rotulo, regiao, tipo = 'externo') {
    const terminar = iniciar(rotulo, regiao, tipo);
    try {
      const resultado = await acao();
      const falhou = resultado?.ok === false || Boolean(resultado?.erro);
      terminar(falhou, resultado?.mensagem || (falhou ? 'Não foi possível concluir a consulta. Confira os dados e tente novamente.' : ''));
      return resultado;
    } catch (erro) { terminar(true, erro.message); throw erro; }
  }
  function tipoRequisicao(url, metodo = 'GET') {
    const caminho = url.split('?')[0];
    return /^\/(pagamentos|cep)(\/|$)/.test(caminho) ||
      /\/(evento-calendar|capa\/atualizar|capturar-manual)$/.test(caminho) ||
      (caminho === '/casos' && metodo === 'POST') ? 'externo' : 'interno';
  }
  function operacao(acao, { tipo = 'interno', rotulo = 'Processando informações', regiao } = {}) {
    return executar(acao, rotulo, regiao, tipo);
  }
  window.cnjUI = { iniciar, executar, operacao, tipoRequisicao, pares };

  function rotulo(select) {
    const nome = select.getAttribute('aria-label') || select.labels?.[0]?.textContent.trim() ||
      select.closest('.cds--form-item')?.querySelector('label')?.textContent.trim() || 'Selecione uma opção';
    return nome === 'Month' ? 'Mês' : nome;
  }
  function preparar(select) {
    if (pares.has(select) || select.multiple) return;
    const estado = { campo: null, assinatura: '', sync: null };
    pares.set(select, estado);
    const eraOculto = select.hidden;
    const labelOriginal = select.labels?.[0] || select.closest('.cds--form-item')?.querySelector('label');
    if (labelOriginal && !labelOriginal.contains(select)) labelOriginal.classList.add('app-choice-original-label');
    const sincronizar = () => {
      const opcoes = [...select.options];
      const reais = opcoes.filter((opcao) => !(/^\s*[—–-]?\s*(selecione|escolha|carregando)/i.test(opcao.textContent)));
      const radio = reais.length === 2;
      const assinatura = JSON.stringify([radio, rotulo(select), select.disabled,
        opcoes.map((o) => [o.value, o.textContent, o.disabled])]);
      if (assinatura !== estado.assinatura) {
        const tinhaFoco = estado.campo?.matches(':focus-within');
        const campo = document.createElement(radio ? 'cds-radio-button-group' : 'cds-dropdown');
        // O select original é o único participante do FormData.
        campo._handleFormdata = () => {};
        campo.className = 'app-choice';
        campo.setAttribute('data-select-id', select.id || '');
        if (radio) {
          campo.setAttribute('legend-text', rotulo(select));
          campo.setAttribute('orientation', 'horizontal');
          campo.setAttribute('name', `escolha-carbon-${++sequencia}`);
        } else {
          campo.setAttribute('title-text', rotulo(select));
          campo.setAttribute('label', opcoes.find((o) => !reais.includes(o))?.textContent || 'Selecione');
          campo.setAttribute('autoalign', '');
          campo.setAttribute('size', 'lg');
        }
        for (const opcao of radio ? reais : opcoes) {
          const item = document.createElement(radio ? 'cds-radio-button' : 'cds-dropdown-item');
          item.value = opcao.value;
          item.setAttribute('value', opcao.value);
          if (radio) item.setAttribute('label-text', opcao.textContent);
          else item.textContent = opcao.textContent;
          if (opcao.disabled) item.setAttribute('disabled', '');
          campo.append(item);
        }
        campo.disabled = select.disabled;
        campo.hidden = eraOculto;
        if (radio) campo.addEventListener('cds-radio-button-changed', (evento) => {
          // Normaliza a exclusividade antes de o grupo ler o botão marcado.
          // Na inicialização por value, o manager pode manter o anterior checked.
          if (!evento.detail?.checked) return;
          for (const item of campo.querySelectorAll('cds-radio-button')) {
            item.checked = item.value === evento.detail.value;
          }
        }, { capture: true });
        campo.addEventListener(radio ? 'cds-radio-button-group-changed' : 'cds-dropdown-selected', (evento) => {
          const valor = evento.detail?.value ?? evento.detail?.item?.value ?? campo.value;
          valorSelect.set.call(select, valor);
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          sincronizar();
        });
        if (estado.campo) estado.campo.replaceWith(campo);
        else select.before(campo);
        estado.campo = campo;
        estado.assinatura = assinatura;
        if (tinhaFoco) campo.updateComplete.then(() => campo.focus());
      }
      estado.campo.value = select.value;
      estado.campo.setAttribute('value', select.value);
      estado.campo.disabled = select.disabled;
      estado.campo.required = select.required;
      if (estado.campo.invalid && select.validity.valid) estado.campo.invalid = false;
    };
    estado.sync = sincronizar;
    Object.defineProperty(select, 'value', {
      configurable: true, get() { return valorSelect.get.call(this); },
      set(valor) { valorSelect.set.call(this, valor); sincronizar(); },
    });
    Object.defineProperty(select, 'selectedIndex', {
      configurable: true, get() { return indiceSelect.get.call(this); },
      set(valor) { indiceSelect.set.call(this, valor); sincronizar(); },
    });
    select.focus = (opcoes) => estado.campo.focus(opcoes);
    select.addEventListener('change', sincronizar);
    select.addEventListener('invalid', (evento) => {
      evento.preventDefault();
      estado.campo.invalid = true;
      estado.campo.setAttribute('invalid-text', 'Selecione uma opção.');
      estado.campo.focus();
    });
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    sincronizar();
    new MutationObserver(sincronizar).observe(select, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['disabled', 'required', 'selected', 'value', 'label', 'aria-label'],
    });
    select.form?.addEventListener('reset', () => queueMicrotask(sincronizar));
  }
  function atualizar(raiz) {
    if (!(raiz instanceof Element || raiz instanceof Document)) return;
    if (raiz instanceof Element && raiz.matches('select')) preparar(raiz);
    raiz.querySelectorAll('select').forEach(preparar);
  }
  Promise.all(['cds-dropdown', 'cds-radio-button-group'].map((nome) => customElements.whenDefined(nome))).then(() => {
    atualizar(document);
    new MutationObserver((mudancas) => {
      for (const mudanca of mudancas) for (const no of mudanca.addedNodes) atualizar(no);
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', (evento) => {
      const label = evento.target.closest('label[for]');
      const select = label && document.getElementById(label.htmlFor);
      if (select && pares.has(select)) { evento.preventDefault(); select.focus(); }
    });
  });

  // Preserva IDs e botões usados pelos fluxos de atividade e confirmação.
  for (const id of ['modal-atividade', 'modal-confirmar', 'modal-edicao-pendente']) {
    const original = document.getElementById(id);
    if (!original) continue;
    const modal = document.createElement('cds-modal');
    modal.id = id;
    modal.className = 'app-modal';
    modal.setAttribute('size', id === 'modal-confirmar' ? 'xs' : 'sm');
    modal.setAttribute('prevent-close-on-click-outside', '');
    if (id !== 'modal-atividade') modal.setAttribute('alert', '');
    const titulo = original.querySelector('.fluxo-pagina-header__heading');
    const header = document.createElement('cds-modal-header');
    const heading = document.createElement('cds-modal-heading');
    heading.id = titulo.id;
    heading.textContent = titulo.textContent;
    modal.setAttribute('aria-labelledby', heading.id);
    header.append(heading);
    const fechar = original.querySelector('.fluxo-pagina-close');
    if (fechar) {
      const close = document.createElement('cds-modal-close-button');
      close.id = fechar.id;
      close.setAttribute('close-button-label', 'Fechar');
      header.prepend(close);
    }
    const body = document.createElement('cds-modal-body');
    const conteudo = original.querySelector('.fluxo-pagina-content');
    if (conteudo.id) body.id = conteudo.id;
    body.append(...conteudo.childNodes);
    const footer = document.createElement('cds-modal-footer');
    footer.className = 'app-modal-footer';
    footer.append(...original.querySelector('.fluxo-pagina-footer').childNodes);
    modal.append(header, body, footer);
    original.replaceWith(modal);
    if (id === 'modal-atividade') body.querySelector('#atividade-titulo')?.setAttribute('data-modal-primary-focus', '');
    modal.addEventListener('cds-modal-beingclosed', (evento) => {
      evento.preventDefault();
      if (id === 'modal-confirmar') document.getElementById('modal-confirmar-cancelar').click();
      else if (id === 'modal-edicao-pendente') document.getElementById('edicao-continuar').click();
      else window.cnjUI.fecharModal?.(id);
    });
  }
  // Formulários que navegam para uma resposta do servidor (cadastro/admin/OAuth).
  document.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (form.hasAttribute('action') && !evento.defaultPrevented) iniciar('Enviando informações', form, /google/.test(form.getAttribute('action')) ? 'externo' : 'interno');
  });
  window.addEventListener('pageshow', (evento) => {
    if (!evento.persisted) return;
    for (const [regiao, grupos] of contextos) {
      const ocupado = regioesOcupadas.get(regiao);
      if (ocupado) {
        if (ocupado.original === null) regiao.removeAttribute('aria-busy');
        else regiao.setAttribute('aria-busy', ocupado.original);
        regioesOcupadas.delete(regiao);
      }
      for (const estado of grupos.values()) {
        clearTimeout(estado.retorno);
        estado.operacoes.clear();
        estado.dispensado = true;
        estado.painel.hidden = true;
      }
    }
  });
})();
