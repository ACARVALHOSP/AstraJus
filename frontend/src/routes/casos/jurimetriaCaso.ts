// Jurimetria na ficha do processo: o que sai da capa, as consultas ao CJPG e o texto dos cartões.
// Puro (sem React): a tela só desenha o que estas funções devolvem. Os números vêm de sentenças de 1º grau do
// TJSP publicadas no CJPG, classificadas por regex; são referência histórica, não previsão.
import { contarDesfechos, intervaloWilson, resumirValores, valoresDeCondenacao, type Desfecho, type ItemEstat, type ResumoValores } from '../../modulos/jurimetria/estatisticas.ts'
import { formatarPercentual, formatarReais } from '../../utils/formatadores.ts'

export type Candidato = { id: string; nome: string; caminho: string; confianca: number; variantes?: string[] }
export type ResolucaoCampo = { candidatos: Candidato[]; escolhido: Candidato | null; confianca: number | null; ambiguo?: boolean }
export type Resolucao = { tjsp: boolean; foro?: { id: string; nome: string } | null; vara?: ResolucaoCampo; classe?: ResolucaoCampo; assunto?: ResolucaoCampo; magistrado?: ResolucaoCampo }
export type Escolha = { vara: Candidato | null; classe: Candidato | null; assunto: Candidato | null; magistrado: Candidato | null }
/** Escolha guardada no servidor para o processo (quem confirmou e quando). */
export type EscolhaSalva = Escolha & { atualizado_em?: number; atualizado_por?: string | null }
export type CampoFiltro = keyof Escolha

/** Limite do e-SAJ por consulta: no máximo 364 dias entre a data inicial e a final. */
export const DIAS_JANELA = 364
/** A ficha do processo olha 36 meses: o servidor divide em 3 janelas de 12 meses (periodo_longo) e soma. */
export const DIAS_PERIODO = 3 * 365 - 1
/** Abaixo disto taxas e percentis são pouco confiáveis (mesmo limite do backend, CJPG_AMOSTRA_MINIMA). */
export const AMOSTRA_MINIMA = 30
/** Páginas de 10 sentenças por janela de 12 meses: cobre a vara típica (~75 por ano) em cerca de 8 s. */
export const PAGINAS = 8

