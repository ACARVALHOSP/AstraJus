// Linha do tempo do processo: junta movimentações, publicações, atividades e vínculos (cada um vem de
// uma consulta diferente) em uma lista só, do mais recente ao mais antigo, agrupada por dia.
// Eventos futuros ficam de fora: prazos e audiências a vencer são consultados em Atividades e na Agenda.
import { ROTULO_STATUS as STATUS_ATIVIDADE, COR_STATUS as COR_ATIVIDADE, ROTULO_TIPO as TIPO_ATIVIDADE } from '../atividades/dados.ts'
import { formatarNumeroCNJ } from '../../utils/formatadores.ts'
import type { PublicacaoOab } from '../publicacoes-oab/dados'
import type { Atividade } from './AtividadesCaso'
import type { AtividadeResumo, Movimento, VinculoCaso } from './consultasCaso'

export type TipoEvento = 'movimentacao' | 'publicacao' | 'atividade' | 'vinculo'
export type CorSelo = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'orange' | 'violet'
export type Selo = { texto: string; cor: CorSelo }
export type Evento = { id: string; tipo: TipoEvento; dia: string; hora: string; titulo: string; detalhe: string; selos: Selo[]; texto: string }
export type Grupo = { dia: string; eventos: Evento[] }

export const TIPOS: { id: TipoEvento; rotulo: string; singular: string }[] = [
  { id: 'movimentacao', rotulo: 'Movimentações', singular: 'Movimentação' },
  { id: 'publicacao', rotulo: 'Publicações', singular: 'Publicação' },
  { id: 'atividade', rotulo: 'Atividades', singular: 'Atividade' },
  { id: 'vinculo', rotulo: 'Vínculos', singular: 'Vínculo' },
]
const STATUS_PUBLICACAO: Record<string, Selo> = {
  nao_tratada: { texto: 'Por revisar', cor: 'amber' }, tratada: { texto: 'Tratada', cor: 'green' }, arquivada: { texto: 'Arquivada', cor: 'gray' },
}
const TIPO_VINCULO: Record<string, string> = { recurso: 'Recurso', apenso: 'Apenso', execucao: 'Execução de sentença', cautelar: 'Cautelar / Tutela', relacionado: 'Relacionado' }
const LIMITE_TEXTO = 1500

