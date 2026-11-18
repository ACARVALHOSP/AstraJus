import assert from 'node:assert/strict'
import test from 'node:test'
import { escolherSugestao, motivoDaSugestao, sugestoesParaLista } from '../src/routes/publicacoes-oab/sugestaoModelo.ts'

const classeCobranca = { tipo: 'classe', codigo: 1, nome: 'Ação de Cobrança' }

function sugestao({ id = 'r1', nome = 'Contestação em cobrança', tipo = 't1', tipoNome = 'Contestação', dias = 15, contagem = 'uteis', escopo = [classeCobranca], palavras = 'contestar', termos = ['contestar'], correspondeu_a = classeCobranca } = {}) {
  return {
    regra: { id, nome, tipo_id: tipo, escopo, palavras, combinacao: 'e', ativo: true },
    tipo: { id: tipo, nome: tipoNome, dias, contagem, base_legal: null, inicio: 'disponibilizacao', ativo: true },
    correspondeu_a,
    termos,
  }
}

test('sem sugestões, não sugere nada', () => {
  assert.equal(escolherSugestao([]), null)
  assert.equal(escolherSugestao(undefined), null)
})

test('uma sugestão vira regra, prazo e motivo legíveis', () => {
  const r = escolherSugestao([sugestao({ termos: ['contestar', 'prazo de 15 dias'] })])
  assert.equal(r?.regra, 'Contestação em cobrança')
  assert.deepEqual(r?.prazo, { titulo: 'Contestação', dias: 15, contagem: 'uteis' })
  assert.equal(r?.motivo, 'termos “contestar” e “prazo de 15 dias” e classe “Ação de Cobrança”')
})

test('várias sugestões: vale a primeira (a mais específica, já ordenada)', () => {
  const primeira = sugestao({ id: 'r1', nome: 'Contestação', dias: 15 })
  const segunda = sugestao({ id: 'r2', nome: 'Genérica', tipo: 't2', tipoNome: 'Manifestação', dias: 5, contagem: 'corridos', correspondeu_a: null, termos: [] })
  const r = escolherSugestao([primeira, segunda])
  assert.equal(r?.regra, 'Contestação')
  assert.deepEqual(r?.prazo, { titulo: 'Contestação', dias: 15, contagem: 'uteis' })
  assert.deepEqual(sugestoesParaLista([primeira, segunda]).map(s => s.regra), ['Contestação', 'Genérica'])
})

test('motivo só com termos casados', () => {
  const r = escolherSugestao([sugestao({ correspondeu_a: null, termos: ['embargos', '5 dias'] })])
  assert.equal(r?.motivo, 'termos “embargos” e “5 dias”')
})

test('motivo só com a classe casada', () => {
  const r = escolherSugestao([sugestao({ termos: [] })])
  assert.equal(r?.motivo, 'classe “Ação de Cobrança”')
  const assunto = escolherSugestao([sugestao({ termos: [], correspondeu_a: { tipo: 'assunto', codigo: null, nome: 'Horas extras' } })])
  assert.equal(assunto?.motivo, 'assunto “Horas extras”')
})

test('sem termos nem escopo, assume o casamento da regra', () => {
  assert.equal(motivoDaSugestao({ termos: [], correspondeu_a: null }), 'a regra casou com o processo e a publicação')
})

test('motivo com o tipo da publicação, sozinho ou junto de termos e escopo', () => {
  assert.equal(motivoDaSugestao({ termos: [], correspondeu_a: null, tipo_publicacao_casou: 'Intimação' }), 'tipo de publicação “Intimação”')
  assert.equal(
    motivoDaSugestao({ termos: ['contestar'], correspondeu_a: { tipo: 'classe', codigo: null, nome: 'Cobrança' }, tipo_publicacao_casou: 'Despacho' }),
    'termos “contestar” e tipo de publicação “Despacho” e classe “Cobrança”',
  )
})
