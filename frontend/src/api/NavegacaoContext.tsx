import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { confirmarSaida, temAlteracoesPendentes } from '../AlteracoesPendentes'

type NavegacaoContextValor = {
  abaAtiva: string
  versaoNavegacao: number
  irPara: (abaId: string, payload?: unknown) => void
  consumirPayload: <T>(abaId: string) => T | undefined
}

const NavegacaoContext = createContext<NavegacaoContextValor | null>(null)

function abaDaHash(abaInicial: string): string {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return hash || abaInicial
}

export function NavegacaoProvider({ children, abaInicial }: { children: ReactNode; abaInicial: string }) {
  const [abaAtiva, setAbaAtiva] = useState(() => abaDaHash(abaInicial))
  const [versaoNavegacao, setVersaoNavegacao] = useState(0)
  const payloads = useRef(new Map<string, unknown>())

  const abaAtual = useRef(abaAtiva)
  useEffect(() => { abaAtual.current = abaAtiva }, [abaAtiva])
  const restaurando = useRef(false)

  useEffect(() => {
    function aoMudarHash() {
      if (restaurando.current) { restaurando.current = false; return }
      const destino = abaDaHash(abaInicial)
      if (destino === abaAtual.current) return
      if (temAlteracoesPendentes()) {
        // Voltar do navegador ou link com alterações não salvas: desfaz a troca e pergunta.
        restaurando.current = true
        window.location.hash = `/${abaAtual.current}`
        confirmarSaida(() => { window.location.hash = `/${destino}` })
        return
      }
      setAbaAtiva(destino)
    }
    window.addEventListener('hashchange', aoMudarHash)
    return () => window.removeEventListener('hashchange', aoMudarHash)
  }, [abaInicial])

  const valor = useMemo<NavegacaoContextValor>(
    () => ({
      abaAtiva,
      versaoNavegacao,
      irPara: (abaId, payload) => confirmarSaida(() => {
        if (payload !== undefined) payloads.current.set(abaId, payload)
        setAbaAtiva(abaId)
        abaAtual.current = abaId
        setVersaoNavegacao(atual => atual + 1)
        if (window.location.hash.replace(/^#\/?/, '') !== abaId) window.location.hash = `/${abaId}`
      }),
      consumirPayload: <T,>(abaId: string) => {
        const valor = payloads.current.get(abaId) as T | undefined
        payloads.current.delete(abaId)
        return valor
      },
    }),
    [abaAtiva, versaoNavegacao],
  )

  return <NavegacaoContext.Provider value={valor}>{children}</NavegacaoContext.Provider>
}

export function useNavegacao() {
  const contexto = useContext(NavegacaoContext)
  if (!contexto) throw new Error('useNavegacao precisa estar dentro de <NavegacaoProvider>')
  return contexto
}
