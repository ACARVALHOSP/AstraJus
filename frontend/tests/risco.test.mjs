import assert from 'node:assert/strict'
import test from 'node:test'
import { montarRiscos, somarDiasIso } from '../src/routes/home/risco.ts'

const base = { hoje: '2026-11-12', semana: [], atrasadas: [], publicacoes: 0, deClientes: 0, rotinas: {}, integracoes: { google: true, asaas: true, agendaPessoal: true } }
const ids = (d) => montarRiscos({ ...base, ...d }).map(r => r.id)

test('sem pendências a lista fica vazia', () => {
  assert.deepEqual(ids({}), [])
})

test('soma de dias respeita virada de mês e de ano', () => {
  assert.equal(somarDiasIso('2026-11-30', 2), '2026-12-02')
  assert.equal(somarDiasIso('2026-12-31', 1), '2027-01-01')
  assert.equal(somarDiasIso('2026-03-01', -1), '2026-02-28')
})

test('prazo vencido é crítico e separado das tarefas atrasadas', () => {
  const r = montarRiscos({ ...base, atrasadas: [{ tipo: 'prazo', data: '2026-11-10' }, { tipo: 'tarefa', data: '2026-11-11' }, { tipo: 'tarefa', data: '2026-11-09' }] })
  assert.deepEqual(r.map(x => [x.id, x.nivel]), [['prazos-vencidos', 'critico'], ['tarefas-atrasadas', 'atencao']])
  assert.match(r[0].titulo, /^1 prazo vencido$/)
  assert.match(r[1].titulo, /^2 tarefas atrasadas$/)
})

test('prazo que vence hoje é crítico; em 1 ou 2 dias é atenção; depois disso não entra', () => {
  const nivel = (data) => montarRiscos({ ...base, semana: [{ tipo: 'prazo', data }] })[0]?.nivel
  assert.equal(nivel('2026-11-12'), 'critico')
  assert.equal(nivel('2026-11-13'), 'atencao')
  assert.equal(nivel('2026-11-14'), 'atencao')
  assert.equal(nivel('2026-11-15'), undefined)
})

test('audiência não conta como prazo e aparece em atenção', () => {
  const r = montarRiscos({ ...base, semana: [{ tipo: 'audiencia', data: '2026-11-13' }, { tipo: 'audiencia', data: '2026-11-17' }] })
  assert.deepEqual(r.map(x => x.id), ['audiencias'])
  assert.match(r[0].titulo, /^2 audiências/)
})

test('publicações de clientes são críticas e não são contadas duas vezes', () => {
  const r = montarRiscos({ ...base, publicacoes: 5, deClientes: 2 })
  assert.deepEqual(r.map(x => [x.id, x.nivel]), [['publicacoes-clientes', 'critico'], ['publicacoes', 'atencao']])
  assert.match(r[1].titulo, /^3 publicações/)
  assert.deepEqual(ids({ publicacoes: 2, deClientes: 2 }), ['publicacoes-clientes'])
})

test('rotina automática só avisa se a última execução terminada falhou', () => {
  const falha = { estado: 'falha', erro: 'Uma ou mais verificações não foram concluídas.' }
  assert.deepEqual(ids({ rotinas: { captura_oab: [falha, { estado: 'concluida' }] } }), ['rotina-captura_oab'])
  // a execução em andamento é ignorada: vale a última terminada
  assert.deepEqual(ids({ rotinas: { captura_oab: [{ estado: 'executando' }, falha] } }), ['rotina-captura_oab'])
  assert.deepEqual(ids({ rotinas: { captura_oab: [{ estado: 'executando' }, { estado: 'concluida' }, falha] } }), [])
  assert.deepEqual(ids({ rotinas: { captura_oab: [{ estado: 'interrompida' }] } }), [])
  assert.deepEqual(ids({ rotinas: { captura_oab: [] } }), [])
  assert.equal(montarRiscos({ ...base, rotinas: { movimentos: [falha] } })[0].detalhe, falha.erro)
})

test('integrações não configuradas aparecem só como informação', () => {
  const r = montarRiscos({ ...base, integracoes: { google: false, asaas: false, agendaPessoal: null } })
  assert.deepEqual(r.map(x => [x.id, x.nivel]), [['google', 'info'], ['asaas', 'info']])
  // com o Google configurado, só falta a agenda pessoal
  assert.deepEqual(ids({ integracoes: { google: true, asaas: true, agendaPessoal: false } }), ['agenda-pessoal'])
  // sem permissão (dados nulos), nada é afirmado
  assert.deepEqual(ids({ integracoes: null, rotinas: null }), [])
})

test('ordena do mais grave para o menos grave', () => {
  const r = montarRiscos({
    ...base, integracoes: { google: false, asaas: true, agendaPessoal: null },
    semana: [{ tipo: 'audiencia', data: '2026-11-13' }], atrasadas: [{ tipo: 'prazo', data: '2026-11-01' }],
  })
  assert.deepEqual(r.map(x => x.nivel), ['critico', 'atencao', 'info'])
})
