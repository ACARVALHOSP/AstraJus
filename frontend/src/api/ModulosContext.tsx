import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCliente } from './ClienteContext'
import { buscarJson, enviarJson } from './rest'

export type Modulo = {
  id: string
  nome: string
  descricao: string
  versao: string
  aba: { id: string; rotulo: string; grupo: string; icone: string }
  area_permissao: string
  dependencias: string[]
  dependentes_ativos: string[]
  ferramentas: string[]
  tabelas: string[]
  ativo: boolean
}

type Valor = {
  modulos: Modulo[]
  /** False até o servidor responder (com ou sem erro): evita tratar um link de módulo como tela inexistente. */
  carregado: boolean
  alternar: (id: string, ativo: boolean) => Promise<void>
  recarregar: () => Promise<void>
}

const ModulosContext = createContext<Valor | null>(null)

export function ModulosProvider({ children }: { children: ReactNode }) {
  const { cliente } = useCliente()
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [carregado, setCarregado] = useState(false)

  const recarregar = useCallback(async () => {
    const dados = await buscarJson<{ modulos: Modulo[] }>(cliente, '/modulos')
    setModulos(dados.modulos)
  }, [cliente])

  useEffect(() => {
    setModulos([])
    if (!cliente) { setCarregado(false); return }
    let atual = true
    setCarregado(false)
    void recarregar().catch(() => { /* sem módulos: só o núcleo aparece */ }).finally(() => { if (atual) setCarregado(true) })
    return () => { atual = false }
  }, [cliente, recarregar])

  const alternar = useCallback(async (id: string, ativo: boolean) => {
    await enviarJson(cliente, `/modulos/${encodeURIComponent(id)}`, { ativo }, 'PATCH')
    await recarregar()
  }, [cliente, recarregar])

  const valor = useMemo(() => ({ modulos, carregado, alternar, recarregar }), [modulos, carregado, alternar, recarregar])
  return <ModulosContext.Provider value={valor}>{children}</ModulosContext.Provider>
}

export function useModulos(): Valor {
  const v = useContext(ModulosContext)
  if (!v) throw new Error('useModulos fora do ModulosProvider')
  return v
}
