import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularKpis, calcularTotais, contarPorSituacao, doPeriodo, filtrarLancamentos, idsReembolsados,
  mesSomado, partesDescricao, relativo, responsaveisDe, rotuloMes, situacaoDe,
} from '../src/routes/financeiro/lancamentos.ts'

const HOJE = '2026-11-17'
const L = (extra) => ({ id: 'x', descricao: 'Honorários', direcao: 'RECEITA', pago: false, vencimento: '2026-11-20', valor: 100, ...extra })

test('situação: quitado, vencido e aberto', () => {
  assert.equal(situacaoDe(L({ pago: true }), HOJE), 'quitado')
  assert.equal(situacaoDe(L({ vencimento: '2026-11-16' }), HOJE), 'vencido')
  assert.equal(situacaoDe(L({ vencimento: '2026-11-17' }), HOJE), 'aberto')
  assert.equal(situacaoDe(L({ vencimento: undefined }), HOJE), 'aberto')
})

test('texto relativo ao vencimento', () => {
  assert.equal(relativo(L({ vencimento: '2026-11-17' }), HOJE), 'vence hoje')
  assert.equal(relativo(L({ vencimento: '2026-11-18' }), HOJE), 'vence amanhã')
  assert.equal(relativo(L({ vencimento: '2026-11-16' }), HOJE), 'venceu ontem')
  assert.equal(relativo(L({ vencimento: '2026-11-10' }), HOJE), 'vencido há 7 dias')
  assert.equal(relativo(L({ pago: true, pago_em: '2026-11-15' }), HOJE), 'recebido em 15/11/2026')
  assert.equal(relativo(L({ direcao: 'DESPESA', pago: true, pago_em: '2026-11-15' }), HOJE), 'pago em 15/11/2026')
  assert.equal(relativo(L({ vencimento: undefined }), HOJE), '')
})

test('meses: soma, virada de ano e rótulo', () => {
  assert.equal(mesSomado('2026-12', 1), '2027-01')
  assert.equal(mesSomado('2026-01', -1), '2025-12')
  assert.equal(rotuloMes('2026-03'), 'Março de 2026')
})

test('descrição separa o sufixo de parcela', () => {
  assert.deepEqual(partesDescricao('Honorários (parcela 2/6)'), { texto: 'Honorários', parcela: '2/6' })
  assert.deepEqual(partesDescricao('Custas'), { texto: 'Custas', parcela: '' })
})

test('período: mês escolhido mais vencidos em aberto de meses anteriores', () => {
  const lista = [
    L({ id: 'a', vencimento: '2026-11-05' }),
    L({ id: 'b', vencimento: '2026-10-05' }),                // vencido de mês anterior
    L({ id: 'c', vencimento: '2026-10-06', pago: true }),    // quitado: fora
    L({ id: 'd', vencimento: '2026-12-01' }),                // mês futuro: fora
  ]
  assert.deepEqual(doPeriodo(lista, '2026-11', false, HOJE).map(l => l.id), ['a', 'b'])
  assert.equal(doPeriodo(lista, '2026-11', true, HOJE).length, 4)
  // olhando um mês futuro, vencidos antigos não entram
  assert.deepEqual(doPeriodo(lista, '2026-12', false, HOJE).map(l => l.id), ['d'])
})

test('filtros por sentido, tipo, cliente, responsável e busca (sem acento de caixa)', () => {
  const rotulos = { cliente: id => (id === 'c1' ? 'Maria Silva' : ''), caso: () => 'Ação de cobrança' }
  const lista = [
    L({ id: 'a', cliente_id: 'c1' }),
    L({ id: 'b', direcao: 'DESPESA', tipo: 'CUSTAS', responsavel: 'ana' }),
  ]
  const base = { direcao: '', tipo: '', cliente: '', responsavel: '', busca: '' }
  assert.equal(filtrarLancamentos(lista, base, rotulos).length, 2)
  assert.deepEqual(filtrarLancamentos(lista, { ...base, direcao: 'DESPESA' }, rotulos).map(l => l.id), ['b'])
  assert.deepEqual(filtrarLancamentos(lista, { ...base, tipo: 'HONORARIO' }, rotulos).map(l => l.id), ['a']) // tipo ausente = honorário
  assert.deepEqual(filtrarLancamentos(lista, { ...base, responsavel: 'ana' }, rotulos).map(l => l.id), ['b'])
  assert.deepEqual(filtrarLancamentos(lista, { ...base, busca: ' MARIA ' }, rotulos).map(l => l.id), ['a'])
})

test('contagem, KPIs e totais', () => {
  const lista = [
    L({ id: 'a', vencimento: '2026-11-20', valor: 100 }),                      // receber em aberto
    L({ id: 'b', vencimento: '2026-11-01', valor: 50 }),                       // vencido
    L({ id: 'c', pago: true, vencimento: '2026-11-03', valor: 70 }),           // recebido
    L({ id: 'd', direcao: 'DESPESA', vencimento: '2026-11-25', valor: 30 }),   // a pagar
  ]
  assert.deepEqual(contarPorSituacao(lista, HOJE), { aberto: 2, vencido: 1, quitado: 1 })
  const k = calcularKpis(lista, '2026-11', false, HOJE)
  assert.deepEqual([k.receber, k.pagar, k.vencidos, k.recebido].map(x => x.map(l => l.id)), [['a'], ['d'], ['b'], ['c']])
  assert.deepEqual(calcularTotais(lista), { receitas: 220, despesas: 30, saldo: 190 })
})

test('reembolsados e responsáveis', () => {
  const lista = [L({ id: 'r', origem_id: 'd1' }), L({ id: 's', direcao: 'DESPESA', origem_id: 'zz' }), L({ responsavel: 'bia' }), L({ responsavel: 'ana' }), L({ responsavel: 'ana' })]
  assert.deepEqual([...idsReembolsados(lista)], ['d1'])
  assert.deepEqual(responsaveisDe(lista), ['ana', 'bia'])
})
