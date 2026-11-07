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

export function formatarMoeda(valor: unknown): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatarPercentual(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-'
  return valor.toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1 })
}

// Palavras curtas que permanecem minúsculas no meio de nomes e títulos (ex.: "Ação de Obrigação de Fazer").
const PARTICULAS = new Set(['a', 'à', 'ao', 'aos', 'as', 'às', 'com', 'contra', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'sem', 'x'])
// Siglas societárias e institucionais preservadas em maiúsculas.
const SIGLAS = new Set(['me', 'epp', 'eireli', 'sa', 'cpf', 'cnpj', 'oab', 'inss', 'tjsp', 'stj', 'stf', 'trf', 'trt', 'mei', 'ltda'])

export function formatarNomeExibicao(valor: unknown): string {
  let primeira = true
  return String(valor ?? '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[\p{L}\p{N}]+/gu, (palavra: string) => {
      const inicio = primeira
      primeira = false
      if (SIGLAS.has(palavra)) return palavra === 'ltda' ? 'Ltda' : palavra.toLocaleUpperCase('pt-BR')
      if (!inicio && PARTICULAS.has(palavra)) return palavra
      return palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1)
    })
    .replace(/\bS\/a\b/g, 'S/A')
}

export function formatarDdMmAaaa(data: Date): string {
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${data.getFullYear()}`
}

/** Distância em dias entre duas datas ISO (AAAA-MM-DD…), considerando só o dia. */
export function diasEntreDatas(deIso: string, ateIso: string): number {
  const [a, b] = [deIso, ateIso].map(v => { const [y, m, d] = v.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / 86_400_000)
}

/** Data de hoje no fuso local, AAAA-MM-DD. */
export function hojeIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
