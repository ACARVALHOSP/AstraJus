import assert from 'node:assert/strict'
import test from 'node:test'
import { diaLocal, noPeriodo, ordenarItens, colunaAtividade } from '../src/routes/home/dados.ts'

const agora = new Date(2026, 9, 30, 23, 55)
const atividade = (data, status = 'pendente') => ({ id: 1, titulo: 'Prazo', tipo: 'prazo', status, data })

test('vencimentos usam a data civil local e não tratam hoje como atraso', () => {
  assert.equal(diaLocal(agora), '2026-10-30')
  assert.equal(noPeriodo(atividade('2026-10-29'), 'atrasadas', agora), true)
  assert.equal(noPeriodo(atividade('2026-10-30'), 'atrasadas', agora), false)
  assert.equal(noPeriodo(atividade('2026-10-30'), 'hoje', agora), true)
})

test('próximos sete dias cruzam o mês e excluem hoje e o oitavo dia', () => {
  assert.equal(noPeriodo(atividade('2026-10-30'), 'semana', agora), false)
  assert.equal(noPeriodo(atividade('2026-10-31'), 'semana', agora), true)
  assert.equal(noPeriodo(atividade('2026-11-06'), 'semana', agora), true)
  assert.equal(noPeriodo(atividade('2026-11-07'), 'semana', agora), false)
})

test('concluídas e atividades sem data não entram nos indicadores de vencimento', () => {
  for (const periodo of ['atrasadas', 'hoje', 'semana']) {
    assert.equal(noPeriodo(atividade(null), periodo, agora), false)
    for (const data of ['2026-10-29', '2026-10-30', '2026-11-01']) {
      assert.equal(noPeriodo(atividade(data, 'concluida'), periodo, agora), false)
    }
  }
  assert.equal(noPeriodo(atividade(null, 'concluida'), '', agora), true)
})

test('ordenação prioriza data e hora e deixa atividades sem data por último', () => {
  const item = (id, data, hora) => ({ processo: { id: 'p' }, atividade: { ...atividade(data), id, hora }, checklist: null })
  const itens = [item(1, null), item(2, '2026-10-31'), item(3, '2026-10-30', '14:00'), item(4, '2026-10-30', '09:00')]
  assert.deepEqual(itens.sort(ordenarItens).map(i => i.atividade.id), [4, 3, 2, 1])
})

test('status legados desconhecidos continuam visíveis em A fazer', () => {
  assert.equal(colunaAtividade('legado'), 'pendente')
  assert.equal(colunaAtividade('aguardando'), 'aguardando')
  assert.equal(colunaAtividade('concluida'), 'concluida')
})
