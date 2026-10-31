/** Calendar providers can add municipal holidays, court suspensions and official acts.
 * Completeness is explicit: an empty list must never imply a verified calendar. */
export type CalendarioForense = {
  municipio: string; tribunal: string; anos: number[]; fonte: string; consultadoEm: string
  completo: boolean; impedimentos: Array<{ inicio: string; fim: string; descricao: string; fonte?: string; tipo?: 'feriado' | 'suspensao' }>
}
export type ContextoCalendario = { municipio: string; tribunal: string; anos: number[] }
export type ProvedorCalendario = (contexto: ContextoCalendario) => Promise<CalendarioForense>
export type RegraPrazo = 'dje' | 'inicio'
export const REGRAS_PRAZO: Record<RegraPrazo, string> = {
  dje: 'Dias úteis — disponibilização DJEN → publicação → início da contagem',
  inicio: 'Dias úteis — termo inicial informado conta como primeiro dia útil',
}
export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso
}
const somar = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
export function detectarDias(texto: string): number | null {
  // Only an explicit, unique duration; no default deadline or inference by action type.
  if (/dias\s+corridos/iu.test(texto)) return null
  const valores = [...texto.matchAll(/prazo\s+(?:de\s+)?(\d{1,3})(?:\s*\([^)]{1,30}\))?\s+dias\b/giu)].map(m => Number(m[1]))
  const unicos = [...new Set(valores)]
  return unicos.length === 1 && unicos[0] > 0 ? unicos[0] : null
}
export function calcularPrazo(base: string, dias: number, regra: RegraPrazo, calendario: CalendarioForense, suspensaoCpc: boolean) {
  if (!dataValida(base) || !Number.isInteger(dias) || dias < 1 || dias > 999 || !REGRAS_PRAZO[regra]) throw new Error('Informe data, regra e prazo entre 1 e 999 dias.')
  const linhas: Array<{ data: string; evento: string; dia: number | null }> = []
  function impedimento(iso: string, contagem = true): string | null {
    const dia = new Date(`${iso}T12:00:00Z`).getUTCDay()
    if (dia === 0 || dia === 6) return 'Fim de semana'
    if (contagem && suspensaoCpc && (iso.slice(5) >= '12-20' || iso.slice(5) <= '01-20')) return 'Suspensão de 20/12 a 20/01 (regra CPC selecionada)'
    return calendario.impedimentos.find(i => (contagem || i.tipo !== 'suspensao') && iso >= i.inicio && iso <= i.fim)?.descricao || null
  }
  let atual = base, passos = 0
  function proximoUtil(incluir: boolean, contagem = true) {
    if (!incluir) atual = somar(atual)
    while (impedimento(atual, contagem)) {
      if (++passos > 10000) throw new Error('Calendário sem dia útil disponível no intervalo.')
      linhas.push({ data: atual, evento: impedimento(atual, contagem)!, dia: null }); atual = somar(atual)
    }
  }
  if (regra === 'dje') {
    linhas.push({ data: base, evento: 'Disponibilização DJEN', dia: null })
    proximoUtil(false, false); linhas.push({ data: atual, evento: 'Publicação', dia: null }); proximoUtil(false)
  } else proximoUtil(true)
  const termoInicial = atual
  for (let dia = 1; dia <= dias; dia++) {
    if (dia > 1) proximoUtil(false)
    linhas.push({ data: atual, evento: dia === dias ? 'Vencimento' : dia === 1 ? 'Início da contagem' : 'Contagem', dia })
  }
  const anos = [...new Set(linhas.map(l => Number(l.data.slice(0, 4))))]
  return { termoInicial, dataFinal: atual, linhas, pendenteRevisao: !calendario.completo || anos.some(a => !calendario.anos.includes(a)) }
}
