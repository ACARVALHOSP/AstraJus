import { useQuery } from '@tanstack/react-query'
import { useCliente } from './ClienteContext'
import { buscarJson } from './rest'
import { formatarNomeExibicao } from '../utils/formatadores'

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

export function useLancamentos<T = { id: string }>({ enabled = true }: { enabled?: boolean } = {}) {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['lancamentos', cliente?.token],
    enabled,
    queryFn: ({ signal }) => buscarJson<{ lancamentos: T[] }>(cliente, '/lancamentos', signal).then(r => r.lancamentos ?? []),
  })
}

// Cadastro de responsáveis: complementar (só alimenta filtros), por isso erros ficam sem opções.
function useCadastroResponsaveis<T>(select: (r: { responsaveis: string[]; nomes: Record<string, string> }) => T) {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['responsaveis', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ responsaveis?: string[]; nomes?: Record<string, string> }>(cliente, '/responsaveis', signal)
      .then(r => ({ responsaveis: r.responsaveis ?? [], nomes: r.nomes ?? {} })),
    select,
  })
}

export function useResponsaveis() {
  return useCadastroResponsaveis(r => r.responsaveis)
}

/** Devolve o nome da pessoa a partir do login (e-mail); sem cadastro, formata o texto recebido. */
export function useNomePessoa(): (login: string | null | undefined) => string {
  const nomes = useCadastroResponsaveis(r => r.nomes).data
  return login => (login ? nomes?.[login] ?? formatarNomeExibicao(login) : '')
}

/** Sugestão de responsável pelas regras do escritório (vazia com a rotina desligada). Só sugere; não grava. */
export function useSugestaoResponsavel({ publicacao, clienteId, enabled = true }: { publicacao?: string; clienteId?: string; enabled?: boolean }) {
  const { cliente } = useCliente()
  const params = new URLSearchParams()
  if (publicacao) params.set('publicacao', publicacao)
  if (clienteId) params.set('cliente_id', clienteId)
  return useQuery({
    queryKey: ['sugestao-responsavel', cliente?.token, publicacao ?? '', clienteId ?? ''],
    enabled: Boolean(cliente) && enabled,
    retry: false,
    queryFn: ({ signal }) => buscarJson<{ responsavel?: string; motivo?: string }>(cliente, `/responsaveis/sugestao?${params}`, signal),
  })
}

export type Rascunho = {
  id: string; titulo: string | null; responsavel: string | null; cliente_id: string; cliente: string
  processos: string[]; criado_em: string | null; publicacao: string | null; motivo: string | null
}

/** Processos criados sozinhos a partir de publicações, à espera de confirmação. Falha vira lista vazia. */
export function useRascunhos() {
  const { cliente } = useCliente()
  return useQuery({
    queryKey: ['rascunhos', cliente?.token],
    enabled: Boolean(cliente),
    retry: false,
    queryFn: ({ signal }) => buscarJson<{ rascunhos?: Rascunho[] }>(cliente, '/rascunhos', signal).then(r => r.rascunhos ?? []),
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
