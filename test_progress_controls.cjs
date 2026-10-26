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
  createElement() { return new Element(); }
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
  console.log('PASS: rótulo estável, indeterminação, concorrência, regiões, ARIA, falha retornada/rejeitada e recuperação');
})().catch(error => { console.error(error); process.exitCode = 1; });
