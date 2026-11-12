// Horas por processo: tipos e regras puras da tela (duração, status e seleção para faturar).

export type Horas = {
  id: number; caso_id: string; caso_titulo: string | null; cliente_id: string | null; usuario: string
  data: string; minutos: number; descricao: string | null; faturavel: boolean
  valor_hora: number | null; valor: number | null; lancamento_id: string | null; faturado: boolean
}
export type Totais = {
  minutos: number; minutos_faturaveis: number; valor: number; a_faturar: number; faturado: number; sem_valor_hora: number
}
export type StatusFiltro = 'todos' | 'a_faturar' | 'faturadas' | 'nao_faturaveis'

export const MAX_MINUTOS = 24 * 60

/** 0 → "0min", 45 → "45min", 60 → "1h", 90 → "1h30". */
export function formatarDuracao(minutos: number): string {
  const total = Math.max(0, Math.round(minutos))
  const h = Math.floor(total / 60), m = total % 60
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** Relógio do cronômetro: 3725 segundos → "01:02:05". */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':')
}

/** Lê o que a pessoa digitou: "1:30", "1h30", "2h", "45min", "90" (minutos) ou "1,5" (horas). null se inválido ou fora de 1 min a 24 h. */
export function lerDuracao(texto: string): number | null {
  const t = texto.trim().toLowerCase().replace(/\s+/g, ' ').replace(',', '.')
  let minutos: number | null = null
  let m: RegExpExecArray | null
  if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(t))) minutos = Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null
  else if ((m = /^(\d{1,2}) ?h(?: ?(\d{1,2}) ?(?:min|m)?)?$/.exec(t))) minutos = m[2] === undefined ? Number(m[1]) * 60 : Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null
  else if ((m = /^(\d{1,4}) ?(?:min|m)$/.exec(t))) minutos = Number(m[1])
  else if (/^\d{1,4}$/.test(t)) minutos = Number(t)
  else if (/^\d{1,2}\.\d{1,2}$/.test(t)) minutos = Math.round(Number(t) * 60)
  return minutos !== null && minutos >= 1 && minutos <= MAX_MINUTOS ? minutos : null
}

export type SituacaoHoras = { texto: 'Faturado' | 'A faturar' | 'Sem valor/hora' | 'Não faturável'; cor: 'green' | 'blue' | 'amber' | 'gray' }
export function situacaoDasHoras(h: Pick<Horas, 'faturavel' | 'faturado' | 'valor_hora'>): SituacaoHoras {
  if (!h.faturavel) return { texto: 'Não faturável', cor: 'gray' }
  if (h.faturado) return { texto: 'Faturado', cor: 'green' }
  return h.valor_hora === null ? { texto: 'Sem valor/hora', cor: 'amber' } : { texto: 'A faturar', cor: 'blue' }
}

export const podeFaturar = (h: Pick<Horas, 'faturavel' | 'faturado' | 'valor_hora'>) => h.faturavel && !h.faturado && h.valor_hora !== null

/** Motivo pelo qual a seleção não pode virar um lançamento, ou null se pode. */
export function motivoNaoFaturar(selecionadas: Horas[]): string | null {
  if (!selecionadas.length) return 'Selecione as horas que quer faturar.'
  if (selecionadas.some(h => !podeFaturar(h))) return 'Só entram horas faturáveis, ainda não faturadas e com valor por hora.'
  if (new Set(selecionadas.map(h => h.caso_id)).size > 1) return 'Fature um processo por vez: a seleção tem horas de processos diferentes.'
  return null
}

/** Primeiro e último dia do mês de `hoje`, em AAAA-MM-DD. */
export function mesDe(hoje: Date): { de: string; ate: string } {
  const p = (n: number) => String(n).padStart(2, '0')
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  return { de: `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-01`, ate: `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(ultimo)}` }
}

/** Parâmetros da consulta GET /horas a partir dos filtros da tela. */
export function parametrosDeHoras(f: { de: string; ate: string; usuario: string; casoId: string; status: StatusFiltro }): string {
  const q = new URLSearchParams()
  if (f.de) q.set('de', f.de)
  if (f.ate) q.set('ate', f.ate)
  if (f.usuario) q.set('usuario', f.usuario)
  if (f.casoId) q.set('caso_id', f.casoId)
  if (f.status === 'a_faturar') { q.set('faturavel', 'true'); q.set('faturado', 'false') }
  if (f.status === 'faturadas') q.set('faturado', 'true')
  if (f.status === 'nao_faturaveis') q.set('faturavel', 'false')
  return q.toString()
}
