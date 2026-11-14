// Jurimetria na ficha do processo (fase 3): tempo aproximado até a sentença e estimativa de exposição.
// Puro (sem React). Duas ressalvas valem para tudo aqui e a tela as repete:
// - o CJPG só traz sentenças já publicadas: processos ainda sem sentença não entram, então os tempos tendem a ser curtos;
// - o CJPG não informa a data de distribuição: só o ano, no número CNJ. O tempo tem margem de cerca de 6 meses.
import { quantil } from '../../modulos/jurimetria/estatisticas.ts'
import { formatarPercentual, formatarReais } from '../../utils/formatadores.ts'

export const MARGEM_MESES = 6
/** Abaixo disto a amostra de tempos é pouco confiável (mesmo limite das taxas). */
export const AMOSTRA_MINIMA_TEMPO = 30
const MESES_MAX = 240 // 20 anos: acima disso o número ou a data estão errados
const DIAS_MES = 30.4375

export type ItemTempo = { numero_processo?: string; data_disponibilizacao?: string; desfecho?: string }

const meioDia = (a: number, m: number, d: number) => new Date(a, m, d, 12)

/** Ano de distribuição (AAAA) do número CNJ; null se não tiver 20 dígitos ou o ano for absurdo. */
export function anoDoNumero(numero?: string): number | null {
  const d = (numero ?? '').replace(/\D/g, '')
  if (d.length !== 20) return null
  const ano = Number(d.slice(9, 13))
  return ano >= 1990 && ano <= 2100 ? ano : null
}

