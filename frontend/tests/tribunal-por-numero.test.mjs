import assert from 'node:assert/strict'
import test from 'node:test'
import { dvCnjEsperado, dvCnjValido, erroNumeroCnj, siglaTribunalPorNumero } from '../src/utils/tribunalPorNumero.ts'

const num = (j, tr) => `1006314002023${j}${tr}0005`

test('dígito verificador (mesmos casos de test_cnj.py)', () => {
  assert.equal(dvCnjEsperado('1006314-27.2023.8.26.0005'), '27')
  assert.ok(dvCnjValido('1006314-27.2023.8.26.0005'))
  assert.ok(!dvCnjValido('1006314-28.2023.8.26.0005'))
  assert.match(erroNumeroCnj('1006314-99.2023.8.26.0005'), /dígito verificador.*27/)
  assert.match(erroNumeroCnj('123'), /20 dígitos/)
  assert.equal(erroNumeroCnj('1006314-27.2023.8.26.0005'), '')
})

test('sigla do tribunal igual à do backend', () => {
  const casos = {
    '8.26': 'tjsp', '8.07': 'tjdft', '8.19': 'tjrj', '4.01': 'trf1', '4.06': 'trf6',
    '5.02': 'trt2', '5.24': 'trt24', '6.26': 'tre-sp', '6.01': 'tre-ac',
    '3.00': 'stj', '5.00': 'tst', '6.00': 'tse', '7.00': 'stm',
    '9.13': 'tjmmg', '9.21': 'tjmrs', '9.26': 'tjmsp',
    '1.00': null, '2.00': null, '9.01': null, '8.28': null, '4.07': null,
  }
  for (const [jtr, esperado] of Object.entries(casos)) {
    const [j, tr] = jtr.split('.')
    assert.equal(siglaTribunalPorNumero(num(j, tr)), esperado, jtr)
  }
  assert.equal(siglaTribunalPorNumero('abc'), null)
})
