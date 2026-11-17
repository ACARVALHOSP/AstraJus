import { TRIBUNAL_MAP } from './numeroCnj'

/** Sigla do tribunal pelo código J.TR do número CNJ (sem exigir dígito verificador: serve para listas e filtros). */
export function siglaTribunalPorNumero(numero: string): string | null {
  const digitos = numero.replace(/\D/g, '')
  if (digitos.length === 20) return TRIBUNAL_MAP[digitos.substring(13, 16)] ?? null
  return null
}
