import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type NavegacaoContextValor = {
  abaAtiva: string
  irPara: (abaId: string, payload?: unknown) => void
  consumirPayload: <T>(abaId: string) => T | undefined
}

const NavegacaoContext = createContext<NavegacaoContextValor | null>(null)

export function NavegacaoProvider({ children, abaInicial }: { children: ReactNode; abaInicial: string }) {
  const [abaAtiva, setAbaAtiva] = useState(abaInicial)
  const payloads = useRef(new Map<string, unknown>())

  const valor = useMemo<NavegacaoContextValor>(
    () => ({
      abaAtiva,
      irPara: (abaId, payload) => {
        if (payload !== undefined) payloads.current.set(abaId, payload)
        setAbaAtiva(abaId)
      },
      consumirPayload: <T,>(abaId: string) => {
        const valor = payloads.current.get(abaId) as T | undefined
        payloads.current.delete(abaId)
        return valor
      },
    }),
    [abaAtiva],
  )

  return <NavegacaoContext.Provider value={valor}>{children}</NavegacaoContext.Provider>
}

export function useNavegacao() {
  const contexto = useContext(NavegacaoContext)
  if (!contexto) throw new Error('useNavegacao precisa estar dentro de <NavegacaoProvider>')
  return contexto
}
