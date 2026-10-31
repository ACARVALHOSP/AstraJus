export const COLUNAS = [
  { id: 'pendente', titulo: 'A fazer' },
  { id: 'em_andamento', titulo: 'Em andamento' },
  { id: 'aguardando', titulo: 'Aguardando retorno' },
  { id: 'concluida', titulo: 'Concluídas' },
] as const

export type StatusAtividade = typeof COLUNAS[number]['id']
export type ProcessoHome = { id: string; titulo?: string; responsavel?: string }
export type AtividadeHome = {
  id: string | number; titulo: string; tipo: string; status: string
  responsavel?: string | null; data?: string | null; hora?: string | null; criado_em?: string
}
export type ItemHome = {
  processo: ProcessoHome; atividade: AtividadeHome
  checklist: { total: number; concluidos: number } | null
}
export type Periodo = '' | 'atrasadas' | 'hoje' | 'semana'
export const TIPOS: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

export function chaveItem(item: ItemHome) { return `${item.processo.id}:${item.atividade.id}` }
export function colunaAtividade(status: string): StatusAtividade {
  return COLUNAS.find(c => c.id === status)?.id ?? 'pendente'
}
export function diaLocal(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}
export function noPeriodo(atividade: AtividadeHome, periodo: Periodo, agora: Date): boolean {
  if (!periodo) return true
  if (!atividade.data || atividade.status === 'concluida') return false
  const hoje = diaLocal(agora)
  if (periodo === 'atrasadas') return atividade.data < hoje
  if (periodo === 'hoje') return atividade.data === hoje
  const limite = new Date(agora)
  limite.setDate(limite.getDate() + 7)
  return atividade.data > hoje && atividade.data <= diaLocal(limite)
}
export function ordenarItens(a: ItemHome, b: ItemHome): number {
  return (a.atividade.data || '9999').localeCompare(b.atividade.data || '9999') ||
    (a.atividade.hora || '23:59').localeCompare(b.atividade.hora || '23:59') ||
    a.atividade.titulo.localeCompare(b.atividade.titulo, 'pt-BR') || chaveItem(a).localeCompare(chaveItem(b))
}
