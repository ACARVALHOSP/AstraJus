import { useQuery } from '@tanstack/react-query'
import { useCliente } from './ClienteContext'
import { buscarJson } from './rest'

// Consultas compartilhadas entre telas: a mesma chave reaproveita o cache. A chave inclui o token
// para nunca misturar dados de sessões diferentes.
export function useClientes<T = { id: string; nome?: string }>({ enabled = true }: { enabled?: boolean } = {}) {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['clientes', cliente?.token],
    enabled,
    queryFn: ({ signal }) => buscarJson<{ clientes: T[] }>(cliente, '/clientes', signal).then(r => r.clientes ?? []),
  })
}

export function useLancamentos<T = { id: string }>() {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['lancamentos', cliente?.token],
    queryFn: ({ signal }) => buscarJson<{ lancamentos: T[] }>(cliente, '/lancamentos', signal).then(r => r.lancamentos ?? []),
  })
}

// Cadastro de responsáveis: complementar (só alimenta filtros), por isso erros ficam sem opções.
export function useResponsaveis() {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['responsaveis', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis', signal).then(r => r.responsaveis ?? []),
  })
}

export function useCasos<T = { id: string }>({ enabled = true }: { enabled?: boolean } = {}) {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['casos', cliente?.token],
    enabled,
    queryFn: ({ signal }) => buscarJson<{ casos: T[] }>(cliente, '/casos', signal).then(r => r.casos ?? []),
  })
}
