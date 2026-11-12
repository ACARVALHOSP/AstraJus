import assert from 'node:assert/strict'
import test from 'node:test'
import { formatarDuracao, formatarRelogio, lerDuracao, situacaoDasHoras, motivoNaoFaturar, mesDe, parametrosDeHoras } from '../src/routes/horas/dados.ts'

test('formata a duração em horas e minutos', () => {
  assert.deepEqual([0, 1, 45, 60, 61, 90, 125, 1440].map(formatarDuracao), ['0min', '1min', '45min', '1h', '1h01', '1h30', '2h05', '24h'])
})

test('relógio do cronômetro', () => {
  assert.deepEqual([0, 5, 65, 3725, 90000].map(formatarRelogio), ['00:00:00', '00:00:05', '00:01:05', '01:02:05', '25:00:00'])
  assert.equal(formatarRelogio(-3), '00:00:00')
})

test('lê o que a pessoa digita em vários formatos', () => {
  const casos = { '1:30': 90, '01:05': 65, '0:45': 45, '1h30': 90, '1h 30min': 90, '2h': 120, '2 h': 120, '45min': 45, '45 m': 45,
    '90': 90, '5': 5, '1,5': 90, '1.5': 90, '0,25': 15, '  2H15  ': 135, '24:00': 1440, '24h': 1440 }
  for (const [texto, esperado] of Object.entries(casos)) assert.equal(lerDuracao(texto), esperado, texto)
})

test('recusa o que não é uma duração válida', () => {
  for (const texto of ['', 'abc', '0', '0:00', '1:60', '1h60', '25:00', '1441', '25h', '-5', '1:2:3', '1,555', 'h30', '1,5h']) {
    assert.equal(lerDuracao(texto), null, texto)
  }
})

test('situação das horas', () => {
  assert.deepEqual(situacaoDasHoras({ faturavel: false, faturado: false, valor_hora: 100 }), { texto: 'Não faturável', cor: 'gray' })
  assert.deepEqual(situacaoDasHoras({ faturavel: true, faturado: true, valor_hora: 100 }), { texto: 'Faturado', cor: 'green' })
  assert.deepEqual(situacaoDasHoras({ faturavel: true, faturado: false, valor_hora: null }), { texto: 'Sem valor/hora', cor: 'amber' })
  assert.deepEqual(situacaoDasHoras({ faturavel: true, faturado: false, valor_hora: 300 }), { texto: 'A faturar', cor: 'blue' })
})

test('regras para faturar a seleção', () => {
  const h = (extra = {}) => ({ id: 1, caso_id: 'c1', faturavel: true, faturado: false, valor_hora: 300, ...extra })
  assert.equal(motivoNaoFaturar([]), 'Selecione as horas que quer faturar.')
  assert.equal(motivoNaoFaturar([h(), h({ id: 2 })]), null)
  assert.match(motivoNaoFaturar([h(), h({ faturado: true })]), /ainda não faturadas/)
  assert.match(motivoNaoFaturar([h({ valor_hora: null })]), /valor por hora/)
  assert.match(motivoNaoFaturar([h({ faturavel: false })]), /faturáveis/)
  assert.match(motivoNaoFaturar([h(), h({ caso_id: 'c2' })]), /um processo por vez/)
})

test('mês corrente com fevereiro e ano bissexto', () => {
  assert.deepEqual(mesDe(new Date(2026, 10, 12)), { de: '2026-11-01', ate: '2026-11-30' })
  assert.deepEqual(mesDe(new Date(2028, 1, 10)), { de: '2028-02-01', ate: '2028-02-29' })
  assert.deepEqual(mesDe(new Date(2026, 11, 31)), { de: '2026-12-01', ate: '2026-12-31' })
})

test('parâmetros da consulta por status', () => {
  const base = { de: '2026-11-01', ate: '2026-11-30', usuario: '', casoId: '' }
  assert.equal(parametrosDeHoras({ ...base, status: 'todos' }), 'de=2026-11-01&ate=2026-11-30')
  assert.equal(parametrosDeHoras({ ...base, status: 'a_faturar' }), 'de=2026-11-01&ate=2026-11-30&faturavel=true&faturado=false')
  assert.equal(parametrosDeHoras({ ...base, status: 'faturadas', usuario: 'ana@x.com', casoId: 'c1' }), 'de=2026-11-01&ate=2026-11-30&usuario=ana%40x.com&caso_id=c1&faturado=true')
  assert.equal(parametrosDeHoras({ ...base, status: 'nao_faturaveis' }), 'de=2026-11-01&ate=2026-11-30&faturavel=false')
})
