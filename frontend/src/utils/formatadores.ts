export function formatarDataSimples(valor: unknown): string {
  if (!valor) return 'não informado'
  const bruto = String(valor).replace(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/, '$1-$2-$3')
  // Data pura ("AAAA-MM-DD", sem hora): formata direto dos componentes. O construtor Date trata
  // esse formato como meia-noite UTC, e em fusos atrás de UTC (ex.: Brasília, UTC-3)
  // toLocaleDateString devolveria o dia anterior.
  const somenteData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto)
  if (somenteData) {
    const [, ano, mes, dia] = somenteData
    return `${dia}/${mes}/${ano}`
  }
  const data = new Date(bruto)
  if (Number.isNaN(data.getTime())) return bruto
  return data.toLocaleDateString('pt-BR')
}

export function formatarNumeroCNJ(valor: unknown): string {
  return String(valor || '').replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')
}

export function ddmmaaaaParaIso(valor: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((valor || '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

export function formatarReais(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatarPercentual(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-'
  return valor.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1 })
}

export function formatarDdMmAaaa(data: Date): string {
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${data.getFullYear()}`
}