const dois = (n: number) => String(n).padStart(2, '0')
export const isoLocalDe = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`

/** Dia (AAAA-MM-DD, no fuso local) e hora (HH:MM, vazia se só havia a data) de um texto de data. */
export function diaEHora(valor?: string | null): { dia: string; hora: string } | null {
  if (!valor) return null
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (so) return { dia: valor, hora: '' }
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return null
  return { dia: isoLocalDe(d), hora: `${dois(d.getHours())}:${dois(d.getMinutes())}` }
}

const cortar = (t?: string) => { const x = (t ?? '').trim(); return x.length > LIMITE_TEXTO ? x.slice(0, LIMITE_TEXTO).trimEnd() + '…' : x }

export function eventosMovimentacoes(movs: Movimento[]): Evento[] {
  const varios = new Set(movs.map(m => m.numero)).size > 1
  return movs.flatMap((m, i) => {
    const q = diaEHora(m.dataHora)
    if (!q) return []
    return [{ id: `mov:${m.numero}:${m.dataHora}:${i}`, tipo: 'movimentacao' as const, ...q, titulo: m.nome?.trim() || 'Movimentação', detalhe: [m.grau, varios ? formatarNumeroCNJ(m.numero) : ''].filter(Boolean).join(' · '), selos: [], texto: '' }]
  })
}

export function eventosPublicacoes(pubs: PublicacaoOab[], atividades: AtividadeResumo[]): Evento[] {
  const comPrazo = new Set(atividades.map(a => a.origem_djen_hash).filter(Boolean))
  return pubs.flatMap(p => {
    const q = diaEHora(p.dados?.data_disponibilizacao) ?? diaEHora(p.criado_em)
    if (!q) return []
    const selos: Selo[] = [STATUS_PUBLICACAO[p.status] ?? { texto: p.status, cor: 'gray' }]
    if (comPrazo.has(p.hash)) selos.push({ texto: 'Gerou atividade', cor: 'blue' })
    const orgao = [p.dados?.siglaTribunal?.toUpperCase(), p.dados?.nomeOrgao].filter(Boolean).join(' · ')
    return [{ id: `pub:${p.hash}`, tipo: 'publicacao' as const, ...q, hora: '', titulo: [p.dados?.tipoComunicacao, p.dados?.nomeClasse].filter(Boolean).join(' · ') || 'Publicação', detalhe: orgao, selos, texto: cortar(p.dados?.texto) }]
  })
}

export function eventosAtividades(ats: Atividade[], nomePessoa: (login: string | null | undefined) => string = l => l ?? ''): Evento[] {
  return ats.flatMap(a => {
    if (!a.data) return [] // sem data não tem lugar na linha do tempo
    const selos: Selo[] = [{ texto: TIPO_ATIVIDADE[a.tipo] ?? a.tipo, cor: 'gray' }, { texto: STATUS_ATIVIDADE[a.status] ?? a.status, cor: COR_ATIVIDADE[a.status] ?? 'gray' }]
    const resp = nomePessoa(a.responsavel)
    return [{ id: `ati:${a.id}`, tipo: 'atividade' as const, dia: a.data, hora: a.hora ?? '', titulo: a.titulo, detalhe: resp ? `Responsável: ${resp}` : '', selos, texto: (a.observacoes ?? '').trim() }]
  })
}

export function eventosVinculos(vs: VinculoCaso[]): Evento[] {
  return vs.flatMap(v => {
    const q = diaEHora(v.criado_em)
    if (!q) return []
    return [{ id: `vin:${v.caso_id}`, tipo: 'vinculo' as const, ...q, hora: '', titulo: `Processo vinculado · ${v.titulo || '(sem título)'}`, detalhe: [v.cliente_nome, v.acao].filter(Boolean).join(' · '), selos: [{ texto: TIPO_VINCULO[v.tipo] ?? v.tipo, cor: 'violet' as const }], texto: '' }]
  })
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ORDEM_TIPO: Record<TipoEvento, number> = { atividade: 0, publicacao: 1, movimentacao: 2, vinculo: 3 }

/** Filtra, ordena (mais recente primeiro) e agrupa por dia. `limite` corta a lista (a página mostra mais sob demanda). */
export function montarLinha(eventos: Evento[], opcoes: { tipos: ReadonlySet<TipoEvento>; busca: string; hoje: string; limite: number }) {
  const q = semAcento(opcoes.busca.trim())
  const passados = eventos.filter(e => e.dia <= opcoes.hoje)
  const futurosOcultos = eventos.length - passados.length
  const filtrados = passados
    .filter(e => opcoes.tipos.has(e.tipo) && (!q || semAcento(`${e.titulo} ${e.detalhe} ${e.texto}`).includes(q)))
    .sort((a, b) => b.dia.localeCompare(a.dia) || b.hora.localeCompare(a.hora) || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo] || a.id.localeCompare(b.id))
  const grupos: Grupo[] = []
  for (const e of filtrados.slice(0, opcoes.limite)) {
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.dia === e.dia) ultimo.eventos.push(e)
    else grupos.push({ dia: e.dia, eventos: [e] })
  }
  const contagem = Object.fromEntries(TIPOS.map(t => [t.id, passados.filter(e => e.tipo === t.id).length])) as Record<TipoEvento, number>
  return { grupos, total: filtrados.length, mostrados: Math.min(filtrados.length, opcoes.limite), contagem, futurosOcultos }
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
/** "Hoje · quinta-feira, 12 de novembro de 2026" (Hoje e Ontem só prefixam). */
export function rotuloDia(dia: string, hoje: string): string {
  const utc = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d) }
  const [a, m, d] = dia.split('-').map(Number)
  const dif = Math.round((utc(hoje) - utc(dia)) / 86_400_000)
  const texto = `${DIAS[new Date(utc(dia)).getUTCDay()]}, ${d} de ${MESES[m - 1]} de ${a}`
  return (dif === 0 ? 'Hoje · ' : dif === 1 ? 'Ontem · ' : '') + texto
}
