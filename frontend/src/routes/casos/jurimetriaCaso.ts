// Jurimetria na ficha do processo: o que sai da capa, as consultas ao CJPG e o texto dos cartões.
// Puro (sem React): a tela só desenha o que estas funções devolvem. Os números vêm de sentenças de 1º grau do
// TJSP publicadas no CJPG, classificadas por regex; são referência histórica, não previsão.
import { contarDesfechos, intervaloWilson, resumirValores, valoresDeCondenacao, type Desfecho, type ItemEstat, type ResumoValores } from '../../modulos/jurimetria/estatisticas.ts'
import { formatarPercentual, formatarReais } from '../../utils/formatadores.ts'

export type Candidato = { id: string; nome: string; caminho: string; confianca: number; variantes?: string[] }
export type ResolucaoCampo = { candidatos: Candidato[]; escolhido: Candidato | null; confianca: number | null; ambiguo?: boolean }
export type Resolucao = { tjsp: boolean; foro?: { id: string; nome: string } | null; vara?: ResolucaoCampo; classe?: ResolucaoCampo; assunto?: ResolucaoCampo }
export type Escolha = { vara: Candidato | null; classe: Candidato | null; assunto: Candidato | null }
export type CampoFiltro = keyof Escolha

/** Limite do e-SAJ: no máximo 364 dias entre a data inicial e a final. */
export const DIAS_PERIODO = 364
/** Abaixo disto taxas e percentis são pouco confiáveis (mesmo limite do backend, CJPG_AMOSTRA_MINIMA). */
export const AMOSTRA_MINIMA = 30
/** Páginas de 10 sentenças por consulta: cobre a vara típica (~75 por ano) em cerca de 8 s. */
export const PAGINAS = 8

