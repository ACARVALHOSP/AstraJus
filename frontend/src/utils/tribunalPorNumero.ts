// Espelha cnj.py (regra única no backend): análise do número CNJ, dígito verificador e sigla do
// índice da API pública do DataJud (api_publica_<sigla>). Mantenha as duas versões iguais.
const UFS = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc se sp to'.split(' ')
const TJM: Record<number, string> = { 13: 'tjmmg', 21: 'tjmrs', 26: 'tjmsp' }
const SUPERIORES: Record<string, string> = { '3': 'stj', '5': 'tst', '6': 'tse', '7': 'stm' }

function soDigitos(numero: string): string {
  return numero.replace(/\D/g, '')
}

/** Dígito verificador esperado (módulo 97): 98 - (NNNNNNNAAAAJTROOOO00 mod 97). */
export function dvCnjEsperado(numero: string): string | null {
  const d = soDigitos(numero)
  if (d.length !== 20) return null
  const base = d.slice(0, 7) + d.slice(9, 20) + '00'
  let resto = 0
  for (const c of base) resto = (resto * 10 + Number(c)) % 97
  return String(98 - resto).padStart(2, '0')
}

export function dvCnjValido(numero: string): boolean {
  const d = soDigitos(numero)
  return d.length === 20 && dvCnjEsperado(d) === d.slice(7, 9)
}

/** Mensagem de erro para o número informado; '' se estiver válido. */
export function erroNumeroCnj(numero: string): string {
  const d = soDigitos(numero)
  if (d.length !== 20) return `Número de processo inválido: esperados 20 dígitos, recebidos ${d.length}.`
  if (!dvCnjValido(d)) return `Número de processo inválido: dígito verificador incorreto (esperado ${dvCnjEsperado(d)}).`
  return ''
}

export function siglaTribunalPorNumero(numero: string): string | null {
  const d = soDigitos(numero)
  if (d.length !== 20) return null
  const j = d[13]
  const tr = Number(d.slice(14, 16))
  if (tr === 0) return SUPERIORES[j] ?? null
  if (j === '8' && tr >= 1 && tr <= 27) return tr === 7 ? 'tjdft' : `tj${UFS[tr - 1]}`
  if (j === '4' && tr >= 1 && tr <= 6) return `trf${tr}`
  if (j === '5' && tr >= 1 && tr <= 24) return `trt${tr}`
  if (j === '6' && tr >= 1 && tr <= 27) return `tre-${UFS[tr - 1]}`
  if (j === '9') return TJM[tr] ?? null
  return null
}
