import assert from 'node:assert/strict'
import test from 'node:test'
import { interpretarConsulta } from '../src/utils/consultaDjen.ts'

test('reconhece número de processo com ou sem pontuação', () => {
  assert.deepEqual(interpretarConsulta('1006314-27.2023.8.26.0005'), { tipo: 'processo', numero: '10063142720238260005' })
  assert.deepEqual(interpretarConsulta('10063142720238260005'), { tipo: 'processo', numero: '10063142720238260005' })
})

test('reconhece OAB com UF em vários formatos', () => {
  assert.deepEqual(interpretarConsulta('123456/SP'), { tipo: 'oab', numero: '123456', uf: 'SP' })
  assert.deepEqual(interpretarConsulta('OAB 123456 sp'), { tipo: 'oab', numero: '123456', uf: 'SP' })
  assert.deepEqual(interpretarConsulta('123456-RJ'), { tipo: 'oab', numero: '123456', uf: 'RJ' })
  assert.deepEqual(interpretarConsulta('123456'), { tipo: 'oab', numero: '123456', uf: '' })
})

test('rejeita o que não é processo nem OAB', () => {
  assert.equal(interpretarConsulta(''), null)
  assert.equal(interpretarConsulta('123456/XX'), null)
  assert.equal(interpretarConsulta('Maria Silva'), null)
  assert.equal(interpretarConsulta('1234567'), null)
})
