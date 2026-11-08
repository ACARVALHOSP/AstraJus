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
