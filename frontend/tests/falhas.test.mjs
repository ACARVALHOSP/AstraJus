import assert from 'node:assert/strict'
import test from 'node:test'
import { ehFalhaDeCarregamento } from '../src/utils/falhas.ts'

test('reconhece falha ao baixar o arquivo de uma tela (Chrome, Firefox, Safari, Webpack)', () => {
  assert.equal(ehFalhaDeCarregamento(new TypeError('Failed to fetch dynamically imported module: https://x/radix/assets/Casos-abc.js')), true)
  assert.equal(ehFalhaDeCarregamento(new TypeError('error loading dynamically imported module')), true)
  assert.equal(ehFalhaDeCarregamento(new TypeError('Importing a module script failed.')), true)
  const chunk = new Error('Loading chunk 12 failed.'); chunk.name = 'ChunkLoadError'
  assert.equal(ehFalhaDeCarregamento(chunk), true)
})

test('erros comuns de renderização não são tratados como falha de download', () => {
  assert.equal(ehFalhaDeCarregamento(new TypeError("Cannot read properties of undefined (reading 'titulo')")), false)
  assert.equal(ehFalhaDeCarregamento(new Error('Total inválido')), false)
  assert.equal(ehFalhaDeCarregamento(undefined), false)
  assert.equal(ehFalhaDeCarregamento('falhou'), false)
})
