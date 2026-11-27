import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretar } from '../src/utils/anotarRapido.ts'

// Quarta-feira, 25/11/2026.
const HOJE = new Date(2026, 10, 25)
const CASOS = [
  { id: '1', titulo: 'Silva x Banco Alfa', cliente: 'Maria Souza', processos: ['1234567-52.2020.8.26.0100'] },
  { id: '2', titulo: 'Lima x Construtora', cliente: 'João Lima', processos: [] },
  { id: '3', titulo: 'Pereira x INSS', cliente: 'Maria Pereira', processos: [] },
]

test('prazo com cliente único e dia da semana', () => {
  const r = interpretar('prazo contestação João sexta', HOJE, CASOS)
  assert.deepEqual(
    { tipo: r.tipo, titulo: r.titulo, data: r.data, hora: r.hora, casoId: r.casoId },
    { tipo: 'prazo', titulo: 'Contestação', data: '2026-11-27', hora: '', casoId: '2' },
  )
})

test('audiência amanhã com hora', () => {
  const r = interpretar('audiência amanhã 14h30', HOJE, [])
  assert.deepEqual({ tipo: r.tipo, titulo: r.titulo, data: r.data, hora: r.hora }, { tipo: 'audiencia', titulo: 'Audiência', data: '2026-11-26', hora: '14:30' })
})

test('"dia N" no mês seguinte quando já passou, e "às N"', () => {
  const r = interpretar('ligar para o João dia 3 às 9', HOJE, CASOS)
  assert.equal(r.data, '2026-12-03')
  assert.equal(r.hora, '09:00')
  assert.equal(r.casoId, '2')
  assert.equal(r.titulo, 'Ligar')
})

test('"dia N" ainda neste mês e virada de ano', () => {
  assert.equal(interpretar('juntar documentos dia 28', HOJE).data, '2026-11-28')
  assert.equal(interpretar('revisar dia 5', new Date(2026, 11, 20)).data, '2027-01-05')
})

test('data numérica e reunião', () => {
  const r = interpretar('reunião 05/12 10h', HOJE)
  assert.deepEqual({ tipo: r.tipo, data: r.data, hora: r.hora, titulo: r.titulo }, { tipo: 'reuniao', data: '2026-12-05', hora: '10:00', titulo: 'Reunião' })
  assert.equal(interpretar('protocolar 10/01', HOJE).data, '2027-01-10')
  assert.equal(interpretar('protocolar 31/02', HOJE).data, '')
})

test('o mesmo dia da semana vale para a próxima semana; hoje e "em N dias"', () => {
  assert.equal(interpretar('ligar quarta', HOJE).data, '2026-12-02')
  assert.equal(interpretar('ligar quinta que vem', HOJE).data, '2026-11-26')
  assert.equal(interpretar('ligar hoje', HOJE).data, '2026-11-25')
  assert.equal(interpretar('ligar depois de amanhã', HOJE).data, '2026-11-27')
  assert.equal(interpretar('enviar em 10 dias', HOJE).data, '2026-12-05')
})

test('hora inválida é ignorada e fica no título', () => {
  const r = interpretar('chamar 25h', HOJE)
  assert.equal(r.hora, '')
  assert.equal(r.titulo, 'Chamar 25h')
})

test('processo ambíguo não é escolhido; o título mantém o nome', () => {
  const r = interpretar('prazo recurso Maria', HOJE, CASOS)
  assert.equal(r.casoId, null)
  assert.deepEqual([...r.candidatos].sort(), ['1', '3'])
  assert.equal(r.titulo, 'Recurso Maria')
})

test('número CNJ aponta o processo', () => {
  const r = interpretar('prazo apelação 1234567-52.2020.8.26.0100 sexta', HOJE, CASOS)
  assert.equal(r.casoId, '1')
  assert.equal(r.titulo, 'Apelação')
})

test('texto vazio ou só com data não quebra', () => {
  assert.deepEqual(interpretar('', HOJE).titulo, '')
  const r = interpretar('amanhã', HOJE)
  assert.equal(r.titulo, '')
  assert.equal(r.data, '2026-11-26')
})
