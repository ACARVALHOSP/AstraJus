/** Sugestões da triagem (classificador simulado ou Jev). Só apoio à leitura: nada é criado ou alterado por elas. */
export type Faixa = 'alta' | 'revisar' | 'baixa'
export type Triagem = {
  modelo: string
  tipo: { valor: string; confianca: number }
  gera_prazo: { valor: boolean; probabilidade: number; confianca: number }
  prazo_padrao: { valor: string; confianca: number }
  urgencia: { nota: number; confianca: number }
  faixas: { tipo: Faixa; gera_prazo: Faixa; prazo_padrao: Faixa; urgencia: Faixa }
}
export type InfoTriagem = { modo: 'desligado' | 'simulado' | 'jev' | 'sem_chave'; limite_alto: number; limite_baixo: number }

export const ROTULO_TIPO_TRIAGEM: Record<string, string> = {
  exige_manifestacao: 'Exige manifestação', ciencia: 'Só ciência', despacho_expediente: 'Despacho de expediente',
  sentenca_ou_decisao: 'Sentença ou decisão', outro: 'Outro',
}
export const pct = (v: number) => `${Math.round(v * 100)}%`

/** Selos a mostrar: nada abaixo de 50% de confiança, e "revisar" entre 50% e 90%. */
export function selosTriagem(t: Triagem | null | undefined, rotuloPrazo: (id: string) => string) {
  if (!t) return []
  const selos: Array<{ chave: string; texto: string; cor: 'red' | 'blue' | 'gray' | 'orange' | 'violet'; revisar: boolean; dica: string }> = []
  const { faixas } = t
  if (faixas.urgencia !== 'baixa') selos.push({
    chave: 'urgencia', texto: `Urgência ${t.urgencia.nota.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`,
    cor: t.urgencia.nota >= 7 ? 'red' : t.urgencia.nota >= 4 ? 'orange' : 'gray', revisar: faixas.urgencia === 'revisar',
    dica: `Nota de 1 a 10, confiança ${pct(t.urgencia.confianca)}`,
  })
  if (faixas.tipo !== 'baixa') selos.push({
    chave: 'tipo', texto: ROTULO_TIPO_TRIAGEM[t.tipo.valor] ?? t.tipo.valor, cor: 'blue', revisar: faixas.tipo === 'revisar', dica: `Confiança ${pct(t.tipo.confianca)}`,
  })
  if (faixas.gera_prazo !== 'baixa' && t.gera_prazo.valor) selos.push({
    chave: 'prazo', texto: 'Abre prazo', cor: 'violet', revisar: faixas.gera_prazo === 'revisar', dica: `Probabilidade ${pct(t.gera_prazo.probabilidade)}`,
  })
  if (faixas.prazo_padrao !== 'baixa' && t.prazo_padrao.valor !== 'nenhum') selos.push({
    chave: 'prazo_padrao', texto: rotuloPrazo(t.prazo_padrao.valor), cor: 'violet', revisar: faixas.prazo_padrao === 'revisar', dica: `Confiança ${pct(t.prazo_padrao.confianca)}`,
  })
  return selos
}
