// Testes do cálculo de prazos (frontend/src/routes/publicacoes-oab/prazos.ts). Roda com: node test_prazos.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const saida = mkdtempSync(join(tmpdir(), 'prazos-'))
execFileSync('frontend/node_modules/.bin/tsc', ['--outDir', saida, '--module', 'esnext', '--target', 'es2022', '--skipLibCheck',
  'frontend/src/routes/publicacoes-oab/prazos.ts'], { stdio: 'inherit' })
const { calcularPrazo, cruzaRecesso, sugerirPrazoPadrao, PRAZOS_PADRAO } = await import(pathToFileURL(join(saida, 'prazos.js')).href)

const feriado = (d, descricao = 'Feriado') => ({ inicio: d, fim: d, descricao })
const cal = (...datas) => ({ municipio: 'São Paulo', tribunal: 'tjsp', anos: [2026, 2027], fonte: 'teste', consultadoEm: '', completo: true, impedimentos: datas.map(d => feriado(d)) })
let n = 0
const caso = (nome, fn) => { fn(); n++; console.log('ok -', nome) }

caso('DJEN: publicação no 1º dia útil seguinte e contagem a partir do dia útil seguinte à publicação', () => {
  const r = calcularPrazo('2026-11-06', 15, 'dje', cal('2026-11-20'), false)          // disponibilizado numa sexta
  assert.equal(r.linhas.find(l => l.evento === 'Publicação').data, '2026-11-09')        // segunda
  assert.equal(r.termoInicial, '2026-11-10')                                            // terça = dia 1
  assert.equal(r.dataFinal, '2026-12-01')                                               // pula fins de semana e 20/11
})
caso('disponibilização num sábado publica na segunda e conta a partir da terça', () => {
  const r = calcularPrazo('2026-11-07', 5, 'dje', cal(), false)
  assert.equal(r.linhas.find(l => l.evento === 'Publicação').data, '2026-11-09')
  assert.equal(r.termoInicial, '2026-11-10')
  assert.equal(r.dataFinal, '2026-11-16')
})
caso('feriado depois da disponibilização adia a publicação', () => {
  const r = calcularPrazo('2026-11-13', 5, 'dje', cal('2026-11-16'), false)            // sexta; segunda é feriado
  assert.equal(r.linhas.find(l => l.evento === 'Publicação').data, '2026-11-17')
})
caso('suspensão de 20/12 a 20/01 interrompe a contagem (CPC art. 220)', () => {
  const r = calcularPrazo('2026-12-14', 15, 'dje', cal('2026-12-25', '2027-01-01'), true)
  assert.equal(r.dataFinal, '2027-02-05')
})
caso('sem marcar a suspensão, a contagem segue pelo fim do ano', () => {
  const r = calcularPrazo('2026-12-14', 15, 'dje', cal('2026-12-25', '2027-01-01'), false)
  assert.equal(r.dataFinal, '2027-01-07')
})
caso('prazo em dobro vale o mesmo que o dobro de dias', () => {
  const dobro = calcularPrazo('2026-11-06', 15, 'dje', cal('2026-11-20'), false, { emDobro: true })
  const trinta = calcularPrazo('2026-11-06', 30, 'dje', cal('2026-11-20'), false)
  assert.equal(dobro.dataFinal, trinta.dataFinal)
  assert.equal(dobro.diasContados, 30)
  assert.equal(dobro.emDobro, true)
})
caso('dias corridos contam sábados e domingos', () => {
  const r = calcularPrazo('2026-03-04', 10, 'inicio', cal(), false, { contagem: 'corridos' })   // quarta = dia 1
  assert.equal(r.dataFinal, '2026-03-13')                                                       // sexta
  assert.equal(r.prorrogado, false)
})
caso('dias corridos que terminam em sábado vão para a segunda (CPC art. 224, §1º)', () => {
  const r = calcularPrazo('2026-03-04', 11, 'inicio', cal(), false, { contagem: 'corridos' })   // 14/03 é sábado
  assert.equal(r.dataFinal, '2026-03-16')
  assert.equal(r.prorrogado, true)
})
caso('dias corridos que terminam em feriado também são prorrogados', () => {
  const r = calcularPrazo('2026-03-04', 10, 'inicio', cal('2026-03-13'), false, { contagem: 'corridos' })
  assert.equal(r.dataFinal, '2026-03-16')                                                       // sexta feriado, sáb, dom
})
caso('dias corridos também param na suspensão de fim de ano', () => {
  const r = calcularPrazo('2026-12-15', 10, 'inicio', cal(), true, { contagem: 'corridos' })   // 15,16,17,18,19 = 5 dias; retoma 21/01
  assert.equal(r.linhas.at(-1).data >= '2027-01-21', true)
})
caso('suspensão cadastrada no calendário (tipo suspensao) interrompe a contagem em dias úteis', () => {
  const c = { ...cal(), impedimentos: [{ inicio: '2026-11-10', fim: '2026-11-11', descricao: 'Suspensão do expediente', tipo: 'suspensao' }] }
  const r = calcularPrazo('2026-11-06', 3, 'dje', c, false)
  assert.equal(r.termoInicial, '2026-11-12')
  assert.equal(r.dataFinal, '2026-11-16')
})
caso('cruzaRecesso avisa quando a contagem passa por 20/12 a 20/01', () => {
  assert.equal(cruzaRecesso('2026-12-10', '2027-02-01'), true)
  assert.equal(cruzaRecesso('2026-03-01', '2026-04-01'), false)
  assert.equal(cruzaRecesso('2027-01-05', '2027-01-30'), true)
})
caso('sugestão pelo tipo da intimação só quando há um tipo claro', () => {
  assert.equal(sugerirPrazoPadrao('Fica a parte ré intimada para apresentar contestação.')?.id, 'contestacao')
  assert.equal(sugerirPrazoPadrao('Intime-se para oferecer réplica.')?.id, 'replica')
  assert.equal(sugerirPrazoPadrao('Intimem-se para contrarrazões ao recurso.')?.id, 'contrarrazoes')
  assert.equal(sugerirPrazoPadrao('Opostos embargos de declaração, manifeste-se a parte contrária.')?.id, 'embargos_declaracao')
  assert.equal(sugerirPrazoPadrao('Apresente contestação e, depois, réplica.'), null)            // dois tipos: não adivinha
  assert.equal(sugerirPrazoPadrao('Vista dos autos.'), null)
})
caso('prazos-padrão têm dias, base legal e ids únicos', () => {
  assert.equal(new Set(PRAZOS_PADRAO.map(p => p.id)).size, PRAZOS_PADRAO.length)
  for (const p of PRAZOS_PADRAO) assert.ok(p.dias > 0 && p.base && p.rotulo)
  assert.equal(PRAZOS_PADRAO.find(p => p.id === 'contestacao').dias, 15)
  assert.equal(PRAZOS_PADRAO.find(p => p.id === 'embargos_declaracao').dias, 5)
})
caso('entradas inválidas são recusadas', () => {
  assert.throws(() => calcularPrazo('2026-13-40', 15, 'dje', cal(), false))
  assert.throws(() => calcularPrazo('2026-11-06', 0, 'dje', cal(), false))
  assert.throws(() => calcularPrazo('2026-11-06', 15, 'xyz', cal(), false))
})
console.log(`\n${n} casos passaram`)
