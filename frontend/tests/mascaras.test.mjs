import assert from 'node:assert/strict'
import test from 'node:test'
import { erroCpfCnpj } from '../src/utils/mascaras.ts'

test('CPF e CNPJ válidos passam; vazio é aceito', () => {
  assert.equal(erroCpfCnpj(''), '')
  assert.equal(erroCpfCnpj('529.982.247-25'), '')
  assert.equal(erroCpfCnpj('11.222.333/0001-81'), '')
})

test('dígito verificador errado, sequências e tamanho errado são recusados', () => {
  assert.match(erroCpfCnpj('529.982.247-26'), /CPF inválido/)
  assert.match(erroCpfCnpj('111.111.111-11'), /CPF inválido/)
  assert.match(erroCpfCnpj('11.222.333/0001-82'), /CNPJ inválido/)
  assert.match(erroCpfCnpj('111'), /11 dígitos/)
})

import { mascaraTelefone, erroTelefone, erroEmail } from '../src/utils/mascaras.ts'

test('telefone recebe máscara de celular e de fixo', () => {
  assert.equal(mascaraTelefone('11999990000'), '(11) 99999-0000')
  assert.equal(mascaraTelefone('1133330000'), '(11) 3333-0000')
  assert.equal(mascaraTelefone('+55 11 99999-0000'), '(11) 99999-0000')
  assert.equal(erroTelefone('(11) 9999'), 'Telefone com DDD: 10 ou 11 dígitos.')
  assert.equal(erroTelefone('(11) 99999-0000'), '')
})

test('e-mail precisa de @ e domínio', () => {
  assert.equal(erroEmail(''), '')
  assert.equal(erroEmail('ana@exemplo.com.br'), '')
  assert.match(erroEmail('ana@exemplo'), /incompleto/)
  assert.match(erroEmail('ana.exemplo.com'), /incompleto/)
})
