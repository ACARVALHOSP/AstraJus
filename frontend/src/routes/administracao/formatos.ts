/** "há 5 min", "há 3 h", "ontem", "há 2 dias", "há 3 meses". Sem data: "Nunca acessou". */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return 'Nunca acessou'
  const quando = new Date(iso)
  if (Number.isNaN(quando.getTime())) return 'Não registrado'
  const segundos = Math.floor((agora.getTime() - quando.getTime()) / 1000)
  if (segundos < 60) return 'agora há pouco'          // também cobre relógios levemente adiantados
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  if (horas < 48) return 'ontem'
  const dias = Math.floor(horas / 24)
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const anos = Math.floor(meses / 12)
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`
}

/** Lê um valor por hora digitado ("300", "300,50", "1.250,00"). Vazio: null (sem valor). Inválido: undefined. */
export function lerValorHora(texto: string): number | null | undefined {
  const t = texto.trim().replace(/^R\$\s*/i, '')
  if (t === '') return null
  const normalizado = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return undefined
  const n = Number(normalizado)
  return n > 0 && n <= 100000 ? n : undefined
}
