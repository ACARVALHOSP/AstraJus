import assert from 'node:assert/strict'
import test from 'node:test'
import { FILTROS_VAZIOS, juntarPaginas, montarArgsBusca } from '../src/routes/processo/buscaProcessos.ts'

const f = (p = {}) => ({ ...FILTROS_VAZIOS, tribunal: 'TJSP', ...p })

test('exige tribunal e ao menos um filtro', () => {
  assert.match(montarArgsBusca({ ...FILTROS_VAZIOS, classe: '7' }).erro, /tribunal/i)
  assert.match(montarArgsBusca(f()).erro, /ao menos um filtro/)
})

test('monta os argumentos com códigos numéricos, datas, grau e tamanho', () => {
  const { args } = montarArgsBusca(f({ classe: ' 7 ', orgao: '42', assunto: '1', inicio: '2026-01-01', fim: '2026-01-31', grau: 'g1' }))
  assert.deepEqual(args, {
    tribunal: 'tjsp', tamanho: 20, classe_codigo: 7, orgao_julgador_codigo: 42, assunto_codigo: 1,
    ajuizamento_inicio: '2026-01-01', ajuizamento_fim: '2026-01-31', grau: 'G1',
  })
})

test('só o período já basta como filtro', () => {
  assert.ok(montarArgsBusca(f({ inicio: '2026-01-01' })).args)
})

test('recusa código não numérico ou zero e período invertido', () => {
  assert.match(montarArgsBusca(f({ classe: 'abc' })).erro, /Classe/)
  assert.match(montarArgsBusca(f({ orgao: '0' })).erro, /Órgão julgador/)
  assert.match(montarArgsBusca(f({ assunto: '1.5' })).erro, /Assunto/)
  assert.match(montarArgsBusca(f({ classe: '7', inicio: '2026-02-01', fim: '2026-01-01' })).erro, /data inicial/)
})

test('o cursor da página anterior vai em search_after', () => {
  assert.deepEqual(montarArgsBusca(f({ classe: '7' }), [100, 2]).args.search_after, [100, 2])
  assert.equal('search_after' in montarArgsBusca(f({ classe: '7' }), null).args, false)
  assert.equal('search_after' in montarArgsBusca(f({ classe: '7' }), []).args, false)
})

test('juntar páginas não repete número e grau', () => {
  const a = [{ numeroProcesso: '1', grau: 'G1' }, { numeroProcesso: '2', grau: 'G1' }]
  const b = [{ numeroProcesso: '2', grau: 'G1' }, { numeroProcesso: '2', grau: 'G2' }, { numeroProcesso: '3', grau: 'G1' }]
  assert.deepEqual(juntarPaginas(a, b).map(p => `${p.numeroProcesso}${p.grau}`), ['1G1', '2G1', '2G2', '3G1'])
})

import { rotuloItemTpu } from '../src/routes/processo/buscaProcessos.ts'

test('rótulo da opção da TPU mostra o código e só os dois últimos níveis da hierarquia', () => {
  assert.equal(rotuloItemTpu({ codigo: 7, nome: 'Procedimento Comum Cível', caminho: 'PROCESSO CÍVEL > Processo de Conhecimento > Procedimento de Conhecimento' }),
    '7 · Processo de Conhecimento › Procedimento de Conhecimento')
  assert.equal(rotuloItemTpu({ codigo: 2, nome: 'Raiz' }), '2')
  assert.equal(rotuloItemTpu({ codigo: 3, nome: 'Item', caminho: 'Só um' }), '3 · Só um')
})
