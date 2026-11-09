/** Polo do cliente no processo e destino das publicações (ver polos.py no servidor). */
export type Polo = 'ativo' | 'passivo' | 'terceiro'
export type PoloCliente = { cliente_id: string; nome: string; polo: Polo | null; origem: 'manual' | 'automatico' | null }
export type DestinoPublicacao = { tipo: 'cliente'; clientes: Array<{ id: string; nome: string; polo: 'ativo' | 'passivo' | null }> } | { tipo: 'contraria'; clientes: [] }

export const ROTULO_POLO: Record<Polo, string> = { ativo: 'Parte ativa', passivo: 'Parte passiva', terceiro: 'Terceiro' }
export const COR_POLO: Record<Polo, 'blue' | 'orange' | 'gray'> = { ativo: 'blue', passivo: 'orange', terceiro: 'gray' }
/** Forma curta usada dentro de selos: "ativa" / "passiva". */
export const POLO_CURTO: Record<string, string> = { ativo: 'ativa', passivo: 'passiva', terceiro: 'terceiro' }
