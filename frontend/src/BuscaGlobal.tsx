import Carregamento from './Carregamento'
import { useState } from 'react'
import { Button, Flex, IconButton, Popover, Text, TextField } from '@radix-ui/themes'
import { Search } from 'lucide-react'
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

  function onOpenChange(aberto: boolean) {
    setAberta(aberto)
    if (aberto) void carregar()
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
    <Popover.Root open={aberta} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <IconButton className="aj-ib" variant="ghost" aria-label="Busca global">
          <Search size={17} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="360px" align="end">
        <Flex direction="column" gap="3" role="region" aria-label="Busca global">
          <TextField.Root
            size="2"
            placeholder="Nome, CPF/CNPJ ou número do processo"
            aria-label="Buscar cliente ou processo"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
          >
            <TextField.Slot><Search size={14} /></TextField.Slot>
          </TextField.Root>
          {carregando && <Carregamento tipo="texto" descricao="Consultando…" />}
          {erro && (
            <Flex direction="column" gap="2" role="alert">
              <Text size="2" color="red">{erro}</Text>
              <Button variant="ghost" size="1" onClick={carregar}>Tentar novamente</Button>
            </Flex>
          )}
          {!erro && !carregando && consulta && clientesFiltrados.length === 0 && casosFiltrados.length === 0 && (
            <Text size="2" color="gray">Nenhum resultado.</Text>
          )}
          {clientesFiltrados.map((c) => (
            <Popover.Close key={`cliente-${c.id}`}>
              <button
                type="button"
                className="aj-busca-item"
                onClick={() => { setTermo(''); irPara('contatos', { id: c.id }) }}
              >
                {formatarNomeExibicao(c.nome || '(sem nome)')} · Cliente
              </button>
            </Popover.Close>
          ))}
          {casosFiltrados.map((c) => (
            <Popover.Close key={`caso-${c.id}`}>
              <button
                type="button"
                className="aj-busca-item"
                onClick={() => { setTermo(''); irPara('casos', { id: c.id }) }}
              >
                {formatarNomeExibicao(c.titulo || '(sem título)')} · Processo
              </button>
            </Popover.Close>
          ))}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  )
}
