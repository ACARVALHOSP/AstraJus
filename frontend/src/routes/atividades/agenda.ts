/** Cálculos de calendário da Agenda (datas locais AAAA-MM-DD, semana começando no domingo). */
import { isoLocal } from './dados'

export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const DIAS_SEMANA_LONGO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const paraData = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
export const somarDias = (iso: string, dias: number) => { const d = paraData(iso); d.setDate(d.getDate() + dias); return isoLocal(d) }
export const inicioSemana = (iso: string) => somarDias(iso, -paraData(iso).getDay())
export const somarMeses = (iso: string, meses: number) => {
  const d = paraData(iso)
  const alvo = new Date(d.getFullYear(), d.getMonth() + meses, 1)
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate()
  alvo.setDate(Math.min(d.getDate(), ultimo))
  return isoLocal(alvo)
}
export type Visao = 'mes' | 'semana' | 'dia'

/** Dias exibidos: o mês em 6 semanas cheias, a semana ou o dia. */
export function diasDaVisao(visao: Visao, ref: string): string[] {
  if (visao === 'dia') return [ref]
  if (visao === 'semana') return Array.from({ length: 7 }, (_, i) => somarDias(inicioSemana(ref), i))
  const primeiro = `${ref.slice(0, 7)}-01`
  return Array.from({ length: 42 }, (_, i) => somarDias(inicioSemana(primeiro), i))
}

export function tituloDaVisao(visao: Visao, ref: string): string {
  const d = paraData(ref)
  if (visao === 'mes') return `${MESES[d.getMonth()]} de ${d.getFullYear()}`
  if (visao === 'dia') return `${DIAS_SEMANA_LONGO[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
  const dias = diasDaVisao('semana', ref)
  const [a, b] = [paraData(dias[0]), paraData(dias[6])]
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} a ${b.getDate()} de ${MESES[b.getMonth()]} de ${b.getFullYear()}`
    : `${a.getDate()} de ${MESES[a.getMonth()].slice(0, 3)} a ${b.getDate()} de ${MESES[b.getMonth()].slice(0, 3)} de ${b.getFullYear()}`
}

export function deslocar(visao: Visao, ref: string, sentido: 1 | -1): string {
  return visao === 'mes' ? somarMeses(ref, sentido) : somarDias(ref, sentido * (visao === 'semana' ? 7 : 1))
}

/** Arquivo .ics (iCalendar) para importar na agenda do celular ou do Google. */
export function gerarIcs(itens: { id: string | number; titulo: string; data: string; hora?: string | null; tipo: string; descricao?: string }[]): string {
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/[,;]/g, m => `\\${m}`).replace(/\r?\n/g, '\\n')
  const sem = (iso: string) => iso.replaceAll('-', '')
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AstraJus//Agenda//PT-BR', 'CALSCALE:GREGORIAN']
  for (const a of itens) {
    const dia = a.data.slice(0, 10)
    linhas.push('BEGIN:VEVENT', `UID:${a.id}-${sem(dia)}@astrajus`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`)
    if (a.hora) {
      const inicio = `${sem(dia)}T${a.hora.slice(0, 5).replace(':', '')}00`
      const fimData = new Date(paraData(dia).getTime())
      const [h, m] = a.hora.split(':').map(Number)
      fimData.setHours(h + 1, m)
      const fim = `${isoLocal(fimData).replaceAll('-', '')}T${String(fimData.getHours()).padStart(2, '0')}${String(fimData.getMinutes()).padStart(2, '0')}00`
      linhas.push(`DTSTART:${inicio}`, `DTEND:${fim}`)
    } else {
      linhas.push(`DTSTART;VALUE=DATE:${sem(dia)}`, `DTEND;VALUE=DATE:${sem(somarDias(dia, 1))}`)
    }
    linhas.push(`SUMMARY:${esc(a.titulo)}`, `CATEGORIES:${esc(a.tipo)}`)
    if (a.descricao) linhas.push(`DESCRIPTION:${esc(a.descricao)}`)
    linhas.push('END:VEVENT')
  }
  linhas.push('END:VCALENDAR')
  return linhas.join('\r\n')
}
