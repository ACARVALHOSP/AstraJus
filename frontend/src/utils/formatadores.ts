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
