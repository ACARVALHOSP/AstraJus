import { useQuery } from '@tanstack/react-query'
import { useCliente } from '../../api/ClienteContext'
import { useCasos, useClientes } from '../../api/consultas'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import type { ResumoFinanceiro } from './dadosResumo'

type Nome = { id: string; nome?: string; titulo?: string }
const SEM_NOMES: Nome[] = []
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Carrega o resumo financeiro e os nomes de clientes e processos usados nas duas visões. */
export function useResumoFinanceiro() {
  const { cliente } = useCliente()
  const hoje = hojeLocal()
  const consultaResumo = useQuery({
    queryKey: ['lancamentos', 'resumo', cliente?.token, hoje],
    queryFn: ({ signal }) => buscarJson<ResumoFinanceiro>(cliente, `/lancamentos/resumo?hoje=${hoje}`, signal),
  })
  const consultaClientes = useClientes<Nome>()
  const consultaCasos = useCasos<Nome>()
  const consultas = [consultaResumo, consultaClientes, consultaCasos]

  const carregando = consultas.some(c => c.isPending)
  const resumo = consultaResumo.data ?? null
  const clientes = consultaClientes.data ?? SEM_NOMES
  const casos = consultaCasos.data ?? SEM_NOMES
  const falha = consultas.find(c => c.error)?.error
  const erro = falha ? (falha instanceof ErroMCP ? falha.message : 'Não foi possível carregar o financeiro. Tente de novo.') : ''
  const carregar = async () => { await Promise.all(consultas.map(c => c.refetch())) }

  const nomeCliente = (id?: string) => formatarNomeExibicao(clientes.find(c => c.id === id)?.nome ?? '') || '—'
  const tituloCaso = (id?: string) => formatarNomeExibicao(casos.find(c => c.id === id)?.titulo ?? '') || 'Processo sem título'
  return { resumo, carregando, erro, carregar, nomeCliente, tituloCaso }
}
