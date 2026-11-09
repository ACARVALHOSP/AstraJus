import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'
import { formatarData } from '../../utils/listasRapidas'
import type { Triagem } from './triagem'

export type DadosDjen = {
  data_disponibilizacao?: string; tipoComunicacao?: string; siglaTribunal?: string
  nomeOrgao?: string; nomeClasse?: string; numeroprocessocommascara?: string
  texto?: string; link?: string; [campo: string]: unknown
  destinatarios?: Array<{ nome?: string; polo?: string }>
  destinatarioadvogados?: Array<{ nome?: string; numero_oab?: string; uf_oab?: string }>
}
export type PublicacaoOab = {
  hash: string; status: 'nao_tratada' | 'tratada' | 'arquivada'; caso_id?: string | null
  criado_em?: string; numero_processo?: string; nome_pesquisado?: string; dados?: DadosDjen
  caso_titulo?: string | null
  triagem?: Triagem | null
}
export const ROTULO_STATUS = { nao_tratada: 'Não tratada', tratada: 'Tratada', arquivada: 'Arquivada' }
export const numeroPublicacao = (p: PublicacaoOab) => String(p.numero_processo || p.dados?.numeroprocessocommascara || p.dados?.numero_processo || '').replace(/\D/g, '')
export function nomePublicacao(p: PublicacaoOab): string {
  const partes = p.dados?.destinatarios ?? []
  const polo = (valor: string) => [...new Set(partes.filter(x => x.polo?.toUpperCase() === valor).map(x => formatarNomeExibicao(x.nome)).filter(Boolean))].join(' / ')
  const ativo = polo('A'), passivo = polo('P')
  if (ativo && passivo) return `${ativo} x ${passivo}`
  return [ativo && `Polo ativo: ${ativo}`, passivo && `Polo passivo: ${passivo}`].filter(Boolean).join(' · ') || 'Partes não informadas'
}
export function urlPublicacao(p: PublicacaoOab) {
  try { const url = new URL(p.dados?.link ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
export type ContagemStatus = Record<PublicacaoOab['status'], number>

/** Cor do selo do tipo de comunicação (Radix). */
export function corTipo(tipo: string | undefined): 'blue' | 'orange' | 'gray' {
  const t = (tipo ?? '').toLocaleLowerCase('pt-BR')
  if (t.startsWith('intima')) return 'blue'
  if (t.startsWith('cita')) return 'orange'
  return 'gray'
}
export const COR_STATUS = { nao_tratada: 'red', tratada: 'green', arquivada: 'gray' } as const

export function orgaoPublicacao(p: PublicacaoOab): string {
  return [p.dados?.siglaTribunal?.toUpperCase(), p.dados?.nomeOrgao].filter(Boolean).join(' · ')
}
export function advogadosPublicacao(p: PublicacaoOab): string {
  return (p.dados?.destinatarioadvogados ?? []).map(a => `${formatarNomeExibicao(a.nome)} — OAB ${a.numero_oab ?? '?'}/${(a.uf_oab ?? '?').toUpperCase()}`).join('; ')
}
export function dataDivulgacao(p: PublicacaoOab): string {
  return formatarDataSimples(p.dados?.data_disponibilizacao) || '—'
}
export function dataCaptura(p: PublicacaoOab): string {
  return p.criado_em ? formatarData(p.criado_em) : '—'
}
/** Captura em formato curto (dd/mm hh:mm) para a coluna Divulgado. */
export function dataCapturaCurta(p: PublicacaoOab): string {
  if (!p.criado_em) return '—'
  const d = new Date(p.criado_em)
  if (Number.isNaN(d.getTime())) return '—'
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}

/** Colunas opcionais da tabela (as fixas são Divulgado, Processo, Partes, Tipo e Situação). */
export type ColunaOpcional = { key: string; header: string; valor: (p: PublicacaoOab) => string }
export const COLUNAS_OPCIONAIS: ColunaOpcional[] = [
  { key: 'classe', header: 'Classe', valor: p => p.dados?.nomeClasse || '—' },
  { key: 'advogados', header: 'Advogados', valor: p => advogadosPublicacao(p) || '—' },
  { key: 'referencia', header: 'Referência', valor: p => formatarNomeExibicao(p.nome_pesquisado) || '—' },
]
export const CHAVE_COLUNAS = 'cnj_pub_oab_colunas_opcionais_v1'
export function lerPreferencias(): string[] {
  try {
    const salvas: unknown = JSON.parse(localStorage.getItem(CHAVE_COLUNAS) ?? '[]')
    return Array.isArray(salvas) ? salvas.filter((c): c is string => COLUNAS_OPCIONAIS.some(o => o.key === c)) : []
  } catch { return [] }
}
