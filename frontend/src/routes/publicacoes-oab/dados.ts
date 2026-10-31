import { formatarDataSimples, formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { formatarData } from '../../utils/listasRapidas'

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
}
export const ROTULO_STATUS = { nao_tratada: 'Não tratada', tratada: 'Tratada', arquivada: 'Arquivada' }
export const numeroPublicacao = (p: PublicacaoOab) => String(p.numero_processo || p.dados?.numeroprocessocommascara || p.dados?.numero_processo || '').replace(/\D/g, '')
export function nomePublicacao(p: PublicacaoOab): string {
  const partes = p.dados?.destinatarios ?? []
  const polo = (valor: string) => [...new Set(partes.filter(x => x.polo?.toUpperCase() === valor).map(x => formatarNomeExibicao(x.nome)).filter(Boolean))].join(' / ')
  const ativo = polo('A'), passivo = polo('P')
  if (ativo && passivo) return `${ativo} X ${passivo}`
  return [ativo && `Polo ativo: ${ativo}`, passivo && `Polo passivo: ${passivo}`].filter(Boolean).join(' · ') || 'Partes não informadas'
}
export function urlPublicacao(p: PublicacaoOab) {
  try { const url = new URL(p.dados?.link ?? ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
function exibir(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  if (Array.isArray(valor)) return valor.map(exibir).join('; ') || '—'
  if (typeof valor === 'object') return Object.entries(valor).map(([k, v]) => `${k}: ${exibir(v)}`).join(' · ')
  return String(valor)
}
export type Coluna = { key: string; header: string; obrigatoria?: boolean; valor: (p: PublicacaoOab) => string }
export const COLUNAS: Coluna[] = [
  { key: 'tribunal', header: 'Tribunal', obrigatoria: true, valor: p => p.dados?.siglaTribunal?.toUpperCase() || '—' },
  { key: 'processo', header: 'Processo', obrigatoria: true, valor: p => formatarNumeroCNJ(numeroPublicacao(p)) || 'Não informado' },
  { key: 'nome', header: 'Nome do processo', obrigatoria: true, valor: nomePublicacao },
  { key: 'divulgado', header: 'Divulgado', valor: p => formatarDataSimples(p.dados?.data_disponibilizacao) || '—' },
  { key: 'capturado', header: 'Capturado', valor: p => p.criado_em ? formatarData(p.criado_em) : '—' },
  { key: 'tipo', header: 'Tipo', valor: p => p.dados?.tipoComunicacao || '—' },
  { key: 'status', header: 'Status', valor: p => ROTULO_STATUS[p.status] },
  { key: 'orgao', header: 'Órgão', valor: p => p.dados?.nomeOrgao || '—' },
  { key: 'classe', header: 'Classe', valor: p => p.dados?.nomeClasse || '—' },
  { key: 'advogados', header: 'Advogados', valor: p => (p.dados?.destinatarioadvogados ?? []).map(a => `${formatarNomeExibicao(a.nome)} OAB ${a.numero_oab ?? '?'}/${a.uf_oab ?? '?'}`).join('; ') || '—' },
  { key: 'oab', header: 'Número da OAB', valor: p => exibir(p.dados?.destinatarioadvogados?.map(a => a.numero_oab)) },
  { key: 'uf', header: 'UF da OAB', valor: p => exibir(p.dados?.destinatarioadvogados?.map(a => a.uf_oab?.toUpperCase())) },
  { key: 'dados_advogados', header: 'Dados dos advogados', valor: p => exibir(p.dados?.destinatarioadvogados) },
  { key: 'polos', header: 'Polos dos destinatários', valor: p => exibir(p.dados?.destinatarios?.map(a => a.polo)) },
  { key: 'documento', header: 'Tipo de documento', valor: p => exibir(p.dados?.tipoDocumento) },
  { key: 'texto', header: 'Texto', valor: p => p.dados?.texto || '—' },
  { key: 'destinatarios', header: 'Destinatários', valor: p => (p.dados?.destinatarios ?? []).map(a => formatarNomeExibicao(a.nome)).join('; ') || '—' },
  { key: 'referencia', header: 'Referência', valor: p => formatarNomeExibicao(p.nome_pesquisado) || '—' },
  { key: 'link', header: 'Link DJEN', valor: p => p.dados?.link || '—' },
  { key: 'hash', header: 'Identificador', valor: p => p.hash },
]
const MAPEADOS = new Set(['data_disponibilizacao', 'tipoComunicacao', 'siglaTribunal', 'nomeOrgao', 'nomeClasse', 'numeroprocessocommascara', 'numero_processo', 'destinatarios', 'destinatarioadvogados', 'link', 'texto', 'tipoDocumento', 'hash'])
export function catalogoColunas(campos: string[]): Coluna[] {
  return [...COLUNAS, ...[...new Set(campos)].filter(c => !MAPEADOS.has(c)).sort().map(c => ({ key: `djen:${c}`, header: c, valor: (p: PublicacaoOab) => exibir(p.dados?.[c]) }))]
}
export const CHAVE_COLUNAS = 'cnj_pub_oab_colunas_visiveis_react_v1'
export function lerPreferencias(): string[] {
  try {
    const novas = localStorage.getItem(CHAVE_COLUNAS)
    const salvas: unknown = JSON.parse(novas ?? localStorage.getItem('cnj_pub_oab_colunas_visiveis_v2') ?? '[]')
    return Array.isArray(salvas) && salvas.every(c => typeof c === 'string') ? salvas : []
  } catch { return [] }
}
