// Regras puras da tela de Lançamentos (sem React): situação, filtros, KPIs e totais.
// Ficam fora do componente para serem testadas em tests/lancamentos.test.mjs.
import { dataCurta, diasEntreDatas } from '../../utils/formatadores.ts'
import type { TipoLancamento } from './NovoLancamentoModal'

export type Lancamento = {
  id: string
  vencimento?: string
  valor?: number
  descricao: string
  recorrente?: boolean
  cliente_id?: string
  caso_id?: string | null
  contrato_id?: string | null
  responsavel?: string
  direcao: 'DESPESA' | 'RECEITA'
  pago: boolean
  asaas_cobranca_id?: string
  tipo?: TipoLancamento
  pago_em?: string | null
  parcela_numero?: number | null
  parcela_total?: number | null
  reembolsavel?: boolean
  favorecido?: string | null
  origem_id?: string | null
}
export type Situacao = 'aberto' | 'vencido' | 'quitado'
export type Direcao = '' | 'RECEITA' | 'DESPESA'

export const ORDEM_SITUACAO: Record<Situacao, number> = { vencido: 0, aberto: 1, quitado: 2 }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const RE_PARCELA = /\s*\(parcela (\d+)\/(\d+)\)\s*$/i

export function mesSomado(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function rotuloMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const nome = MESES[m - 1]
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${y}`
}

export function situacaoDe(l: Lancamento, hoje: string): Situacao {
  if (l.pago) return 'quitado'
  return l.vencimento && l.vencimento.slice(0, 10) < hoje ? 'vencido' : 'aberto'
}

export function relativo(l: Lancamento, hoje: string): string {
  if (!l.vencimento) return ''
  const dias = diasEntreDatas(hoje, l.vencimento.slice(0, 10))
  if (l.pago && l.pago_em) return `${l.direcao === 'RECEITA' ? 'recebido' : 'pago'} em ${dataCurta(l.pago_em)}`
  if (l.pago) return dias === -1 ? 'ontem' : dias < 0 ? `há ${-dias} dias` : dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`
  if (dias < -1) return `vencido há ${-dias} dias`
  if (dias === -1) return 'venceu ontem'
  if (dias === 0) return 'vence hoje'
  if (dias === 1) return 'vence amanhã'
  return `vence em ${dias} dias`
}

export function partesDescricao(descricao: string): { texto: string; parcela: string } {
  const m = RE_PARCELA.exec(descricao)
  return m ? { texto: descricao.replace(RE_PARCELA, ''), parcela: `${m[1]}/${m[2]}` } : { texto: descricao, parcela: '' }
}

/** Mês escolhido + vencidos em aberto de meses anteriores, que continuam pendentes. */
export function doPeriodo(lancamentos: Lancamento[], mes: string, todosMeses: boolean, hoje: string): Lancamento[] {
  return lancamentos.filter(l => {
    if (todosMeses) return true
    const venc = (l.vencimento ?? '').slice(0, 7)
    return venc === mes || (!l.pago && venc < mes && mes <= hoje.slice(0, 7))
  })
}

export type FiltrosLancamento = {
  direcao: Direcao
  tipo: string
  cliente: string
  responsavel: string
  busca: string
}

/** `rotulos` devolve nome do cliente e título do processo, usados só na busca por texto. */
export function filtrarLancamentos(
  lista: Lancamento[],
  f: FiltrosLancamento,
  rotulos: { cliente: (id?: string | null) => string; caso: (id?: string | null) => string },
): Lancamento[] {
  const termo = f.busca.trim().toLocaleLowerCase('pt-BR')
  return lista.filter(l =>
    (!f.direcao || l.direcao === f.direcao) &&
    (!f.tipo || (l.tipo ?? 'HONORARIO') === f.tipo) &&
    (!f.cliente || l.cliente_id === f.cliente) &&
    (!f.responsavel || l.responsavel === f.responsavel) &&
    (!termo || `${l.descricao} ${rotulos.cliente(l.cliente_id)} ${rotulos.caso(l.caso_id)}`.toLocaleLowerCase('pt-BR').includes(termo)))
}

export function contarPorSituacao(lista: Lancamento[], hoje: string): Record<Situacao, number> {
  const c: Record<Situacao, number> = { aberto: 0, vencido: 0, quitado: 0 }
  for (const l of lista) c[situacaoDe(l, hoje)]++
  return c
}

export function somar(lista: Lancamento[]): number {
  return lista.reduce((t, l) => t + (l.valor ?? 0), 0)
}

export function calcularKpis(lista: Lancamento[], mes: string, todosMeses: boolean, hoje: string) {
  const noMes = (l: Lancamento) => todosMeses || (l.vencimento ?? '').slice(0, 7) === mes
  return {
    receber: lista.filter(l => l.direcao === 'RECEITA' && situacaoDe(l, hoje) === 'aberto' && noMes(l)),
    pagar: lista.filter(l => l.direcao === 'DESPESA' && !l.pago && noMes(l)),
    vencidos: lista.filter(l => l.direcao === 'RECEITA' && situacaoDe(l, hoje) === 'vencido'),
    recebido: lista.filter(l => l.direcao === 'RECEITA' && l.pago && noMes(l)),
  }
}

export function calcularTotais(lista: Lancamento[]) {
  const receitas = somar(lista.filter(l => l.direcao === 'RECEITA'))
  const despesas = somar(lista.filter(l => l.direcao === 'DESPESA'))
  return { receitas, despesas, saldo: receitas - despesas }
}

/** Ids dos lançamentos de despesa que já viraram uma receita de reembolso. */
export function idsReembolsados(lancamentos: Lancamento[]): Set<string> {
  return new Set(lancamentos.filter(l => l.direcao === 'RECEITA' && l.origem_id).map(l => l.origem_id as string))
}

export function responsaveisDe(lancamentos: Lancamento[]): string[] {
  return [...new Set(lancamentos.map(l => l.responsavel).filter((r): r is string => Boolean(r)))].sort()
}
