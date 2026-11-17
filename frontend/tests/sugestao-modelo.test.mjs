import assert from 'node:assert/strict'
import test from 'node:test'
import { sugerirPorModelo, textoCitaPrazo } from '../src/routes/publicacoes-oab/sugestaoModelo.ts'

const cobranca = {
  nome: 'Cobrança', criterio: 'Ação de Cobrança', ativo: true,
  prazos: [{ titulo: 'Contestação', dias: 15, contagem: 'uteis' }, { titulo: 'Réplica', dias: 10, contagem: 'uteis' }],
}
const trabalhista = {
  nome: 'Trabalhista', criterio: 'Reclamação Trabalhista', ativo: true,
  prazos: [{ titulo: 'Recurso ordinário', dias: 8, contagem: 'uteis' }],
}

test('o texto cita o prazo pelo radical, sem acento e sem maiúsculas', () => {
  assert.equal(textoCitaPrazo('Contestação', 'Fica a parte ré intimada para CONTESTAR o feito.'), true)
  assert.equal(textoCitaPrazo('Recurso ordinário', 'Intime-se para razões do recurso ordinario.'), true)
  assert.equal(textoCitaPrazo('Recurso ordinário', 'Intime-se para o recurso.'), false)
  assert.equal(textoCitaPrazo('', 'qualquer texto'), false)
})

test('classe do modelo e texto da publicação juntos escolhem o prazo', () => {
  const r = sugerirPorModelo([cobranca, trabalhista], ['Ação de Cobrança de Aluguéis'], 'Intime-se a ré para apresentar contestação.')
  assert.equal(r?.modelo, 'Cobrança')
  assert.deepEqual(r?.prazo, { titulo: 'Contestação', dias: 15, contagem: 'uteis' })
  assert.equal(r?.classe, 'Ação de Cobrança de Aluguéis')
})

test('sem sugestão quando a classe não bate com o modelo', () => {
  assert.equal(sugerirPorModelo([cobranca], ['Procedimento Comum Cível'], 'Apresente contestação.'), null)
})

test('sem sugestão quando o texto não cita nenhum prazo do modelo', () => {
  assert.equal(sugerirPorModelo([cobranca], ['Ação de Cobrança'], 'Vista dos autos.'), null)
})

test('na dúvida (dois prazos citados) não sugere', () => {
  assert.equal(sugerirPorModelo([cobranca], ['Ação de Cobrança'], 'Apresente contestação e, depois, réplica.'), null)
})

test('modelo inativo não conta; o mesmo prazo repetido em dois modelos conta uma vez', () => {
  assert.equal(sugerirPorModelo([{ ...cobranca, ativo: false }], ['Ação de Cobrança'], 'Apresente contestação.'), null)
  const outro = { ...cobranca, nome: 'Cobrança 2', criterio: 'Cobrança' }
  assert.equal(sugerirPorModelo([cobranca, outro], ['Ação de Cobrança'], 'Apresente contestação.')?.prazo.dias, 15)
})

test('o assunto também escolhe o modelo', () => {
  assert.equal(sugerirPorModelo([trabalhista], ['Procedimento X', 'Reclamação Trabalhista - Horas extras'], 'Prazo para recurso ordinário.')?.prazo.dias, 8)
})
