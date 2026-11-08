/** Resposta de GET /lancamentos/resumo (ver financeiro_juridico.py). */
export type ResumoProcesso = {
  caso_id: string; cliente_id: string
  honorarios: { previstos: number; recebidos: number; em_aberto: number; vencidos: number }
  custas: { gastas: number; a_reembolsar: number; reembolso_pendente: number; reembolsadas: number }
  repasses: { total: number; repassado: number; pendente: number }
  entrou: number; saiu: number; saldo: number
}
export type ItemAtraso = { id: string; caso_id: string; descricao: string; tipo: string; vencimento: string; valor: number; dias_atraso: number; asaas_cobranca_id?: string | null }
export type ClienteInadimplente = { cliente_id: string; quantidade: number; valor: number; maior_atraso: number; itens: ItemAtraso[] }
export type ResumoInadimplencia = {
  total_vencido: number; quantidade: number; clientes_inadimplentes: number; taxa: number
  faixas: { faixa: string; quantidade: number; valor: number }[]; clientes: ClienteInadimplente[]
}
export type ResumoFinanceiro = { hoje: string; processos: ResumoProcesso[]; inadimplencia: ResumoInadimplencia }
