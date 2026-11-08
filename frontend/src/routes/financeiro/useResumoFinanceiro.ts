import { useCallback, useEffect, useState } from 'react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import type { ResumoFinanceiro } from './dadosResumo'

type Nome = { id: string; nome?: string; titulo?: string }
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Carrega o resumo financeiro e os nomes de clientes e processos usados nas duas visões. */
export function useResumoFinanceiro() {
  const { cliente } = useCliente()
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null)
  const [clientes, setClientes] = useState<Nome[]>([])
  const [casos, setCasos] = useState<Nome[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const [r, c, p] = await Promise.all([
        buscarJson<ResumoFinanceiro>(cliente, `/lancamentos/resumo?hoje=${hojeLocal()}`),
        buscarJson<{ clientes: Nome[] }>(cliente, '/clientes'),
        buscarJson<{ casos: Nome[] }>(cliente, '/casos'),
      ])
      setResumo(r); setClientes(c.clientes ?? []); setCasos(p.casos ?? [])
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar o financeiro. Tente de novo.')
    } finally { setCarregando(false) }
  }, [cliente])
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
  }, [carregar])

  const nomeCliente = (id?: string) => formatarNomeExibicao(clientes.find(c => c.id === id)?.nome ?? '') || '—'
  const tituloCaso = (id?: string) => formatarNomeExibicao(casos.find(c => c.id === id)?.titulo ?? '') || 'Processo sem título'
  return { resumo, carregando, erro, carregar, nomeCliente, tituloCaso }
}
