const CHAVE_HISTORICO = 'cnj_historico'
const CHAVE_FAVORITOS = 'cnj_favoritos'
const CHAVE_FAVORITOS_CASOS = 'cnj_favoritos_casos'
const HISTORICO_MAX = 10

export type Favorito = { tribunal: string; numero: string }
export type ItemHistorico = {
  tipo: 'processo' | 'publicacoes'
  args: Record<string, unknown>
  resumo: string
  quando: string
}

function lerLista<T>(chave: string): T[] {
  try {
    const bruto = localStorage.getItem(chave)
    const lista = bruto ? JSON.parse(bruto) : []
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

function salvarLista<T>(chave: string, lista: T[]): boolean {
  try {
    localStorage.setItem(chave, JSON.stringify(lista))
    return true
  } catch {
    return false
  }
}

export function lerHistorico(): ItemHistorico[] {
  return lerLista<ItemHistorico>(CHAVE_HISTORICO)
}

export function limparHistorico(): void {
  salvarLista(CHAVE_HISTORICO, [])
}

export function adicionarHistorico(item: Omit<ItemHistorico, 'quando'>): void {
  const lista = lerHistorico().filter((h) => h.resumo !== item.resumo || h.tipo !== item.tipo)
  lista.unshift({ ...item, quando: new Date().toISOString() })
  salvarLista(CHAVE_HISTORICO, lista.slice(0, HISTORICO_MAX))
}

export function lerFavoritos(): Favorito[] {
  return lerLista<Favorito>(CHAVE_FAVORITOS)
}

function chaveFavorito(tribunal: string, numero: string): string {
  return `${(tribunal || '').toLowerCase()}:${numero}`
}

export function ehFavorito(tribunal: string, numero: string): boolean {
  const chave = chaveFavorito(tribunal, numero)
  return lerFavoritos().some((f) => chaveFavorito(f.tribunal, f.numero) === chave)
}

export function alternarFavorito(tribunal: string, numero: string): boolean {
  const chave = chaveFavorito(tribunal, numero)
  const lista = lerFavoritos()
  const index = lista.findIndex((f) => chaveFavorito(f.tribunal, f.numero) === chave)
  if (index === -1) lista.unshift({ tribunal, numero })
  else lista.splice(index, 1)
  if (!salvarLista(CHAVE_FAVORITOS, lista)) return index !== -1
  return index === -1 // true = acabou de favoritar
}

export function removerFavorito(tribunal: string, numero: string): void {
  const chave = chaveFavorito(tribunal, numero)
  salvarLista(
    CHAVE_FAVORITOS,
    lerFavoritos().filter((f) => chaveFavorito(f.tribunal, f.numero) !== chave),
  )
}

export function lerCasosFavoritos(): string[] {
  return lerLista<string>(CHAVE_FAVORITOS_CASOS)
}

export function ehCasoFavorito(casoId: string): boolean {
  return lerCasosFavoritos().includes(casoId)
}

export function alternarCasoFavorito(casoId: string): boolean {
  const lista = lerCasosFavoritos()
  const index = lista.indexOf(casoId)
  if (index === -1) lista.unshift(casoId)
  else lista.splice(index, 1)
  if (!salvarLista(CHAVE_FAVORITOS_CASOS, lista)) return index !== -1
  return index === -1 // true = acabou de favoritar
}

export function formatarData(valor: string | undefined): string {
  if (!valor) return 'não informado'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return String(valor)
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
