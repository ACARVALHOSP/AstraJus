import test from 'node:test'
import assert from 'node:assert/strict'
import { analisar, AMOSTRA_MINIMA, consultasDe, ehTjsp, escolhaInicial, pendencias, periodoPadrao, textoResumo } from '../src/routes/casos/jurimetriaCaso.ts'

const c = (id, nome) => ({ id, nome, caminho: nome, confianca: 1 })
const PERIODO = { inicio: '14/11/2025', fim: '13/11/2026' }

test('período padrão: 364 dias terminando hoje (o máximo do e-SAJ)', () => {
  assert.deepEqual(periodoPadrao(new Date(2026, 10, 13)), PERIODO)
  assert.deepEqual(periodoPadrao(new Date(2024, 11, 31)), { inicio: '02/01/2024', fim: '31/12/2024' }) // ano bissexto: ainda 364 dias
  const [d, m, a] = periodoPadrao(new Date(2026, 2, 1)).inicio.split('/').map(Number)
  assert.equal(Math.round((new Date(2026, 2, 1) - new Date(a, m - 1, d)) / 86_400_000), 364)
})

test('só números do TJSP', () => {
  assert.equal(ehTjsp('1003325-11.2025.8.26.0100'), true)
  assert.equal(ehTjsp('10033251120258260100'), true)
  assert.equal(ehTjsp('0000001-00.2020.5.02.0001'), false)
  assert.equal(ehTjsp('1003325-11.2025.8.19.0001'), false)
  assert.equal(ehTjsp(''), false)
})

test('escolha inicial só pega o que a resolução escolheu sozinha', () => {
  const r = { tjsp: true, vara: { candidatos: [], escolhido: c('100-12', '12ª Vara Cível') }, classe: { candidatos: [c('1', 'a'), c('2', 'b')], escolhido: null, ambiguo: true }, assunto: undefined }
  assert.deepEqual(escolhaInicial(r), { vara: r.vara.escolhido, classe: null, assunto: null })
  assert.deepEqual(escolhaInicial(undefined), { vara: null, classe: null, assunto: null })
})

test('consultas: vara usa vara + classe; TJSP usa assunto (+ classe)', () => {
  const todos = consultasDe({ vara: c('100-12', '12ª Vara Cível'), classe: c('8501', 'Procedimento Comum Cível'), assunto: c('10433', 'Indenização por Dano Moral') }, PERIODO)
  assert.deepEqual(todos.map(x => x.chave), ['vara', 'tjsp'])
  assert.deepEqual(todos[0].params, { data_inicio: '14/11/2025', data_fim: '13/11/2026', paginas: 8, vara_codigo: '100-12', classe_codigo: '8501' })
  assert.equal(todos[1].params.assunto_codigo, '10433')
  assert.equal(todos[1].params.classe_codigo, '8501')
  assert.equal(todos[1].descricao, 'Indenização por Dano Moral · Procedimento Comum Cível')
  assert.ok(!('vara_codigo' in todos[1].params))
})

test('consultas: sem vara ou sem assunto só há o cartão possível', () => {
  assert.deepEqual(consultasDe({ vara: null, classe: c('8501', 'x'), assunto: c('1', 'y') }, PERIODO).map(x => x.chave), ['tjsp'])
  assert.deepEqual(consultasDe({ vara: c('v', 'V'), classe: c('8501', 'x'), assunto: null }, PERIODO).map(x => x.chave), ['vara'])
  assert.deepEqual(consultasDe({ vara: c('v', 'V'), classe: null, assunto: null }, PERIODO), [])
  const semClasse = consultasDe({ vara: null, classe: null, assunto: c('1', 'y') }, PERIODO)
  assert.equal(semClasse[0].params.classe_codigo, null)
})

test('pendências do que falta escolher', () => {
  assert.deepEqual(pendencias({ vara: null, classe: null, assunto: null }), ['Escolha a classe do processo.', 'Escolha a vara ou o assunto.'])
  assert.deepEqual(pendencias({ vara: c('v', 'V'), classe: c('c', 'C'), assunto: null }), [])
  assert.deepEqual(pendencias({ vara: null, classe: c('c', 'C'), assunto: c('a', 'A') }), [])
})

const sentencas = (desfechos, valor = null) => desfechos.map((d, i) => ({ desfecho: d, valor_condenacao: d === 'procedente' || d === 'parcial' ? valor : null, data_disponibilizacao: '10/10/2026', numero_processo: String(i) }))

test('análise: taxas sobre as classificadas, com intervalo de Wilson', () => {
  const itens = [...sentencas(Array(12).fill('procedente'), 5000), ...sentencas(Array(6).fill('parcial'), 3000), ...sentencas(Array(30).fill('improcedente')), ...sentencas(Array(12).fill('acordo')), ...sentencas(Array(40).fill(undefined))]
  const a = analisar({ resultados: itens, total_servidor: 200 })
  assert.equal(a.buscados, 100)
  assert.equal(a.classificados, 60)
  assert.equal(a.naoClassificados, 40)
  assert.equal(a.comProcedencia, 18)
  assert.equal(a.taxaProcedencia, 0.3)
  assert.ok(a.icProcedencia[0] < 0.3 && a.icProcedencia[1] > 0.3)
  assert.equal(a.taxaImprocedencia, 0.5)
  assert.equal(a.taxaAcordo, 0.2)
  assert.equal(a.amostraPequena, false)
  assert.equal(a.cobertura, 0.6)
  assert.equal(a.parcial, true) // 100 buscadas de 200
  assert.equal(a.valores.n, 18)
  assert.equal(a.valores.mediana, 5000)
})

test('análise: amostra pequena e resposta vazia', () => {
  const pequena = analisar({ resultados: sentencas(['procedente', 'improcedente', 'improcedente']), total_servidor: 3 })
  assert.equal(pequena.amostraPequena, true)
  assert.equal(pequena.parcial, false)
  const vazia = analisar({ resultados: [], total_servidor: null })
  assert.deepEqual([vazia.buscados, vazia.taxaProcedencia, vazia.valores, vazia.cobertura], [0, null, null, null])
  assert.equal(AMOSTRA_MINIMA, 30)
})

test('texto-resumo: frases para cada situação', () => {
  const grande = analisar({ resultados: [...sentencas(Array(10).fill('procedente'), 4000), ...sentencas(Array(20).fill('improcedente'))], total_servidor: 75 })
  const t = textoResumo(grande, PERIODO)
  assert.match(t, /Em 30 sentenças classificadas \(as 30 mais recentes de 75 publicadas de 14\/11\/2025 a 13\/11\/2026\)/)
  assert.match(t, /tiveram alguma procedência/)
  assert.match(t, /intervalo de 95%/)
  assert.match(t, /Valor mediano de condenação/)
  assert.doesNotMatch(t, /Amostra pequena/)
  const completo = analisar({ resultados: sentencas(Array(40).fill('improcedente')), total_servidor: 40 })
  assert.match(textoResumo(completo, PERIODO), /\(40 publicadas de/)
  assert.match(textoResumo(analisar({ resultados: sentencas(['procedente', 'acordo']), total_servidor: 2 }), PERIODO), /^Amostra pequena \(2 classificadas/)
  assert.match(textoResumo(analisar({ resultados: [], total_servidor: 0 }), PERIODO), /não devolveu sentenças/)
  assert.match(textoResumo(analisar({ resultados: sentencas([undefined, undefined]), total_servidor: 2 }), PERIODO), /nenhuma teve o desfecho identificado/)
})
