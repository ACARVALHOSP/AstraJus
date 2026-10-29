import { useEffect, useState } from 'react'
import { Button, InlineNotification, Modal, Stack, Tag, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'

export type Caso = {
  id: string
  titulo?: string
  status?: string
  processos?: string[]
  cliente_id?: string
  clientes_adicionais?: string[]
  acao?: string
  foro?: string
  responsavel?: string
  pasta?: string
  acesso?: string
  ultima_movimentacao?: string
  monitorado?: boolean
  desfecho?: string
}

type Cliente = { id: string; nome?: string }

const ROTULO_DESFECHO: Record<string, string> = {
  procedente: 'Procedente',
  procedente_parcial: 'Parc. procedente',
  improcedente: 'Improcedente',
  acordo: 'Acordo',
  extinto: 'Extinto s/ mérito',
  provido: 'Provido',
  desprovido: 'Desprovido',
}

function formatarClasse(valor?: string): string {
  const siglas = new Set(['CNJ', 'STF', 'STJ', 'TST', 'TRT', 'TRF', 'TJ', 'OAB', 'INSS', 'FGTS', 'ICMS', 'IPI', 'IPTU', 'ISS', 'IRPF', 'IRPJ', 'CPC', 'CPP', 'CLT', 'CDC', 'ECA', 'CTN', 'JEC', 'JEFAZ'])
  return String(valor || '')
    .split(' - ')
    .map((parte) => {
      const texto = parte
        .trim()
        .toLocaleLowerCase('pt-BR')
        .replace(/\p{L}+/gu, (palavra) => (siglas.has(palavra.toLocaleUpperCase('pt-BR')) ? palavra.toLocaleUpperCase('pt-BR') : palavra))
      return texto.replace(/^\p{L}/u, (letra) => letra.toLocaleUpperCase('pt-BR'))
    })
    .filter(Boolean)
    .join(' · ')
}

export default function ListaCasos({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [casos, setCasos] = useState<Caso[] | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [busca, setBusca] = useState('')
  const [paraExcluir, setParaExcluir] = useState<Caso | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro(null)
    Promise.all([
      buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes'),
    ])
      .then(([respCasos, respClientes]) => {
        setCasos(respCasos.casos ?? [])
        setClientes(respClientes.clientes ?? [])
      })
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [cliente])

  const nomeCliente = (id?: string) => clientes.find((c) => c.id === id)?.nome ?? id ?? ''

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${paraExcluir.id}`, {}, 'DELETE')
      setCasos((atual) => atual?.filter((c) => c.id !== paraExcluir.id) ?? null)
      setParaExcluir(null)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const termo = busca.toLowerCase().trim()
  const filtrados = (casos ?? []).filter((c) => {
    if (!termo) return true
    const textos = [c.titulo, c.acao, c.foro, c.responsavel, nomeCliente(c.cliente_id), ...(c.clientes_adicionais ?? []).map(nomeCliente), ...(c.processos ?? [])].map(
      (t) => (t || '').toLowerCase(),
    )
    return textos.some((t) => t.includes(termo))
  })
  const ordenados = [...filtrados].sort((a, b) => (b.ultima_movimentacao || '').localeCompare(a.ultima_movimentacao || ''))

  return (
    <Stack gap={6}>
      <div>
        <h2>Processos</h2>
      </div>
      <TextInput
        id="casos-busca"
        labelText="Filtrar processos"
        placeholder="Filtrar processos"
        helperText="Filtre por título, cliente, classe/ação, órgão julgador, responsável ou número do processo."
        autoComplete="off"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <div aria-live="polite">
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && casos && casos.length === 0 && <InlineNotification kind="info" title="Nenhum processo cadastrado ainda" lowContrast hideCloseButton />}
        {!carregando && casos && casos.length > 0 && ordenados.length === 0 && (
          <InlineNotification kind="info" title="Nenhum processo corresponde ao filtro." lowContrast hideCloseButton />
        )}
        {!carregando && ordenados.length > 0 && (
          <div className="tabela-responsiva-wrap">
            <table className="tabela-responsiva tabela-casos">
              <thead>
                <tr>
                  <th>Título</th>
                  <th>Cliente/Pasta</th>
                  <th>Ação/Foro</th>
                  <th>Últ. mov.</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((caso) => {
                  const nomes = [caso.cliente_id, ...(caso.clientes_adicionais ?? [])].map(nomeCliente).filter(Boolean).map(formatarNomeExibicao)
                  return (
                    <tr key={caso.id}>
                      <td data-label="Título">
                        <button type="button" className="contato-nome-link" onClick={() => onAbrir(caso.id)}>
                          {caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)'}
                        </button>
                        {caso.monitorado && <Tag type="green" size="sm">Monitorado</Tag>}
                        {caso.desfecho && ROTULO_DESFECHO[caso.desfecho] && (
                          <Tag type="purple" size="sm">
                            {ROTULO_DESFECHO[caso.desfecho]}
                          </Tag>
                        )}
                        <div>{(caso.processos ?? []).join(', ')}</div>
                      </td>
                      <td data-label="Cliente/Pasta">
                        {nomes.join(', ') || 'Sem cliente vinculado'}
                        {caso.pasta ? ` · ${caso.pasta}` : ''}
                      </td>
                      <td data-label="Ação/Foro">
                        {formatarClasse(caso.acao) || 'Classe não informada'}
                        {caso.foro ? ` · ${caso.foro}` : ''}
                      </td>
                      <td data-label="Últ. mov.">{formatarDataSimples(caso.ultima_movimentacao)}</td>
                      <td data-label="Ações">
                        <Button kind="danger--tertiary" size="sm" onClick={() => setParaExcluir(caso)}>
                          Excluir
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir processo"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir o processo "{paraExcluir?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.</p>
      </Modal>
    </Stack>
  )
}
