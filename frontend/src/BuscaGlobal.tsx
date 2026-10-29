import { usePainelShell } from './usePainelShell'
import { useState } from 'react'
import { Button, HeaderGlobalAction, Search } from '@carbon/react'
import { Search as IconeBusca } from '@carbon/icons-react'
import { useCliente } from './api/ClienteContext'
import { useNavegacao } from './api/NavegacaoContext'
import { buscarJson } from './api/rest'
import { formatarNomeExibicao } from './utils/formatadores'

type ClienteOpcao = { id: string; nome?: string; cpf_cnpj?: string }
type CasoOpcao = { id: string; titulo?: string; processos?: string[] }

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export default function BuscaGlobal() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [aberta, setAberta] = useState(false)
  const [termo, setTermo] = useState('')
  const [clientes, setClientes] = useState<ClienteOpcao[]>([])
  const [casos, setCasos] = useState<CasoOpcao[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const raiz = usePainelShell(aberta, () => setAberta(false))


  async function carregar() {
    setErro(null)
    if (!cliente) { setErro('Conecte-se para buscar clientes e processos.'); return }
    setCarregando(true)
    try {
      const [rc, rp] = await Promise.all([
        buscarJson<{ clientes: ClienteOpcao[] }>(cliente, '/clientes'),
        buscarJson<{ casos: CasoOpcao[] }>(cliente, '/casos'),
      ])
      setClientes(rc.clientes ?? [])
      setCasos(rp.casos ?? [])
    } catch {
      setErro('Não foi possível carregar a busca. Tente novamente.')
      setClientes([])
      setCasos([])
    } finally {
      setCarregando(false)
    }
  }

  function abrir() {
    setAberta(!aberta)
    if (!aberta) void carregar()
  }

  const consulta = normalizar(termo)
  const digitos = consulta.replace(/\D/g, '')
  const clientesFiltrados = consulta
    ? clientes.filter(
        (c) => normalizar(c.nome || '').includes(consulta) || (digitos && (c.cpf_cnpj || '').replace(/\D/g, '').includes(digitos)),
      ).slice(0, 8)
    : []
  const casosFiltrados = consulta
    ? casos.filter(
        (c) => normalizar(c.titulo || '').includes(consulta) || (c.processos ?? []).some((p) => p.replace(/\D/g, '').includes(digitos) && digitos),
      ).slice(0, 8)
    : []

  return (
    <div ref={raiz} className="shell-action">
      <HeaderGlobalAction aria-label="Busca global" aria-expanded={aberta} onClick={abrir}>
        <IconeBusca size={20} />
      </HeaderGlobalAction>
      {aberta && (
        <div className="shell-panel" role="region" aria-label="Busca global">
          <Search
            size="lg"
            labelText="Buscar cliente ou processo"
            placeholder="Nome, CPF/CNPJ ou número do processo"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
          />
          <div className="aj-layout-1">
            {carregando && <p role="status">Carregando…</p>}
            {erro && <div role="alert"><p>{erro}</p><Button kind="ghost" size="sm" onClick={carregar}>Tentar novamente</Button></div>}
            {!erro && !carregando && consulta && clientesFiltrados.length === 0 && casosFiltrados.length === 0 && <p>Nenhum resultado.</p>}
            {clientesFiltrados.map((c) => (
              <button
                key={`cliente-${c.id}`}
                type="button"
                className="header-busca-resultado-item"
                onClick={() => {
                  setAberta(false)
                  setTermo('')
                  irPara('contatos', { id: c.id })
                }}
              >
                {formatarNomeExibicao(c.nome || '(sem nome)')} · Cliente
              </button>
            ))}
            {casosFiltrados.map((c) => (
              <button
                key={`caso-${c.id}`}
                type="button"
                className="header-busca-resultado-item"
                onClick={() => {
                  setAberta(false)
                  setTermo('')
                  irPara('casos', { id: c.id })
                }}
              >
                {formatarNomeExibicao(c.titulo || '(sem título)')} · Processo
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
