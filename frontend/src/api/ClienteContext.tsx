import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CHAVE_TOKEN, ClienteMCP } from './mcpClient'

type StatusConexao = 'sem-token' | 'verificando' | 'conectado' | 'nao-conectado'

type ClienteContextValor = {
  cliente: ClienteMCP | null
  status: StatusConexao
  conectar: (token: string, lembrar: boolean) => Promise<void>
  esquecer: () => void
}

const ClienteContext = createContext<ClienteContextValor | null>(null)

export function ClienteProvider({ children }: { children: ReactNode }) {
  const [cliente, setCliente] = useState<ClienteMCP | null>(null)
  const [status, setStatus] = useState<StatusConexao>('sem-token')

  const conectar = useCallback(async (token: string, lembrar: boolean) => {
    setStatus('verificando')
    setCliente(null)
    const candidato = new ClienteMCP(token)
    try {
      await candidato.iniciar()
      setCliente(candidato)
      setStatus('conectado')
      try {
        if (lembrar) localStorage.setItem(CHAVE_TOKEN, token)
        else localStorage.removeItem(CHAVE_TOKEN)
      } catch {
        // armazenamento indisponível: segue conectado só nesta sessão
      }
    } catch (erro) {
      setCliente(null)
      setStatus('nao-conectado')
      try {
        localStorage.removeItem(CHAVE_TOKEN)
      } catch {
        // armazenamento indisponível
      }
      throw erro
    }
  }, [])

  const esquecer = useCallback(() => {
    try {
      localStorage.removeItem(CHAVE_TOKEN)
    } catch {
      // armazenamento indisponível
    }
    setCliente(null)
    setStatus('sem-token')
  }, [])

  const valor = useMemo(() => ({ cliente, status, conectar, esquecer }), [cliente, status, conectar, esquecer])

  return <ClienteContext.Provider value={valor}>{children}</ClienteContext.Provider>
}

export function useCliente() {
  const contexto = useContext(ClienteContext)
  if (!contexto) throw new Error('useCliente precisa estar dentro de <ClienteProvider>')
  return contexto
}
