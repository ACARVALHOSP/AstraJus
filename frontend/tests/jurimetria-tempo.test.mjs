import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anoDoNumero, calcularProvisao, classificarRisco, dataDaCapa, dataDdMmAaaa, idadeDoProcesso, idadeNaSentenca, lerReais,
  mesesEntre, resumirTempo, textoProvisao, textoTempo, LIMITES_RISCO,
} from '../src/routes/casos/jurimetriaTempo.ts'

const num = ano => `1003325-11.${ano}.8.26.0100`
// null (e não undefined) para "sem desfecho": undefined ativaria o valor padrão do parâmetro
const item = (ano, data, desfecho = 'procedente') => ({ numero_processo: num(ano), data_disponibilizacao: data, desfecho })

test('ano da distribuição vem do número CNJ', () => {
  assert.equal(anoDoNumero('1003325-11.2024.8.26.0100'), 2024)
  assert.equal(anoDoNumero('10033251120248260100'), 2024)
  assert.equal(anoDoNumero('123'), null)
  assert.equal(anoDoNumero('1003325-11.1850.8.26.0100'), null)
})

test('datas: dd/mm/aaaa e a da capa; inválidas viram null', () => {
  assert.equal(dataDdMmAaaa('13/11/2026').getMonth(), 10)
  assert.equal(dataDdMmAaaa('31/02/2026'), null)
  assert.equal(dataDdMmAaaa('2026-11-13'), null)
  assert.equal(dataDaCapa('20240305143000').getDate(), 5)
  assert.equal(dataDaCapa('2024-03-05T10:00:00Z').getMonth(), 2)
  assert.equal(dataDaCapa('amanhã'), null)
  assert.equal(dataDaCapa(null), null)
})

test('idade na sentença: meio do ano de distribuição, sem passar da data da sentença', () => {
  // distribuído em 2024, sentença em 02/07/2025: ~meio de 2024 a jul/2025 = ~12 meses
  const m = idadeNaSentenca(item(2024, '02/07/2025'))
  assert.ok(m > 11.5 && m < 12.5, String(m))
  // mesmo ano: a distribuição fica entre 1º/jan e a sentença (meio do caminho), nunca depois dela
  const mesmoAno = idadeNaSentenca(item(2026, '01/07/2026'))
  assert.ok(mesmoAno >= 0 && mesmoAno < 3.5, String(mesmoAno))
  assert.equal(idadeNaSentenca(item(2027, '10/10/2026')), null) // sentença antes do ano do número: dado inconsistente
  assert.equal(idadeNaSentenca({ numero_processo: 'x', data_disponibilizacao: '10/10/2026' }), null)
  assert.equal(idadeNaSentenca(item(1995, '10/10/2026')), null) // mais de 20 anos: descartada
})

test('resumo do tempo: só decisões com desfecho; quartis e descartados', () => {
  const itens = [item(2025, '01/07/2026'), item(2024, '01/07/2026'), item(2023, '01/07/2026'), item(2022, '01/07/2026'), item(2021, '01/07/2026'),
    item(2024, '01/07/2026', null),                              // sem desfecho (cumprimento): fora
    { numero_processo: 'x', data_disponibilizacao: '01/07/2026', desfecho: 'procedente' }] // classificada, mas sem ano no número: descartada
  const r = resumirTempo(itens)
  assert.equal(r.n, 5)
  assert.equal(r.descartados, 1)
  assert.ok(r.mediana > 35 && r.mediana < 37, String(r.mediana)) // 2023 -> mid-2023 a jul/2026 ≈ 36 meses
  assert.ok(r.p25 < r.mediana && r.mediana < r.p75)
  assert.equal(r.margem, 6)
  assert.equal(r.amostraPequena, true)
  assert.equal(resumirTempo([item(2024, '01/07/2026', null)]), null)
  assert.equal(resumirTempo([]), null)
})

test('idade do processo: exata pela capa; estimada pelo número; futura é ignorada', () => {
  const hoje = new Date(2026, 10, 13, 12)
  const exata = idadeDoProcesso('20250513000000', num(2025), hoje)
  assert.equal(exata.exata, true)
  assert.ok(Math.abs(exata.meses - 18) < 0.2, String(exata.meses))
  const estimada = idadeDoProcesso(null, num(2025), hoje)
  assert.equal(estimada.exata, false)
  assert.ok(estimada.meses > 15 && estimada.meses < 21)
  assert.equal(idadeDoProcesso('29990101', num(2025), hoje).exata, false) // data futura: cai no número
  assert.equal(idadeDoProcesso(null, 'x', hoje), null)
  assert.ok(Math.abs(mesesEntre(new Date(2025, 0, 1, 12), new Date(2026, 0, 1, 12)) - 12) < 0.05)
})

