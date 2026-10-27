const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.attrs = new Map(); this.isConnected = true; }
  append(el) { this.children.push(el); }
  prepend(el) { this.children.unshift(el); }
  before(el) { this.beforeElement = el; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  querySelectorAll() { return []; }
  addEventListener() {}
  matches() { return false; }
}
class Document extends Element {
  constructor() { super(); this.body = new Element(); }
  createElement(tag) { const el = new Element(); el.tagName = tag; return el; }
  getElementById() { return null; }
  querySelector() { return null; }
}
const document = new Document();
const context = { document, Element, Document, HTMLSelectElement: class {},
  customElements: { whenDefined: () => Promise.resolve() }, MutationObserver: class { observe() {} },
  setTimeout: () => 1, clearTimeout() {}, queueMicrotask, addEventListener() {} };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'static/ui-controls.js'), 'utf8'), context);
(async () => {
  const ui = context.cnjUI, region = new Element(), other = new Element();
  region.setAttribute('aria-describedby', 'existing-help');
  const a = ui.iniciar('Consulta A', region), bar = region.beforeElement.children[0];
  const b = ui.iniciar('Consulta B', region);
  assert.equal(bar.label, 'Consulta A');
  assert.equal(bar.value, undefined);
  assert.equal(region.getAttribute('aria-busy'), 'true');
  assert.match(region.getAttribute('aria-describedby'), /^existing-help progresso-/);
  b(); assert.equal(bar.status, 'active'); assert.equal(bar.label, 'Consulta A');
  a(); assert.equal(bar.status, 'finished'); assert.equal(region.getAttribute('aria-busy'), null);
  await ui.executar(async () => ({ ok: false, mensagem: 'Falha de rede' }), 'CEP', region);
  assert.equal(bar.status, 'error'); assert.equal(bar.helperText, 'Falha de rede');
  const c = ui.iniciar('Consulta C', region), d = ui.iniciar('Consulta D', region);
  c(true, 'Falha parcial'); d(); assert.equal(bar.status, 'error');
  await assert.rejects(ui.executar(async () => { throw Error('Servidor indisponível'); }, 'Integrações', region));
  assert.equal(bar.helperText, 'Servidor indisponível');
  await ui.executar(async () => ({ ok: true }), 'CEP', region); assert.equal(bar.status, 'finished');
  const finishOther = ui.iniciar('Salvar', other); assert.notEqual(other.beforeElement, region.beforeElement);
  finishOther();
  assert.equal(ui.tipoRequisicao('/clientes'), 'interno');
  assert.equal(ui.tipoRequisicao('/publicacoes-oab/status', 'POST'), 'interno');
  assert.equal(ui.tipoRequisicao('/publicacoes-oab/capturar-manual', 'POST'), 'externo');
  assert.equal(ui.tipoRequisicao('/cjpg-arvore/magistrados'), 'interno');
  assert.equal(ui.tipoRequisicao('/cep/01001000'), 'externo');
  assert.equal(ui.tipoRequisicao('/pagamentos?status=PENDING'), 'externo');
  const pageRegion = new Element();
  const pageEnd = ui.iniciar('Processos', pageRegion, 'pagina');
  const skeleton = pageRegion.beforeElement.children[0];
  assert.equal(skeleton.children[0].tagName, 'cds-skeleton-text');
  const internalEnd = ui.iniciar('Salvar', pageRegion, 'interno');
  const loading = pageRegion.beforeElement.children[0];
  assert.equal(loading.tagName, 'cds-inline-loading');
  pageEnd(); assert.equal(pageRegion.getAttribute('aria-busy'), 'true');
  internalEnd(); assert.equal(pageRegion.getAttribute('aria-busy'), null);
  assert.equal(loading.status, 'finished');
  assert.equal(skeleton.children.length, 4);
  console.log('PASS: feedback por origem, skeleton, loading, concorrência entre tipos; rótulo estável, indeterminação, concorrência, regiões, ARIA, falha retornada/rejeitada e recuperação');
})().catch(error => { console.error(error); process.exitCode = 1; });
