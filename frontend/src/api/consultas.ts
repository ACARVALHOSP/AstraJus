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

export function useCasos<T = { id: string }>({ enabled = true }: { enabled?: boolean } = {}) {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['casos', cliente?.token],
    enabled,
    queryFn: ({ signal }) => buscarJson<{ casos: T[] }>(cliente, '/casos', signal).then(r => r.casos ?? []),
  })
}
