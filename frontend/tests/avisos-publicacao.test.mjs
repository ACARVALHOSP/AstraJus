import assert from 'node:assert/strict'
import test from 'node:test'
import { OPCOES_AVISOS, normalizarAvisos } from '../src/utils/avisosPublicacao.ts'
import { avaliarPerfil } from '../src/utils/perfil.ts'

test('três opções, na ordem esperada, cada uma com texto de ajuda', () => {
  assert.deepEqual(OPCOES_AVISOS.map(o => o.valor), ['imediato', 'resumo', 'ambos'])
  assert.ok(OPCOES_AVISOS.every(o => o.rotulo && o.descricao))
})

test('valor desconhecido ou ausente vira "ambos"', () => {
  for (const v of ['imediato', 'resumo', 'ambos']) assert.equal(normalizarAvisos(v), v)
  for (const v of [undefined, null, '', 'nunca', 3]) assert.equal(normalizarAvisos(v), 'ambos')
})

test('o perfil só manda a preferência quando ela muda', () => {
  const atual = { nome: 'Ana', email: 'ana@teste.com', foto: '', avisos: 'ambos' }
  assert.deepEqual(avaliarPerfil(atual, atual), { erro: null, mudancas: {}, alterado: false })
  const r = avaliarPerfil(atual, { ...atual, avisos: 'resumo' })
  assert.deepEqual(r.mudancas, { avisos_publicacao: 'resumo' })
  assert.equal(r.alterado, true)
  // chamadas antigas, sem o campo, continuam iguais
  assert.deepEqual(avaliarPerfil({ nome: 'Ana', email: 'ana@teste.com', foto: '' }, { nome: 'Ana', email: 'ana@teste.com', foto: '' }).mudancas, {})
})
