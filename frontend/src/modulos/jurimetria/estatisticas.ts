// Cálculos da Jurimetria feitos no navegador sobre as sentenças já buscadas. Servem aos gráficos e
// ao recálculo quando a pessoa desconsidera sentenças. Seguem o mesmo método do backend
// (modulos/jurimetria/servico.py): mediana, quartis "inclusivos", outliers de Tukey (1,5 x IQR) e
// intervalo de Wilson a 95%.

export type Desfecho = 'procedente' | 'parcial' | 'improcedente' | 'acordo' | 'extinto'
export const DESFECHOS: Desfecho[] = ['procedente', 'parcial', 'improcedente', 'acordo', 'extinto']

export type ItemEstat = {
  desfecho?: string
  valor_condenacao?: number | null
  data_disponibilizacao?: string
}

export function quantil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return NaN
  const pos = (ordenados.length - 1) * p
  const base = Math.floor(pos)
  const resto = pos - base
  return ordenados[base] + (base + 1 < ordenados.length ? resto * (ordenados[base + 1] - ordenados[base]) : 0)
}

export type ResumoValores = { n: number; mediana: number; p25: number; p75: number; min: number; max: number; limiteInf: number; limiteSup: number }

export function resumirValores(valores: number[]): ResumoValores | null {
  if (valores.length === 0) return null
  const o = [...valores].sort((a, b) => a - b)
  const p25 = quantil(o, 0.25)
  const p75 = quantil(o, 0.75)
  const iqr = p75 - p25
  return { n: o.length, mediana: quantil(o, 0.5), p25, p75, min: o[0], max: o[o.length - 1], limiteInf: p25 - 1.5 * iqr, limiteSup: p75 + 1.5 * iqr }
}

export function ehAtipico(valor: number, resumo: ResumoValores | null): boolean {
  return !!resumo && resumo.n >= 4 && (valor > resumo.limiteSup || valor < resumo.limiteInf)
}

export function intervaloWilson(sucessos: number, total: number, z = 1.96): [number, number] | null {
  if (total <= 0) return null
  const p = sucessos / total
  const denom = 1 + (z * z) / total
  const centro = (p + (z * z) / (2 * total)) / denom
  const margem = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom
  return [Math.max(0, centro - margem), Math.min(1, centro + margem)]
}

export function contarDesfechos(itens: ItemEstat[]): { contagens: Record<Desfecho, number>; classificados: number; naoClassificados: number } {
  const contagens = { procedente: 0, parcial: 0, improcedente: 0, acordo: 0, extinto: 0 } as Record<Desfecho, number>
  let classificados = 0
  for (const item of itens) {
    if (item.desfecho && item.desfecho in contagens) {
      contagens[item.desfecho as Desfecho] += 1
      classificados += 1
    }
  }
  return { contagens, classificados, naoClassificados: itens.length - classificados }
}

/** Valores de condenação das sentenças procedentes ou parciais (as únicas que têm condenação). */
export function valoresDeCondenacao(itens: ItemEstat[]): number[] {
  return itens
    .filter(i => (i.desfecho === 'procedente' || i.desfecho === 'parcial') && i.valor_condenacao != null)
    .map(i => i.valor_condenacao as number)
}

/** "dd/mm/aaaa" -> "aaaa-mm" (ou null se não for uma data nesse formato). */
export function mesDe(data?: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((data ?? '').trim())
  return m ? `${m[3]}-${m[2]}` : null
}

export function chaveParaData(data?: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((data ?? '').trim())
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0
}

export type PontoMensal = { mes: string; contagens: Record<Desfecho, number>; total: number }

export function serieMensal(itens: ItemEstat[]): PontoMensal[] {
  const porMes = new Map<string, PontoMensal>()
  for (const item of itens) {
    const mes = mesDe(item.data_disponibilizacao)
    if (!mes || !item.desfecho || !DESFECHOS.includes(item.desfecho as Desfecho)) continue
    const ponto = porMes.get(mes) ?? { mes, contagens: { procedente: 0, parcial: 0, improcedente: 0, acordo: 0, extinto: 0 }, total: 0 }
    ponto.contagens[item.desfecho as Desfecho] += 1
    ponto.total += 1
    porMes.set(mes, ponto)
  }
  return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes))
}

export type FaixaHistograma = { de: number; ate: number; quantidade: number }

export function histograma(valores: number[], faixas = 8): FaixaHistograma[] {
  if (valores.length < 2) return []
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  if (min === max) return []
  const largura = (max - min) / faixas
  const saida: FaixaHistograma[] = Array.from({ length: faixas }, (_, i) => ({ de: min + i * largura, ate: min + (i + 1) * largura, quantidade: 0 }))
  for (const v of valores) saida[Math.min(faixas - 1, Math.floor((v - min) / largura))].quantidade += 1
  return saida
}
