import assert from 'node:assert/strict'
import test from 'node:test'
import { erroDasRegras, moverRegra, resumoRegra, LIMITE_REGRAS } from '../src/routes/administracao/regrasResponsavel.ts'

const r = (tipo, valor = '', responsavel = '', extra = {}) => ({ tipo, valor, responsavel, ativo: true, ...extra })
const ativos = ['ana', 'bia']

test('mover regra: troca vizinhas e o padrão nunca sai do fim', () => {
  const lista = [r('classe', 'x', 'ana'), r('tribunal', 'TJSP', 'bia'), r('padrao', '', 'ana')]
  assert.deepEqual(moverRegra(lista, 1, -1).map(x => x.tipo), ['tribunal', 'classe', 'padrao'])
  assert.equal(moverRegra(lista, 1, 1), lista)          // não passa por baixo do padrão
  assert.equal(moverRegra(lista, 2, -1), lista)         // o padrão não sobe
  assert.equal(moverRegra(lista, 0, -1), lista)         // limites
})

test('validação local das regras', () => {
  assert.equal(erroDasRegras([], ativos), '')
  assert.equal(erroDasRegras([r('captou'), r('classe', 'x', 'ana'), r('padrao', '', '')], ativos), '')
  assert.match(erroDasRegras([r('classe', ' ', 'ana')], ativos), /preencha o valor/)
  assert.match(erroDasRegras([r('classe', 'x', '')], ativos), /responsável ativo/)
  assert.match(erroDasRegras([r('classe', 'x', 'fulano')], ativos), /responsável ativo/)
  assert.match(erroDasRegras([r('padrao', '', 'ana'), r('padrao', '', 'bia')], ativos), /um padrão/)
  assert.match(erroDasRegras(Array(LIMITE_REGRAS + 1).fill(r('captou')), ativos), /No máximo/)
  assert.match(erroDasRegras([r('classe', 'x'.repeat(201), 'ana')], ativos), /longo demais/)
})

test('resumo da regra em uma frase', () => {
  const pessoa = l => l.toUpperCase(), cliente = id => `Cliente ${id}`
  assert.equal(resumoRegra(r('cliente', 'c1', 'ana'), pessoa, cliente), 'Cliente “Cliente c1” → ANA')
  assert.equal(resumoRegra(r('padrao'), pessoa, cliente), 'Todo o resto → ninguém')
  assert.equal(resumoRegra(r('captou'), pessoa, cliente), 'Quem captou a publicação fica responsável')
})
