import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularVencimento, resumoDaRegra } from '../src/routes/casos/regrasPrazo.ts'

const tipo = (dados = {}) => ({
  id: 'tipo-1', nome: 'Contestação', dias: 5, contagem: 'uteis', base_legal: null,
  inicio: 'disponibilizacao', ativo: true, ...dados,
})

// Cliente falso: devolve os feriados do ano pedido e anota cada consulta.
function clienteFalso(feriadosPorAno = {}) {
  const consultas = []
  return {
    consultas,
    async chamarFerramenta(nome, argumentos) {
      consultas.push({ nome, ...argumentos })
      return { municipio: argumentos.municipio, feriados: feriadosPorAno[argumentos.ano] ?? [] }
    },
  }
}

test('dias úteis a partir da disponibilização no DJEN', async () => {
  // quinta 12/11/2026: disponibilização 12, publicação na sexta 13, contagem começa na segunda 16.
  // 5 dias úteis: 16, 17, 18, 19 e 20/11.
  const cliente = clienteFalso()
  const r = await calcularVencimento(cliente, { base: '2026-11-12', tipo: tipo(), tribunal: 'tjsp', municipio: 'Campinas' })
  assert.equal(r.data, '2026-11-20')
  // O serviço garante feriados, não suspensões: a data continua sendo estimativa.
  assert.equal(r.aConfirmar, true)
  assert.deepEqual(cliente.consultas.map(c => [c.nome, c.ano, c.tribunal, c.municipio]), [
    ['buscar_feriados_forenses', 2026, 'tjsp', 'Campinas'],
  ])
})

test('dias corridos que terminam no fim de semana prorrogam para segunda-feira', async () => {
  // quinta 12/11/2026 + 3 dias corridos = sábado 14/11 -> segunda 16/11 (CPC art. 224, §1º).
  const r = await calcularVencimento(clienteFalso(), {
    base: '2026-11-12', tipo: tipo({ dias: 3, contagem: 'corridos', inicio: 'movimento' }), tribunal: 'tjsp', municipio: 'Campinas',
  })
  assert.equal(r.data, '2026-11-16')
})

test('falha na consulta de feriados usa calendário sem feriados e marca a data a confirmar', async () => {
  const cliente = { chamarFerramenta: async () => { throw new Error('Calendário indisponível.') } }
  const r = await calcularVencimento(cliente, { base: '2026-11-12', tipo: tipo(), tribunal: 'tjsp', municipio: 'Campinas' })
  assert.equal(r.data, '2026-11-20')
  assert.equal(r.aConfirmar, true)
  assert.equal(r.fonte, 'Sem feriados locais')
})

test('sem tribunal ou município não consulta feriados e marca a data a confirmar', async () => {
  const cliente = clienteFalso()
  const r = await calcularVencimento(cliente, { base: '2026-11-12', tipo: tipo(), tribunal: '', municipio: 'Campinas' })
  assert.equal(r.data, '2026-11-20')
  assert.equal(r.aConfirmar, true)
  assert.equal(cliente.consultas.length, 0)
})

test('feriado municipal empurra o vencimento para o próximo dia útil', async () => {
  // segunda 16/11/2026 é feriado: a contagem de 5 dias úteis termina em 19/11, não em 18/11.
  const r = await calcularVencimento(clienteFalso({ 2026: [{ data: '2026-11-16', descricao: 'Feriado municipal' }] }), {
    base: '2026-11-12', tipo: tipo({ inicio: 'movimento' }), tribunal: 'tjsp', municipio: 'Campinas',
  })
  assert.equal(r.data, '2026-11-19')
})

test('busca os feriados também do ano seguinte quando a contagem atravessa o ano', async () => {
  const cliente = clienteFalso()
  const r = await calcularVencimento(cliente, {
    base: '2026-12-15', tipo: tipo({ dias: 30 }), tribunal: 'tjsp', municipio: 'Campinas',
  })
  // O recesso de 20/12 a 20/01 suspende a contagem: o vencimento cai em 2027.
  assert.ok(r.data > '2027-01-20', r.data)
  assert.deepEqual([...new Set(cliente.consultas.map(c => c.ano))], [2026, 2027])
})

test('resumo da regra mostra escopo, palavras e a combinação', () => {
  assert.equal(
    resumoDaRegra({ escopo: [{ tipo: 'classe', codigo: 7, nome: 'Ação de cobrança' }], palavras: 'contestar ou "prazo de 15 dias"', combinacao: 'e' }),
    'Classe “Ação de cobrança” e palavras-chave: contestar ou "prazo de 15 dias"',
  )
  assert.equal(
    resumoDaRegra({
      escopo: [{ tipo: 'classe', codigo: 7, nome: 'Ação de cobrança' }, { tipo: 'assunto', codigo: null, nome: 'Cobrança' }],
      palavras: 'contestar', combinacao: 'ou',
    }),
    'Classe “Ação de cobrança”, Assunto “Cobrança” ou palavras-chave: contestar',
  )
  assert.equal(
    resumoDaRegra({
      escopo: [
        { tipo: 'classe', codigo: 1, nome: 'A' }, { tipo: 'assunto', codigo: 2, nome: 'B' }, { tipo: 'assunto', codigo: 3, nome: 'C' },
      ],
      palavras: '', combinacao: 'e',
    }),
    'Classe “A”, Assunto “B” e mais 1',
  )
  assert.equal(resumoDaRegra({ escopo: [], palavras: '', combinacao: 'e' }), 'Nenhum critério preenchido')
  assert.equal(resumoDaRegra({ escopo: [], palavras: '', tipos_publicacao: ['Intimação'], combinacao: 'e' }), 'publicação do tipo “Intimação”')
  assert.equal(
    resumoDaRegra({ escopo: [], palavras: 'contestar', tipos_publicacao: ['Intimação', 'Despacho'], combinacao: 'ou' }),
    'publicação do tipo “Intimação”, “Despacho” ou palavras-chave: contestar',
  )
})
