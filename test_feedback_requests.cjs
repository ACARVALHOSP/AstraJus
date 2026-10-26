const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, 'static/app.js'), 'utf8');
const calls = [];
const context = { window: { cnjUI: { tipoRequisicao: (url) => url.startsWith('/pagamentos') ? 'externo' : 'interno', operacao: async (action, options) => { calls.push(options); return action(); } } }, ErroMCP: Error };
vm.createContext(context);
const start = source.indexOf('class ClienteMCP {');
const end = source.indexOf('// --- Auxiliares de DOM', start);
vm.runInContext(source.slice(start, end) + '; globalThis.ClienteMCP = ClienteMCP;', context);
function wrapper(name) {
  const start = source.indexOf('async function ' + name + '(');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
vm.runInContext(wrapper('_buscarJson') + '\n' + wrapper('_enviarJson'), context);
context._buscarJsonSemProgresso = async () => ({ ok: true });
context._enviarJsonSemProgresso = async () => ({ ok: true });
(async () => {
  const client = new context.ClienteMCP('test-only');
  client.sessionId = 'test-session';
  client._enviar = async () => ({ content: [{ text: '{"ok":true}' }] });
  await client.chamarTool('consultar_processo_datajud', {});
  assert.equal(calls.at(-1).tipo, 'externo');
  await client.chamarTool('remover_monitoramento', {});
  assert.equal(calls.at(-1).tipo, 'interno');
  await client.chamarTool('listar_monitoramentos', {}, { tipo: 'pagina' });
  assert.equal(calls.at(-1).tipo, 'pagina');
  await context._buscarJson('/clientes', { tipo: 'pagina' });
  assert.equal(calls.at(-1).tipo, 'pagina');
  await context._buscarJson('/clientes'); assert.equal(calls.at(-1).tipo, 'interno');
  await context._buscarJson('/pagamentos'); assert.equal(calls.at(-1).tipo, 'externo');
  await context._enviarJson('/clientes', {}); assert.equal(calls.at(-1).tipo, 'interno');
  client._enviar = async () => ({ isError: true, content: [{ text: 'Falha externa' }] });
  await assert.rejects(client.chamarTool('consultar_publicacoes_djen', {}));
  console.log('PASS: integração MCP/HTTP, origem, carregamento de página e propagação de falhas');
})().catch(error => { console.error(error); process.exitCode = 1; });
