import assert from 'node:assert/strict'
import test from 'node:test'
import { explicacaoAviso } from '../src/routes/casos/avisoProcessoParado.ts'

test('explicação: rotina ligada e processo ativo', () => {
  assert.equal(explicacaoAviso({ silenciado: false, rotina_ativa: true, dias: 60 }),
    'O responsável é avisado se o processo ficar 60 dias ou mais sem movimentação.')
})

test('explicação: processo silenciado', () => {
  assert.match(explicacaoAviso({ silenciado: true, rotina_ativa: true, dias: 60 }), /não gera aviso/)
})

test('explicação: rotina desligada no escritório vale para qualquer processo', () => {
  for (const silenciado of [true, false]) {
    assert.match(explicacaoAviso({ silenciado, rotina_ativa: false, dias: 60 }), /desligada no escritório/)
  }
})

test('o número de dias acompanha a configuração', () => {
  assert.match(explicacaoAviso({ silenciado: false, rotina_ativa: true, dias: 90 }), /90 dias/)
})
