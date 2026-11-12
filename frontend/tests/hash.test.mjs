import assert from 'node:assert/strict'
import test from 'node:test'
import { chaveHash, lerHash, montarHash } from '../src/api/hash.ts'

test('lê tela e parâmetros do hash', () => {
  assert.deepEqual(lerHash('#/casos?id=abc-123&aba=atividades&atividadeId=7', 'inicio'),
    { aba: 'casos', parametros: { id: 'abc-123', aba: 'atividades', atividadeId: '7' } })
  assert.deepEqual(lerHash('#/financeiro', 'inicio'), { aba: 'financeiro', parametros: {} })
  assert.deepEqual(lerHash('', 'inicio'), { aba: 'inicio', parametros: {} })
  assert.deepEqual(lerHash('#/', 'inicio'), { aba: 'inicio', parametros: {} })
})

test('número CNJ e rótulos simples passam; link forjado é descartado', () => {
  assert.equal(lerHash('#/processo?numero_processo=0001234-56.2024.8.26.0100', 'inicio').parametros.numero_processo, '0001234-56.2024.8.26.0100')
  // tentativa de sair do caminho da API ou injetar conteúdo
  assert.deepEqual(lerHash('#/casos?id=../admin/usuarios', 'inicio').parametros, {})
  assert.deepEqual(lerHash('#/casos?id=1/../../x', 'inicio').parametros, {})
  assert.deepEqual(lerHash('#/casos?id=<script>', 'inicio').parametros, {})
  assert.deepEqual(lerHash('#/casos?id=a%2Fb', 'inicio').parametros, {})
  assert.deepEqual(lerHash(`#/casos?id=${'a'.repeat(121)}`, 'inicio').parametros, {})
  assert.deepEqual(lerHash('#/casos?__proto__=x&1x=y', 'inicio').parametros, {})
})

test('nome de tela inválido volta para o início', () => {
  assert.equal(lerHash('#/Casos%20x', 'inicio').aba, 'inicio')
  assert.equal(lerHash('#//evil.com', 'inicio').aba, 'inicio')
})

test('monta o hash só com o que é seguro e simples', () => {
  assert.equal(montarHash('casos', { id: 'c1', aba: 'atividades', atividadeId: 5 }), '/casos?id=c1&aba=atividades&atividadeId=5')
  assert.equal(montarHash('casos'), '/casos')
  assert.equal(montarHash('processo', { tribunal: '', numero_processo: '0001234-56.2024.8.26.0100' }), '/processo?numero_processo=0001234-56.2024.8.26.0100')
  assert.equal(montarHash('casos', { id: 'a b', outro: { x: 1 }, fn: () => 1, nulo: null }), '/casos')
  assert.equal(montarHash('casos', ['x']), '/casos')
})

test('montar e ler são inversos para os parâmetros usados no sistema', () => {
  const payload = { id: '8f14e45f-ceea-467f-a0e6-1c8d2c0b7f10', aba: 'atividades', atividadeId: '42' }
  assert.deepEqual(lerHash(`#${montarHash('casos', payload)}`, 'inicio'), { aba: 'casos', parametros: payload })
  assert.equal(chaveHash('#/casos?id=1'), 'casos?id=1')
})