const dois = (n: number) => String(n).padStart(2, '0')
const ddmmaaaa = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`

/** Últimos 12 meses (364 dias, o máximo que o e-SAJ aceita), terminando em `hoje`. */
export function periodoPadrao(hoje: Date): { inicio: string; fim: string } {
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - DIAS_PERIODO)
  return { inicio: ddmmaaaa(ini), fim: ddmmaaaa(hoje) }
}

/** Número CNJ do TJSP (justiça 8, tribunal 26): é o único coberto pelo CJPG. */
export function ehTjsp(numero: string): boolean {
  const d = numero.replace(/\D/g, '')
  return d.length === 20 && d.slice(13, 16) === '826'
}

export const soDigitos = (v: string) => v.replace(/\D/g, '')

/** O que a resolução já escolheu sozinha (só com confiança alta e sem ambiguidade). */
export function escolhaInicial(r: Resolucao | undefined): Escolha {
  return { vara: r?.vara?.escolhido ?? null, classe: r?.classe?.escolhido ?? null, assunto: r?.assunto?.escolhido ?? null }
}

export type Consulta = { chave: 'vara' | 'tjsp'; titulo: string; descricao: string; params: Record<string, string | number | null> }

/** Duas consultas: a vara (vara + classe) e o TJSP todo (classe + assunto). Cada uma só existe se tiver filtro suficiente. */
export function consultasDe(escolha: Escolha, periodo: { inicio: string; fim: string }): Consulta[] {
  const base = { data_inicio: periodo.inicio, data_fim: periodo.fim, paginas: PAGINAS }
  const saida: Consulta[] = []
  if (escolha.vara && escolha.classe) {
    saida.push({ chave: 'vara', titulo: 'Nesta vara', descricao: `${escolha.vara.nome} · ${escolha.classe.nome}`,
      params: { ...base, vara_codigo: escolha.vara.id, classe_codigo: escolha.classe.id } })
  }
  if (escolha.assunto) {
    saida.push({ chave: 'tjsp', titulo: 'TJSP, mesmo assunto', descricao: [escolha.assunto.nome, escolha.classe?.nome].filter(Boolean).join(' · '),
      params: { ...base, assunto_codigo: escolha.assunto.id, classe_codigo: escolha.classe?.id ?? null } })
  }
  return saida
}

/** Por que ainda não dá para calcular (vazio = pode calcular). */
export function pendencias(escolha: Escolha): string[] {
  const p: string[] = []
  if (!escolha.classe) p.push('Escolha a classe do processo.')
  if (!escolha.vara && !escolha.assunto) p.push('Escolha a vara ou o assunto.')
  return p
}

export type RespostaConsulta = {
  erro?: boolean; mensagem?: string; avisos?: string[]; total_servidor?: number | null; buscados?: number
  resultados?: Array<ItemEstat & { numero_processo?: string }>
}
export type Analise = {
  buscados: number; totalServidor: number | null; classificados: number; naoClassificados: number
  contagens: Record<Desfecho, number>; comProcedencia: number; taxaProcedencia: number | null; icProcedencia: [number, number] | null
  taxaImprocedencia: number | null; taxaAcordo: number | null; valores: ResumoValores | null
  amostraPequena: boolean; cobertura: number | null; parcial: boolean
}

/** Estatísticas de uma resposta do CJPG: "alguma procedência" = procedente + parcial. */
export function analisar(r: RespostaConsulta): Analise {
  const itens = r.resultados ?? []
  const { contagens, classificados, naoClassificados } = contarDesfechos(itens)
  const comProcedencia = contagens.procedente + contagens.parcial
  const taxa = (n: number) => (classificados ? n / classificados : null)
  const total = r.total_servidor ?? null
  return {
    buscados: itens.length, totalServidor: total, classificados, naoClassificados, contagens, comProcedencia,
    taxaProcedencia: taxa(comProcedencia), icProcedencia: intervaloWilson(comProcedencia, classificados),
    taxaImprocedencia: taxa(contagens.improcedente), taxaAcordo: taxa(contagens.acordo),
    valores: resumirValores(valoresDeCondenacao(itens)),
    amostraPequena: classificados < AMOSTRA_MINIMA,
    cobertura: itens.length ? classificados / itens.length : null,
    parcial: total !== null && itens.length < total,
  }
}

/** Frase-resumo do cartão, em linguagem de quem advoga. */
export function textoResumo(a: Analise, periodo: { inicio: string; fim: string }): string {
  if (a.buscados === 0) return 'O e-SAJ não devolveu sentenças para esses filtros no período.'
  if (a.classificados === 0) return `Foram encontradas ${a.buscados} sentenças, mas nenhuma teve o desfecho identificado automaticamente.`
  const origem = a.parcial && a.totalServidor ? `as ${a.buscados} mais recentes de ${a.totalServidor.toLocaleString('pt-BR')}` : `${a.buscados}`
  const partes = [
    `Em ${a.classificados} sentenças classificadas (${origem} publicadas de ${periodo.inicio} a ${periodo.fim}), `
    + `${formatarPercentual(a.taxaProcedencia)} tiveram alguma procedência`
    + (a.icProcedencia ? ` (intervalo de 95%: ${formatarPercentual(a.icProcedencia[0])} a ${formatarPercentual(a.icProcedencia[1])})` : '')
    + `, ${formatarPercentual(a.taxaImprocedencia)} foram improcedentes e ${formatarPercentual(a.taxaAcordo)} terminaram em acordo.`,
  ]
  if (a.valores) {
    partes.push(`Valor mediano de condenação: ${formatarReais(a.valores.mediana)} (25% a 75%: ${formatarReais(a.valores.p25)} a ${formatarReais(a.valores.p75)}; ${a.valores.n} valores extraídos).`)
  }
  if (a.amostraPequena) partes.unshift(`Amostra pequena (${a.classificados} classificadas, o mínimo confiável é ${AMOSTRA_MINIMA}): use como indício, não como tendência.`)
  return partes.join(' ')
}
