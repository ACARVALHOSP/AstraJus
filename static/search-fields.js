// Search padrão Carbon. Mantém os inputs originais como ponte para os formulários
// e handlers existentes, incluindo os campos inseridos dinamicamente.
(() => {
  const seletor = 'input[type="search"], input[id$="-busca"], input[id$="-busca-input"], input[id^="jur-seletor-"], #jur-termo, #jur-magistrado, #vinculos-numero-processo';
  const valorNativo = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const pares = new WeakMap();
  function preparar(input) {
    if (pares.has(input)) return;
    const campo = document.createElement('cds-search');
    campo.className = 'app-search';
    campo.setAttribute('size', 'lg');
    campo.setAttribute('type', 'search');
    campo.setAttribute('autocomplete', input.autocomplete || 'off');
    campo.setAttribute('close-button-label-text', 'Limpar busca');
    const label = input.labels?.[0]?.textContent.trim();
    campo.setAttribute('label-text', input.getAttribute('aria-label') || label || input.placeholder || 'Buscar');
    campo.setAttribute('placeholder', input.placeholder || 'Buscar');
    if (input.hasAttribute('aria-describedby')) campo.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));
    campo.value = input.value;
    campo.disabled = input.disabled;
    pares.set(input, campo);
    input.before(campo);
    input.hidden = true;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valorNativo.get.call(this); },
      set(valor) { valorNativo.set.call(this, valor); campo.value = valorNativo.get.call(this); },
    });
    input.focus = (opcoes) => campo.focus(opcoes);
    input.blur = () => campo.shadowRoot?.querySelector('input')?.blur();
    input.select = () => campo.shadowRoot?.querySelector('input')?.select();
    campo.addEventListener('cds-search-input', (evento) => {
      // Carbon emite o evento antes de atualizar value. Os handlers legados
      // (incluindo máscaras CNJ) precisam receber o valor já atualizado.
      input.value = evento.detail.value;
      queueMicrotask(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        campo.value = input.value;
      });
    });
    campo.addEventListener('keydown', (evento) => {
      evento.stopPropagation();
      const continuar = input.dispatchEvent(new KeyboardEvent('keydown', {
        key: evento.key, code: evento.code, bubbles: true, cancelable: true,
        ctrlKey: evento.ctrlKey, altKey: evento.altKey, shiftKey: evento.shiftKey, metaKey: evento.metaKey,
      }));
      if (!continuar) evento.preventDefault();
    });
    campo.addEventListener('focusout', () => input.dispatchEvent(new Event('blur')));
    input.addEventListener('input', () => { campo.value = input.value; });
    if (input.form) input.form.addEventListener('reset', () => queueMicrotask(() => { campo.value = input.value; }));
    new MutationObserver(() => {
      campo.disabled = input.disabled;
      campo.setAttribute('placeholder', input.placeholder || 'Buscar');
    }).observe(input, { attributes: true, attributeFilter: ['disabled', 'placeholder'] });
  }
  function atualizar(raiz) {
    if (!(raiz instanceof Element || raiz instanceof Document)) return;
    if (raiz instanceof Element && raiz.matches(seletor)) preparar(raiz);
    raiz.querySelectorAll(seletor).forEach(preparar);
  }
  customElements.whenDefined('cds-search').then(() => {
    atualizar(document);
    new MutationObserver((mudancas) => {
      for (const mudanca of mudancas) for (const no of mudanca.addedNodes) atualizar(no);
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', (evento) => {
      const label = evento.target.closest('label[for]');
      const input = label && document.getElementById(label.htmlFor);
      const campo = input && pares.get(input);
      if (campo) { evento.preventDefault(); campo.focus(); }
    });
  });
})();
