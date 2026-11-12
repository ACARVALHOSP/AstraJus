import assert from 'node:assert/strict'
import test from 'node:test'
import { itensDoModelo, resumoDoModelo } from '../src/routes/casos/modelosPrazo.ts'

const modelo = {
  prazos: [{ titulo: 'Contestação', dias: 15, contagem: 'uteis' }, { titulo: 'Réplica', dias: 15, contagem: 'corridos' }],
  tarefas: [{ titulo: 'Pedir documentos', dias: 2 }, { titulo: 'Ligar ao cliente', dias: 0 }],
}

test('prazo em dias úteis pula fins de semana e conta a partir de amanhã', () => {
  // quinta 12/11/2026: amanhã é sexta 13/11 (1º dia útil) e o 15º dia útil cai em 03/12 (quinta)
  const [contestacao] = itensDoModelo(modelo, '2026-11-12')
  assert.equal(contestacao.tipo, 'prazo')
  assert.equal(contestacao.data, '2026-12-03')
  assert.equal(contestacao.descricao, '15 dias úteis')
})

test('prazo em dias corridos que termina em dia sem expediente vai para o próximo dia útil', () => {
  // 15 dias corridos a partir de sex 13/11 terminam em 27/11 (sexta, dia útil)
  assert.equal(itensDoModelo(modelo, '2026-11-12')[1].data, '2026-11-27')
  // 16 dias corridos a partir de sex 13/11 terminam em sáb 28/11 e vão para segunda 30/11 (CPC art. 224, §1º)
  const [replica] = itensDoModelo({ prazos: [{ titulo: 'Réplica', dias: 16, contagem: 'corridos' }], tarefas: [] }, '2026-11-12')
  assert.equal(replica.data, '2026-11-30')
})

test('tarefas contam dias corridos a partir de hoje', () => {
  const itens = itensDoModelo(modelo, '2026-11-12')
  assert.deepEqual(itens.filter(i => i.tipo === 'tarefa').map(i => [i.data, i.descricao]), [['2026-11-14', 'em 2 dias'], ['2026-11-12', 'para hoje']])
})

test('contagem que passa pelo recesso de 20/12 a 20/01 é suspensa', () => {
  const [contestacao] = itensDoModelo({ prazos: [{ titulo: 'Contestação', dias: 15, contagem: 'uteis' }], tarefas: [] }, '2026-12-15')
  // sem suspensão acabaria em janeiro/2027, mas só volta a contar depois de 20/01
  assert.ok(contestacao.data > '2027-01-20', contestacao.data)
})

test('chaves são únicas e a ordem é prazos primeiro, depois tarefas', () => {
  const itens = itensDoModelo(modelo, '2026-11-12')
  assert.deepEqual(itens.map(i => i.chave), ['prazo-0', 'prazo-1', 'tarefa-0', 'tarefa-1'])
  assert.deepEqual(itens.map(i => i.tipo), ['prazo', 'prazo', 'tarefa', 'tarefa'])
})

test('resumo em português com plural', () => {
  assert.equal(resumoDoModelo(modelo), '2 prazos e 2 tarefas')
  assert.equal(resumoDoModelo({ prazos: [modelo.prazos[0]], tarefas: [] }), '1 prazo')
  assert.equal(resumoDoModelo({ prazos: [], tarefas: [modelo.tarefas[0]] }), '1 tarefa')
})