const dois = (n: number) => String(n).padStart(2, '0')
const ddmmaaaa = (d: Date) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`

/** Últimos 36 meses (3 janelas de 12 meses), terminando em `hoje`. */
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

/** O que vale ao abrir: a escolha guardada para o processo, e onde ela não tem nada, o que a resolução escolheu sozinha
 *  (só com confiança alta e sem ambiguidade). */
export function escolhaInicial(r: Resolucao | undefined, salva?: Partial<Escolha> | null): Escolha {
  const campo = (c: CampoFiltro) => salva?.[c] ?? r?.[c]?.escolhido ?? null
  return { vara: campo('vara'), classe: campo('classe'), assunto: campo('assunto'), magistrado: campo('magistrado') }
}

/** Corpo do PUT que guarda a escolha: só id, nome e caminho de cada filtro. */
export function escolhaParaServidor(e: Escolha): Record<CampoFiltro, { id: string; nome: string; caminho: string } | null> {
  const c = (x: Candidato | null) => (x ? { id: x.id, nome: x.nome, caminho: x.caminho || x.nome } : null)
  return { vara: c(e.vara), classe: c(e.classe), assunto: c(e.assunto), magistrado: c(e.magistrado) }
}

export type Consulta = { chave: 'vara' | 'tjsp' | 'juiz'; ferramenta: 'consultar_jurimetria_cjpg' | 'perfil_decisorio_magistrado'; titulo: string; descricao: string; params: Record<string, string | number | boolean | null> }

/** Até três consultas: a vara (vara + classe), o TJSP todo (classe + assunto) e o magistrado (magistrado + classe). Cada uma só existe se tiver filtro suficiente. */
export function consultasDe(escolha: Escolha, periodo: { inicio: string; fim: string }): Consulta[] {
  const base = { data_inicio: periodo.inicio, data_fim: periodo.fim, paginas: PAGINAS, periodo_longo: true }
  const saida: Consulta[] = []
  if (escolha.vara && escolha.classe) {
    saida.push({ chave: 'vara', ferramenta: 'consultar_jurimetria_cjpg', titulo: 'Nesta vara', descricao: `${escolha.vara.nome} · ${escolha.classe.nome}`,
      params: { ...base, vara_codigo: escolha.vara.id, classe_codigo: escolha.classe.id } })
  }
  if (escolha.assunto) {
    saida.push({ chave: 'tjsp', ferramenta: 'consultar_jurimetria_cjpg', titulo: 'TJSP, mesmo assunto', descricao: [escolha.assunto.nome, escolha.classe?.nome].filter(Boolean).join(' · '),
      params: { ...base, assunto_codigo: escolha.assunto.id, classe_codigo: escolha.classe?.id ?? null } })
  }
  if (escolha.magistrado && escolha.classe) {
    // Perfil do juiz nas ações da mesma classe; a ferramenta compara sozinha com a média de todos os juízes.
    saida.push({ chave: 'juiz', ferramenta: 'perfil_decisorio_magistrado', titulo: 'Este magistrado', descricao: `${escolha.magistrado.nome} · ${escolha.classe.nome}`,
      params: { ...base, magistrado_codigo: escolha.magistrado.id, classe_codigo: escolha.classe.id, comparar_com_universo: true } })
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
  perfil?: Record<string, unknown>
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

type PerfilTaxas = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** "Alguma procedência" de um perfil do servidor: taxa_procedente + taxa_parcial (nulo se faltar uma). */
export function taxaProcedenciaPerfil(p: PerfilTaxas | undefined | null): number | null {
  const a = num(p?.taxa_procedente), b = num(p?.taxa_parcial)
  return a === null || b === null ? null : a + b
}

export type ComparacaoJuiz = { juiz: number | null; media: number | null; diferenca: number | null; amostraMedia: number | null; indisponivel: string | null }
/** Taxa de procedência do juiz contra a de todos os juízes (mesmos filtros, sem o magistrado). */
export function comparacaoJuiz(r: RespostaConsulta): ComparacaoJuiz {
  const perfil = r.perfil ?? {}
  const base = (perfil.baseline && typeof perfil.baseline === 'object' ? perfil.baseline : null) as PerfilTaxas | null
  const indisponivel = base && typeof base.indisponivel === 'string' ? base.indisponivel : base ? null : 'dados insuficientes'
  // O mesmo número que o cartão mostra (das sentenças); só sem sentenças cai nas taxas do perfil.
  const juiz = analisar(r).taxaProcedencia ?? taxaProcedenciaPerfil(perfil)
  const media = indisponivel ? null : taxaProcedenciaPerfil(base)
  return { juiz, media, diferenca: juiz !== null && media !== null ? juiz - media : null, amostraMedia: num(base?.total_classificados), indisponivel }
}

/** "13/11/2026" -> "2026-11-13" (formato das datas dos campos e do link). */
export const isoDeDdMmAaaa = (v: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }

/** Parâmetros do link para a tela de Jurimetria (ids e datas, que cabem no endereço; os nomes a tela busca pelo id). */
export function payloadParaTela(e: Escolha, periodo: { inicio: string; fim: string }): Record<string, string> {
  // A tela de Jurimetria só aceita 12 meses por consulta: leva a janela mais recente do período.
  const fim = isoDeDdMmAaaa(periodo.fim)
  const [a, m, d] = fim.split('-').map(Number)
  const ini12 = fim ? new Date(a, m - 1, d - DIAS_JANELA) : null
  const inicio12 = ini12 ? `${ini12.getFullYear()}-${dois(ini12.getMonth() + 1)}-${dois(ini12.getDate())}` : ''
  const inicioCompleto = isoDeDdMmAaaa(periodo.inicio)
  const p: Record<string, string> = { inicio: inicioCompleto > inicio12 ? inicioCompleto : inicio12, fim }
  for (const c of ['vara', 'classe', 'assunto', 'magistrado'] as CampoFiltro[]) if (e[c]) p[c] = e[c]!.id
  return p
}

/** Diferença em pontos percentuais com sinal: 0,13 -> "+13,0 p.p."; -0,042 -> "-4,2 p.p.". */
export function formatarPontos(d: number): string {
  const v = Math.round(d * 1000) / 10
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`
}
