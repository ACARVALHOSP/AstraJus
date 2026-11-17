import assert from 'node:assert/strict'
import test from 'node:test'
import {
  descreverAlteracao, erroDoParametro, nomeDoAutor, quandoBrasilia, seloRotina,
} from '../src/routes/administracao/automacoes.ts'

const exec = (estado, extra = {}) => ({ inicio: '2026-11-17T22:30:00+00:00', fim: null, estado, erro: null, ...extra })

test('selo da rotina: desligada, sem execução, em dia, falha, interrompida e executando', () => {
  assert.deepEqual(seloRotina({ ativo: false, ultima_execucao: exec('concluida') }), { texto: 'Desligada', cor: 'gray' })
  assert.deepEqual(seloRotina({ ativo: true, ultima_execucao: null }), { texto: 'Ainda não executou', cor: 'gray' })
  assert.deepEqual(seloRotina({ ativo: true, ultima_execucao: exec('concluida') }), { texto: 'Em dia', cor: 'green' })
  assert.deepEqual(seloRotina({ ativo: true, ultima_execucao: exec('falha') }), { texto: 'Falhou na última execução', cor: 'red' })
  assert.equal(seloRotina({ ativo: true, ultima_execucao: exec('interrompida') }).cor, 'amber')
  assert.equal(seloRotina({ ativo: true, ultima_execucao: exec('executando') }).texto, 'Executando')
})

test('data e hora no horário de Brasília', () => {
  assert.equal(quandoBrasilia('2026-11-17T22:30:00+00:00'), '17/11/2026 19:30')
  assert.equal(quandoBrasilia('2026-11-18T02:05:00+00:00'), '17/11/2026 23:05') // vira o dia em UTC, não em Brasília
  assert.equal(quandoBrasilia(null), '—')
  assert.equal(quandoBrasilia('lixo'), '—')
})

test('autor da alteração', () => {
  assert.equal(nomeDoAutor('usuario:ana'), 'ana')
  assert.equal(nomeDoAutor('bootstrap'), 'Token administrativo')
})

test('descrição da alteração: ligar, desligar e parâmetros', () => {
  const nomes = { alertas_prazo: 'Alertas de prazos' }
  const base = { ocorrido_em: '2026-11-17T22:30:00+00:00', ator: 'usuario:ana', chave: 'alertas_prazo' }
  const est = (ativo, n = 60) => ({ ativo, parametros: { dias: n } })
  assert.equal(descreverAlteracao({ ...base, antes: est(true), depois: est(false) }, nomes), 'ana desligou "Alertas de prazos"')
  assert.equal(descreverAlteracao({ ...base, antes: est(false), depois: est(true) }, nomes), 'ana ligou "Alertas de prazos"')
  assert.equal(descreverAlteracao({ ...base, antes: est(true, 60), depois: est(true, 90) }, nomes), 'ana alterou os parâmetros de "Alertas de prazos"')
  assert.equal(descreverAlteracao({ ...base, chave: 'outra', antes: est(true), depois: est(false) }, nomes), 'ana desligou "outra"')
})

test('validação do parâmetro numérico', () => {
  const def = { tipo: 'int', rotulo: 'Dias sem movimentação', minimo: 15, maximo: 365, padrao: 60 }
  assert.equal(erroDoParametro(def, '60'), '')
  assert.equal(erroDoParametro(def, ' 15 '), '')
  assert.equal(erroDoParametro(def, '365'), '')
  assert.match(erroDoParametro(def, '14'), /entre 15 e 365/)
  assert.match(erroDoParametro(def, '366'), /entre 15 e 365/)
  assert.match(erroDoParametro(def, '6,5'), /número inteiro/)
  assert.match(erroDoParametro(def, ''), /número inteiro/)
  assert.match(erroDoParametro(def, 'abc'), /número inteiro/)
})

test('lista de dias: texto, validação e ordem', async () => {
  const { lerParametro, textoDoValor } = await import('../src/routes/administracao/automacoes.ts')
  const def = { tipo: 'lista_int', rotulo: 'Faixas', minimo: 0, maximo: 30, min_itens: 1, max_itens: 6, padrao: [5, 2, 1, 0] }
  assert.equal(textoDoValor([15, 5, 1, 0]), '15, 5, 1, 0')
  assert.equal(textoDoValor(60), '60')
  assert.deepEqual(lerParametro(def, '5, 2, 1, 0'), { valor: [5, 2, 1, 0], erro: '' })
  assert.deepEqual(lerParametro(def, '0 1 15;5').valor, [15, 5, 1, 0])        // separadores livres, sai do maior para o menor
  assert.match(lerParametro(def, '').erro, /de 1 a 6 valores/)
  assert.match(lerParametro(def, '1,2,3,4,5,6,7').erro, /de 1 a 6 valores/)
  assert.match(lerParametro(def, '5, 5').erro, /repetidos/)
  assert.match(lerParametro(def, '31').erro, /entre 0 e 30/)
  assert.match(lerParametro(def, '-1').erro, /inteiros/)
  assert.match(lerParametro(def, '5, abc').erro, /inteiros/)
  assert.equal(lerParametro(def, '1,5').erro, '')
})

test('parâmetro numérico continua igual', async () => {
  const { lerParametro } = await import('../src/routes/administracao/automacoes.ts')
  const def = { tipo: 'int', rotulo: 'Dias', minimo: 15, maximo: 365, padrao: 60 }
  assert.deepEqual(lerParametro(def, ' 90 '), { valor: 90, erro: '' })
  assert.match(lerParametro(def, '14').erro, /entre 15 e 365/)
})
