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