test('texto do tempo: mediana, margem, onde o processo está e a ressalva', () => {
  const itens = [item(2025, '01/07/2026'), item(2024, '01/07/2026'), item(2023, '01/07/2026'), item(2022, '01/07/2026'), item(2021, '01/07/2026')]
  const r = resumirTempo(itens)
  const t = textoTempo(r, { meses: 24, exata: true }).join(' ')
  assert.match(t, /^Amostra pequena \(5 tempos/)
  assert.match(t, /mediana de 36 meses/)
  assert.match(t, /margem de cerca de 6 meses/)
  assert.match(t, /Este processo tem 24 meses\./)
  assert.match(t, /pela mediana, faltariam cerca de 12 meses/)
  assert.match(t, /tende a ser maior/)
  assert.match(textoTempo(r, { meses: 100, exata: false }).join(' '), /cerca de 100 meses \(estimado pelo ano do número\)\. Já passou do tempo em que 3 de cada 4/)
  assert.match(textoTempo(r, { meses: 40, exata: true }).join(' '), /ele já passou do tempo mediano/)
  assert.doesNotMatch(textoTempo(r, null).join(' '), /Este processo tem/)
})

test('provisão: valor × chance × fator médio, e a faixa pelo intervalo da chance', () => {
  // 60 classificadas: 12 procedentes + 6 parciais = chance 0,30; parcial vale 50%
  const p = { valorBase: 10000, chance: 0.3, intervalo: [0.2, 0.4], procedentes: 12, parciais: 6, fatorParcial: 0.5 }
  const r = calcularProvisao(p)
  assert.ok(Math.abs(r.fatorMedio - 15 / 18) < 1e-9)
  assert.ok(Math.abs(r.esperado - 2500) < 1e-6)    // 10.000 × (0,20 + 0,10 × 0,5)
  assert.ok(Math.abs(r.minimo - 10000 * 0.2 * (15 / 18)) < 1e-6)
  assert.ok(Math.abs(r.maximo - 10000 * 0.4 * (15 / 18)) < 1e-6)
  assert.ok(r.minimo < r.esperado && r.esperado < r.maximo)
})

test('provisão: casos de borda', () => {
  assert.equal(calcularProvisao({ valorBase: 5000, chance: 0, intervalo: null, procedentes: 0, parciais: 0, fatorParcial: 0.5 }).esperado, 0)
  assert.equal(calcularProvisao({ valorBase: 5000, chance: 0.5, intervalo: null, procedentes: 0, parciais: 0, fatorParcial: 0.5 }).minimo, null)
  const soParcial = calcularProvisao({ valorBase: 1000, chance: 0.4, intervalo: null, procedentes: 0, parciais: 8, fatorParcial: 0.25 })
  assert.ok(Math.abs(soParcial.esperado - 100) < 1e-9)  // só parciais: 1.000 × 0,4 × 0,25
  const soProcedente = calcularProvisao({ valorBase: 1000, chance: 0.4, intervalo: null, procedentes: 8, parciais: 0, fatorParcial: 0.25 })
  assert.ok(Math.abs(soProcedente.esperado - 400) < 1e-9)
  assert.equal(calcularProvisao({ valorBase: 0, chance: 0.9, intervalo: [0.8, 1], procedentes: 3, parciais: 3, fatorParcial: 0.5 }).esperado, 0)
})

test('classificação de risco: limites de referência', () => {
  assert.deepEqual(LIMITES_RISCO, { provavel: 0.7, possivel: 0.3 })
  assert.equal(classificarRisco(0.7), 'provavel')
  assert.equal(classificarRisco(0.69), 'possivel')
  assert.equal(classificarRisco(0.3), 'possivel')
  assert.equal(classificarRisco(0.29), 'remota')
  assert.equal(classificarRisco(0), 'remota')
})

test('valor digitado em reais', () => {
  assert.equal(lerReais('1.500,50'), 1500.5)
  assert.equal(lerReais('R$ 12.000'), 12000)
  assert.equal(lerReais('1500.5'), 1500.5)
  assert.equal(lerReais('1.500'), 1500)            // ponto + 3 dígitos, sem vírgula: milhar
  assert.equal(lerReais('1.500.000'), 1500000)
  assert.equal(lerReais('2.5'), 2.5)
  assert.equal(lerReais('12.000,75'), 12000.75)
  assert.equal(lerReais('0,5'), 0.5)
  assert.equal(lerReais('  '), null)
  assert.equal(lerReais('abc'), null)
  assert.equal(lerReais('-10'), null)
})

test('texto da provisão muda conforme a perspectiva e traz a conta', () => {
  const p = { valorBase: 10000, chance: 0.3, intervalo: [0.2, 0.4], procedentes: 12, parciais: 6, fatorParcial: 0.5 }
  const r = calcularProvisao(p)
  const reu = textoProvisao(r, p, 'reu')
  assert.match(reu, /^Exposição esperada: R\$\s2\.500,00/)
  assert.match(reu, /× 30,0% de chance de alguma procedência × 83,3% do valor em média \(procedente 100%, parcial 50,0%\)/)
  assert.match(textoProvisao(r, p, 'autor'), /^Expectativa de recebimento: /)
  assert.doesNotMatch(textoProvisao(calcularProvisao({ ...p, intervalo: null }), { ...p, intervalo: null }, 'reu'), /faixa pelo intervalo/)
})
