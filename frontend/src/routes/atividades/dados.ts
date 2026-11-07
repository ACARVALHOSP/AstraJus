/** Regras compartilhadas das telas de atividades (lista global e aba do processo). */
export type AtividadeComData = { data?: string | null; hora?: string | null }

export type Grupo = 'atrasadas' | 'hoje' | 'semana' | 'depois' | 'sem_data'
export type Atalho = '' | 'atrasadas' | 'hoje' | 'semana' | 'sem_data'

export const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }
export const COR_TIPO: Record<string, 'red' | 'violet' | 'blue' | 'gray'> = { prazo: 'red', audiencia: 'violet', reuniao: 'blue', tarefa: 'gray', outro: 'gray' }
export const ROTULO_STATUS: Record<string, string> = { pendente: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando retorno', concluida: 'Concluída' }
export const COR_STATUS: Record<string, 'gray' | 'blue' | 'amber' | 'green'> = { pendente: 'gray', em_andamento: 'blue', aguardando: 'amber', concluida: 'green' }
export const TITULO_GRUPO: Record<Grupo, string> = { atrasadas: 'Atrasadas', hoje: 'Hoje', semana: 'Próximos 7 dias', depois: 'Mais adiante', sem_data: 'Sem data' }
export const ORDEM_GRUPOS: Grupo[] = ['atrasadas', 'hoje', 'semana', 'depois', 'sem_data']
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function diasEntre(deIso: string, ateIso: string) {
  const [a, b] = [deIso, ateIso].map(v => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / 86_400_000)
}
export function grupoDe(a: AtividadeComData, hoje: string): Grupo {
  if (!a.data) return 'sem_data'
  const dias = diasEntre(hoje, a.data.slice(0, 10))
  if (dias < 0) return 'atrasadas'
  if (dias === 0) return 'hoje'
  return dias <= 7 ? 'semana' : 'depois'
}
export function dataCurta(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export function quandoRelativo(a: AtividadeComData, hoje: string): string {
  if (!a.data) return 'definir data'
  const dias = diasEntre(hoje, a.data.slice(0, 10))
  const hora = a.hora ? a.hora.slice(0, 5) : ''
  if (dias < -1) return `há ${-dias} dias`
  if (dias === -1) return 'ontem'
  if (dias === 0) return hora || 'dia inteiro'
  if (dias === 1) return `amanhã${hora ? ` · ${hora}` : ''}`
  const [y, m, d] = a.data.slice(0, 10).split('-').map(Number)
  const semana = SEMANA[new Date(y, m - 1, d).getDay()]
  return dias <= 7 ? `${semana}${hora ? ` · ${hora}` : ''}` : `em ${dias} dias`
}
