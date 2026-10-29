import { useEffect, useRef, useState } from 'react'
import { HeaderGlobalAction, Search } from '@carbon/react'
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
  const raiz = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function aoClicarFora(ev: MouseEvent) {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberta(false)
    }
    document.addEventListener('click', aoClicarFora)
    return () => document.removeEventListener('click', aoClicarFora)
  }, [])

  async function abrir() {
    const abrindo = !aberta
    setAberta(abrindo)
    if (!abrindo || !cliente) return
    setCarregando(true)
    try {
      const [rc, rp] = await Promise.all([
        buscarJson<{ clientes: ClienteOpcao[] }>(cliente, '/clientes'),
        buscarJson<{ casos: CasoOpcao[] }>(cliente, '/casos'),
      ])
      setClientes(rc.clientes ?? [])
      setCasos(rp.casos ?? [])
    } catch {
      setClientes([])
      setCasos([])
    } finally {
      setCarregando(false)
    }
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
    <div ref={raiz} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <HeaderGlobalAction aria-label="Busca global" aria-expanded={aberta} onClick={abrir}>
        <IconeBusca size={20} />
      </HeaderGlobalAction>
      {aberta && (
        <div
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            top: '100%',
            inlineSize: '20rem',
            maxInlineSize: '90vw',
            background: 'var(--cds-layer, #f4f4f4)',
            boxShadow: '0 4px 8px rgba(0,0,0,.15)',
            padding: '0.75rem',
            zIndex: 8100,
          }}
        >
          <Search
            size="lg"
            labelText="Buscar cliente ou processo"
            placeholder="Nome, CPF/CNPJ ou número do processo"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
          />
          <div style={{ marginTop: '0.5rem', maxHeight: '16rem', overflowY: 'auto' }}>
            {carregando && <p>Carregando…</p>}
            {!carregando && consulta && clientesFiltrados.length === 0 && casosFiltrados.length === 0 && <p>Nenhum resultado.</p>}
            {clientesFiltrados.map((c) => (
              <button
                key={`cliente-${c.id}`}
                type="button"
                className="header-busca-resultado-item"
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
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
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => {
                  setAberta(false)
                  setTermo('')
                  irPara('casos', { id: c.id })
                }}
              >
                {formatarNomeExibicao(c.titulo || '(sem título)')} · Caso
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
