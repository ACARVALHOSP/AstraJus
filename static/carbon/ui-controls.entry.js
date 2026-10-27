import '@carbon/web-components/es/components/skeleton-text/index.js';
import '@carbon/web-components/es/components/inline-loading/index.js';
import '@carbon/web-components/es/components/dropdown/index.js';
import '@carbon/web-components/es/components/radio-button/index.js';
import '@carbon/web-components/es/components/modal/index.js';
import CDSProgressBar from '@carbon/web-components/es/components/progress-bar/progress-bar.js';

// Compatibility adapter for Carbon Web Components 2.66.0: preserve rendering
// and styles, repairing relationships inside the component shadow root.
const atualizarCarbon = CDSProgressBar.prototype.updated;
CDSProgressBar.prototype.updated = function (alteracoes) {
  atualizarCarbon.call(this, alteracoes);
  const raiz = this.shadowRoot;
  const trilho = raiz.querySelector('[role="progressbar"]');
  const label = raiz.querySelector('.cds--progress-bar__label-text');
  const ajuda = raiz.querySelector('.cds--progress-bar__helper-text');
  if (!trilho || !label || !ajuda) return;
  label.id = 'progress-label';
  ajuda.id = 'progress-help';
  trilho.setAttribute('aria-labelledby', label.id);
  trilho.setAttribute('aria-describedby', ajuda.id);
  trilho.setAttribute('aria-busy', String(this.status === 'active'));
  if (this.status === 'active' && this.value == null) {
    for (const atributo of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) trilho.removeAttribute(atributo);
  }
  const anuncioIngles = ajuda.querySelector('[aria-live]');
  if (anuncioIngles) {
    anuncioIngles.removeAttribute('aria-live');
    anuncioIngles.setAttribute('aria-hidden', 'true');
    anuncioIngles.textContent = '';
  }
  ajuda.setAttribute('role', 'status');
  ajuda.setAttribute('aria-live', 'polite');
  ajuda.setAttribute('aria-atomic', 'true');
};
