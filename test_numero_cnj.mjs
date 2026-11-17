// Testes do número único CNJ (frontend/src/utils/numeroCnj.ts). Roda com: node test_numero_cnj.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const saida = mkdtempSync(join(tmpdir(), 'cnj-'))
execFileSync('frontend/node_modules/.bin/tsc', ['--outDir', saida, '--module', 'esnext', '--target', 'es2022', '--skipLibCheck',
  'frontend/src/utils/numeroCnj.ts'], { stdio: 'inherit' })
const { analisarNumeroCnj, digitoVerificadorCnj, formatarCnj } = await import(pathToFileURL(join(saida, 'numeroCnj.js')).href)

let n = 0
const caso = (nome, fn) => { fn(); n++; console.log('ok -', nome) }

caso('número válido: dígito verificador, tribunal e justiça', () => {
  const a = analisarNumeroCnj('1006314-27.2023.8.26.0005', 2026)
  assert.equal(a.valido, true)
  assert.equal(a.sigla, 'tjsp')
  assert.equal(a.justica, 'Justiça dos Estados e do DF')
  assert.equal(a.formatado, '1006314-27.2023.8.26.0005')
  assert.equal(a.digitos, '10063142720238260005')
  assert.equal(a.ano, 2023)
})
caso('aceita só dígitos, com espaços nas pontas', () => {
  assert.equal(analisarNumeroCnj('  10063142720238260005 ', 2026).valido, true)
})
caso('dígito verificador errado é recusado e informa o esperado', () => {
  const a = analisarNumeroCnj('1006314-28.2023.8.26.0005', 2026)
  assert.equal(a.valido, false)
  assert.match(a.motivo, /Dígito verificador inválido.*27/)
  assert.equal(a.sigla, 'tjsp')                        // ainda identifica o tribunal
})
caso('um dígito trocado em qualquer posição quebra a validação', () => {
  const certo = '10063142720238260005'
  for (let i = 0; i < 20; i++) {
    if (i === 7 || i === 8) continue
    const errado = certo.slice(0, i) + String((Number(certo[i]) + 1) % 10) + certo.slice(i + 1)
    assert.equal(analisarNumeroCnj(errado, 2026).valido, false, `posição ${i}`)
  }
})
caso('tamanho e caracteres inválidos', () => {
  assert.match(analisarNumeroCnj('123', 2026).motivo, /20 dígitos \(informados: 3\)/)
  assert.match(analisarNumeroCnj('1006314-27.2023.8.26.000X', 2026).motivo, /só números/)
  assert.equal(analisarNumeroCnj('', 2026).valido, false)
})
caso('dígito verificador calculado confere com o de números reais de outros tribunais', () => {
  // gera o DV de números montados e confere que a análise os aceita
  const monta = (seq, ano, jtr, org) => {
    const semDv = seq + '00' + ano + jtr + org
    const dv = digitoVerificadorCnj(semDv)
    return seq + dv + ano + jtr + org
  }
  const casos = [['0000001', '2024', '404', '7100', 'trf4'], ['0001234', '2020', '502', '0001', 'trt2'], ['0009999', '2025', '813', '0024', 'tjmg'], ['0000010', '2019', '100', '0000', 'stf']]
  for (const [seq, ano, jtr, org, sigla] of casos) {
    const a = analisarNumeroCnj(monta(seq, ano, jtr, org), 2026)
    assert.equal(a.valido, true, sigla); assert.equal(a.sigla, sigla)
  }
})
caso('código de tribunal desconhecido e ano improvável são recusados', () => {
  const monta = (seq, ano, jtr, org) => seq + digitoVerificadorCnj(seq + '00' + ano + jtr + org) + ano + jtr + org
  assert.match(analisarNumeroCnj(monta('0000001', '2024', '899', '0000'), 2026).motivo, /Código de tribunal desconhecido/)
  assert.match(analisarNumeroCnj(monta('0000001', '2031', '826', '0000'), 2026).motivo, /Ano de ajuizamento improvável/)
})
caso('formatarCnj só formata 20 dígitos', () => {
  assert.equal(formatarCnj('10063142720238260005'), '1006314-27.2023.8.26.0005')
  assert.equal(formatarCnj('123'), '123')
})
console.log(`\n${n} casos passaram`)