/** "dd/mm/aaaa" -> Date (meio-dia local, para não virar o dia por fuso); null se inválida. */
export function dataDdMmAaaa(v?: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim())
  if (!m) return null
  const d = meioDia(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

/** Data da capa ("AAAAMMDD[hhmmss]" ou ISO) -> Date; null se inválida. */
export function dataDaCapa(v?: string | null): Date | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec((v ?? '').trim())
  if (!m) return null
  const d = meioDia(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

export const mesesEntre = (de: Date, ate: Date) => (ate.getTime() - de.getTime()) / 86_400_000 / DIAS_MES

/** Meio do ano de distribuição, limitado à data de referência (não se distribui depois da sentença). */
function distribuicaoEstimada(ano: number, ate: Date): Date | null {
  const inicio = meioDia(ano, 0, 1)
  if (ate < inicio) return null
  const fim = ate < meioDia(ano, 11, 31) ? ate : meioDia(ano, 11, 31)
  return new Date((inicio.getTime() + fim.getTime()) / 2)
}

/** Idade do processo na publicação da sentença, em meses (estimativa: distribuição no meio do ano do número). */
export function idadeNaSentenca(item: ItemTempo): number | null {
  const ano = anoDoNumero(item.numero_processo)
  const sentenca = dataDdMmAaaa(item.data_disponibilizacao)
  if (ano === null || !sentenca) return null
  const dist = distribuicaoEstimada(ano, sentenca)
  if (!dist) return null
  const meses = mesesEntre(dist, sentenca)
  return meses >= 0 && meses <= MESES_MAX ? meses : null
}

export type ResumoTempo = { n: number; mediana: number; p25: number; p75: number; margem: number; descartados: number; amostraPequena: boolean; idades: number[] }

/** Tempo até a sentença das decisões com desfecho identificado (as sem desfecho, como cumprimentos, não medem o processo). */
export function resumirTempo(itens: ItemTempo[]): ResumoTempo | null {
  const classificados = itens.filter(i => i.desfecho)
  const idades = classificados.map(idadeNaSentenca).filter((m): m is number => m !== null).sort((a, b) => a - b)
  if (idades.length === 0) return null
  return {
    n: idades.length, mediana: quantil(idades, 0.5), p25: quantil(idades, 0.25), p75: quantil(idades, 0.75),
    margem: MARGEM_MESES, descartados: classificados.length - idades.length, amostraPequena: idades.length < AMOSTRA_MINIMA_TEMPO, idades,
  }
}

export type IdadeProcesso = { meses: number; exata: boolean }
/** Idade atual do processo: exata se a capa tem a data de distribuição; senão estimada pelo ano do número. */
export function idadeDoProcesso(dataDistribuicao: string | null | undefined, numero: string, hoje: Date): IdadeProcesso | null {
  const exata = dataDaCapa(dataDistribuicao)
  if (exata && exata <= hoje) return { meses: mesesEntre(exata, hoje), exata: true }
  const ano = anoDoNumero(numero)
  const dist = ano === null ? null : distribuicaoEstimada(ano, hoje)
  return dist ? { meses: mesesEntre(dist, hoje), exata: false } : null
}

const arred = (m: number) => Math.max(1, Math.round(m))
const rotuloMeses = (m: number) => `${arred(m)} ${arred(m) === 1 ? 'mês' : 'meses'}`

/** Frases sobre o tempo: a mediana com a faixa e, havendo a idade do processo, onde ele está em relação à amostra. */
export function textoTempo(r: ResumoTempo, idade: IdadeProcesso | null): string[] {
  const linhas = [
    `Tempo até a sentença (aproximado): mediana de ${rotuloMeses(r.mediana)}, e a faixa de 25% a 75% vai de ${arred(r.p25)} a ${arred(r.p75)} meses, `
    + `em ${r.n} sentenças. O CJPG só informa o ano da distribuição, então cada tempo tem margem de cerca de ${r.margem} meses.`,
  ]
  if (idade) {
    const jaSaidas = r.idades.filter(m => m <= idade.meses).length / r.n
    const restante = r.mediana - idade.meses
    linhas.push(
      `Este processo tem ${idade.exata ? '' : 'cerca de '}${rotuloMeses(idade.meses)}${idade.exata ? '' : ' (estimado pelo ano do número)'}. `
      + (idade.meses > r.p75
        ? 'Já passou do tempo em que 3 de cada 4 sentenças da amostra saíram.'
        : `${formatarPercentual(jaSaidas)} das sentenças da amostra já haviam saído com esse tempo`
          + (restante > 0 ? `; pela mediana, faltariam cerca de ${rotuloMeses(restante)}.` : '; ele já passou do tempo mediano.')),
    )
  }
  linhas.push('A amostra só tem processos que já tiveram sentença publicada; os que seguem sem sentença não entram, e por isso o tempo real tende a ser maior.')
  if (r.amostraPequena) linhas.unshift(`Amostra pequena (${r.n} tempos; o mínimo confiável é ${AMOSTRA_MINIMA_TEMPO}): use como indício.`)
  return linhas
}

// ---- Exposição / provisão ---------------------------------------------------------------------------

/** Referência comum de mercado para classificar a chance de perda; não é critério legal nem contábil. */
export const LIMITES_RISCO = { provavel: 0.7, possivel: 0.3 }
export type NivelRisco = 'provavel' | 'possivel' | 'remota'
export const classificarRisco = (chance: number): NivelRisco => (chance >= LIMITES_RISCO.provavel ? 'provavel' : chance >= LIMITES_RISCO.possivel ? 'possivel' : 'remota')
export const ROTULO_RISCO: Record<NivelRisco, string> = { provavel: 'provável', possivel: 'possível', remota: 'remota' }

export type PremissasProvisao = {
  valorBase: number                 // valor que seria pago/recebido se o pedido fosse totalmente acolhido
  chance: number                    // chance de alguma procedência (0 a 1)
  intervalo: [number, number] | null // intervalo de 95% dessa chance
  procedentes: number               // quantas sentenças da amostra foram procedentes
  parciais: number                  // e parcialmente procedentes
  fatorParcial: number              // quanto do valor se paga numa procedência parcial (0 a 1)
}
export type Provisao = { esperado: number; minimo: number | null; maximo: number | null; fatorMedio: number }

/** Valor esperado = valor × chance de alguma procedência × fator médio (procedente vale 100%; parcial, o fator escolhido).
 *  Equivale a valor × (taxa de procedente + fator × taxa de parcial). Acordos e extinções contam como zero. */
export function calcularProvisao(p: PremissasProvisao): Provisao {
  const acolhidas = p.procedentes + p.parciais
  const fatorMedio = acolhidas > 0 ? (p.procedentes + p.fatorParcial * p.parciais) / acolhidas : 0
  const sobre = (chance: number) => p.valorBase * chance * fatorMedio
  return {
    esperado: sobre(p.chance), fatorMedio,
    minimo: p.intervalo ? sobre(p.intervalo[0]) : null, maximo: p.intervalo ? sobre(p.intervalo[1]) : null,
  }
}

/** Lê um valor digitado em reais. Com vírgula, ela é o decimal e o ponto é milhar ("1.500,50"); sem vírgula, ponto seguido de
 *  exatamente 3 dígitos é milhar ("12.000", "1.500.000") e qualquer outro ponto é decimal ("1500.5"). Null se vazio ou inválido. */
export function lerReais(texto: string): number | null {
  const t = texto.trim().replace(/[R$\s]/g, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
  const v = Number(normal)
  return Number.isFinite(v) && v >= 0 ? v : null
}

export function textoProvisao(r: Provisao, p: PremissasProvisao, perspectiva: 'reu' | 'autor'): string {
  const faixa = r.minimo !== null && r.maximo !== null ? ` (faixa pelo intervalo de 95% da chance: ${formatarReais(r.minimo)} a ${formatarReais(r.maximo)})` : ''
  const o = perspectiva === 'reu' ? 'Exposição esperada' : 'Expectativa de recebimento'
  return `${o}: ${formatarReais(r.esperado)}${faixa}. Conta: ${formatarReais(p.valorBase)} × ${formatarPercentual(p.chance)} de chance de alguma procedência × ${formatarPercentual(r.fatorMedio)} do valor em média (procedente 100%, parcial ${formatarPercentual(p.fatorParcial)}).`
}
