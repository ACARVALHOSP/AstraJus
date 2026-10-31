export type ResultadoJurisprudencia = {
  cdJurisprudencia?: number
  cdAcordao?: number
  classe?: string
  relator?: string
  comarca?: string
  orgao_julgador?: string
  data_julgamento?: string
  ementa?: string
  trecho_destacado_html?: string | null
  segredo_justica?: boolean
  pdf_url?: string | null
  nu_processo_origem?: string | null
  votacao?: string | null
  voto?: string | null
  prolatores?: string[] | null
  boletins?: string[] | null
  ativo?: boolean
}
