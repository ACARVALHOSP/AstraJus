import { UFS } from '../api/ufs.ts'

export type Entendido = { tipo: 'processo'; numero: string } | { tipo: 'oab'; numero: string; uf: string }

/** Reconhece número de processo (20 dígitos, com ou sem pontuação) ou OAB ("123456/SP", "OAB 123456 SP"). */
export function interpretarConsulta(texto: string): Entendido | null {
  const t = texto.trim()
  if (!t) return null
  const digitos = t.replace(/\D/g, '')
  if (digitos.length === 20 && !/[a-z]{2}/i.test(t.replace(/oab/i, ''))) return { tipo: 'processo', numero: digitos }
  const m = /^(?:oab\s*)?(\d{1,6})\s*(?:[/\-\s]\s*([a-z]{2}))?$/i.exec(t)
  if (!m) return null
  const uf = (m[2] ?? '').toUpperCase()
  if (uf && !(UFS as readonly string[]).includes(uf)) return null
  return { tipo: 'oab', numero: m[1], uf }
}
