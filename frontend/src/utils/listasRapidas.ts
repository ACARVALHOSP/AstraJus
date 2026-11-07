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

// Favoritos e histórico ficam no servidor, por usuário, para valerem em qualquer navegador.
// O localStorage é a cópia local usada na hora (leitura síncrona); cada gravação também vai ao
// servidor, e ao conectar a cópia do servidor substitui a local.
const NOMES_SERVIDOR: Record<string, string> = {
  [CHAVE_HISTORICO]: 'historico_consultas',
  [CHAVE_FAVORITOS]: 'favoritos_consultas',
  [CHAVE_FAVORITOS_CASOS]: 'favoritos_casos',
}
export const EVENTO_PREFERENCIAS = 'astrajus:preferencias'
let tokenServidor: string | null = null
const envios = new Map<string, number>()

function enviarAoServidor<T>(chave: string, lista: T[]) {
  const nome = NOMES_SERVIDOR[chave]
  const token = tokenServidor
  if (!token || !nome) return
  window.clearTimeout(envios.get(chave))
  envios.set(chave, window.setTimeout(() => {
    fetch(`/preferencias/${nome}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor: lista }),
    }).catch(() => { /* fica a cópia local; a próxima gravação tenta de novo */ })
  }, 400))
}

function gravarLocal<T>(chave: string, lista: T[]): boolean {
  try {
    localStorage.setItem(chave, JSON.stringify(lista))
    return true
  } catch {
    return false
  }
}

function salvarLista<T>(chave: string, lista: T[]): boolean {
  const ok = gravarLocal(chave, lista)
  enviarAoServidor(chave, lista)
  return ok
}

/** Ao conectar: traz favoritos e histórico do servidor. Favoritos deste navegador que ainda não
 * estão lá são somados e enviados (migração do que era só local). */
export async function sincronizarPreferencias(token: string | null): Promise<void> {
  tokenServidor = token
  if (!token) return
  try {
    const resposta = await fetch('/preferencias', { headers: { Authorization: `Bearer ${token}` } })
    if (!resposta.ok) return
    const { preferencias } = await resposta.json() as { preferencias?: Record<string, unknown> }
    for (const [chave, nome] of Object.entries(NOMES_SERVIDOR)) {
      const doServidor = preferencias?.[nome]
      const local = lerLista<unknown>(chave)
      if (!Array.isArray(doServidor)) {
        if (local.length) enviarAoServidor(chave, local)
        continue
      }
      if (chave === CHAVE_HISTORICO) {
        gravarLocal(chave, doServidor)
        continue
      }
      const vistos = new Set(doServidor.map(v => JSON.stringify(v)))
      const somados = [...doServidor, ...local.filter(v => !vistos.has(JSON.stringify(v)))]
      gravarLocal(chave, somados)
      if (somados.length !== doServidor.length) enviarAoServidor(chave, somados)
    }
    window.dispatchEvent(new Event(EVENTO_PREFERENCIAS))
  } catch {
    // Sem servidor, segue com a cópia local.
  }
}

export function lerHistorico(): ItemHistorico[] {
  return lerLista<ItemHistorico>(CHAVE_HISTORICO)
}

export function limparHistorico(): void {
  salvarLista(CHAVE_HISTORICO, [])
}

export function removerHistorico(quando: string): void {
  salvarLista(CHAVE_HISTORICO, lerHistorico().filter((h) => h.quando !== quando))
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
