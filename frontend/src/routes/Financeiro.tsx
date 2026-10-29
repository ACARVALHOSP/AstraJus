import Carregamento from '../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  DataTable,
  InlineNotification,
  Modal,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'
import NovoLancamentoModal from './financeiro/NovoLancamentoModal'

type Lancamento = {
  id: string
  vencimento?: string
  valor?: number
  descricao: string
  recorrente?: boolean
  cliente_id?: string
  caso_id?: string
  responsavel?: string
  direcao: 'DESPESA' | 'RECEITA'
  pago: boolean
  asaas_cobranca_id?: string
}

type Cliente = { id: string; nome?: string }
type Caso = { id: string; titulo?: string }

export default function Financeiro() {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [casos, setCasos] = useState<Caso[]>([])
  const [paraExcluir, setParaExcluir] = useState<Lancamento | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [respLancamentos, respClientes, respCasos] = await Promise.all([
        buscarJson<{ lancamentos: Lancamento[] }>(cliente, '/lancamentos'),
        buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes'),
        buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      ])
      setLancamentos(respLancamentos.lancamentos ?? [])
      setClientes(respClientes.clientes ?? [])
      setCasos(respCasos.casos ?? [])
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
    } finally {
      setCarregando(false)
    }
  }, [cliente])

  useEffect(() => {
    carregar()
  }, [carregar])

  const nomeCliente = (id?: string) => clientes.find((c) => c.id === id)?.nome ?? id ?? ''
  const tituloCaso = (id?: string) => casos.find((c) => c.id === id)?.titulo ?? '(sem título)'

  async function alternarPago(lanc: Lancamento, pago: boolean) {
    setLancamentos((atual) => atual?.map((l) => (l.id === lanc.id ? { ...l, pago } : l)) ?? null)
    try {
      await enviarJson(cliente, `/lancamentos/${lanc.id}`, { pago }, 'PATCH')
    } catch (e) {
      setLancamentos((atual) => atual?.map((l) => (l.id === lanc.id ? { ...l, pago: !pago } : l)) ?? null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar.')
    }
  }

  async function gerarCobranca(lanc: Lancamento) {
    try {
      await enviarJson(cliente, `/lancamentos/${lanc.id}/cobranca`, {})
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao gerar cobrança.')
    }
  }

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/lancamentos/${paraExcluir.id}`, {}, 'DELETE')
      setParaExcluir(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <Stack gap={6}>
      <div className="aj-layout-38">
        <h1>Lançamentos</h1>
        <Button size="sm" onClick={() => setModalNovoAberto(true)}>
          Novo lançamento
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && lancamentos && lancamentos.length === 0 && (
          <InlineNotification kind="info" title="Nenhum lançamento cadastrado" lowContrast hideCloseButton />
        )}
        {!carregando && lancamentos && lancamentos.length > 0 && (
          <TabelaLancamentos
            lancamentos={lancamentos}
            nomeCliente={nomeCliente}
            tituloCaso={tituloCaso}
            onAlternarPago={alternarPago}
            onGerarCobranca={gerarCobranca}
            onExcluir={setParaExcluir}
          />
        )}
      </div>
      <Modal closeButtonLabel="Fechar"
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir lançamento"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>
          Excluir o lançamento "{paraExcluir?.descricao}"? Essa ação não pode ser desfeita.
        </p>
      </Modal>
      <NovoLancamentoModal
        open={modalNovoAberto}
        onClose={() => setModalNovoAberto(false)}
        onSalvo={() => {
          setModalNovoAberto(false)
          carregar()
        }}
      />
    </Stack>
  )
}

const CABECALHOS_LANCAMENTOS = [
  { key: 'vencimento', header: 'Vencimento' },
  { key: 'valor', header: 'Valor' },
  { key: 'descricao', header: 'Descrição' },
  { key: 'cliente', header: 'Cliente' },
  { key: 'processo', header: 'Processo' },
  { key: 'responsavel', header: 'Responsável' },
  { key: 'direcao', header: 'Direção' },
]

function TabelaLancamentos({
  lancamentos,
  nomeCliente,
  tituloCaso,
  onAlternarPago,
  onGerarCobranca,
  onExcluir,
}: {
  lancamentos: Lancamento[]
  nomeCliente: (id?: string) => string
  tituloCaso: (id?: string) => string
  onAlternarPago: (lanc: Lancamento, pago: boolean) => void
  onGerarCobranca: (lanc: Lancamento) => void
  onExcluir: (lanc: Lancamento) => void
}) {
  const porId = new Map(lancamentos.map((l) => [l.id, l]))
  const linhas = lancamentos.map((lanc) => ({
    id: lanc.id,
    vencimento: formatarDataSimples(lanc.vencimento),
    valor: formatarMoeda(lanc.valor),
    descricao: lanc.descricao + (lanc.recorrente ? ' (mensal)' : ''),
    cliente: formatarNomeExibicao(nomeCliente(lanc.cliente_id)),
    processo: formatarNomeExibicao(tituloCaso(lanc.caso_id)),
    responsavel: formatarNomeExibicao(lanc.responsavel),
    direcao: lanc.direcao === 'DESPESA' ? 'A pagar' : 'A receber',
  }))

  return (
    <DataTable rows={linhas} headers={CABECALHOS_LANCAMENTOS} isSortable>
      {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
        <TableContainer>
          <Table {...getTableProps()} aria-label="Lançamentos">
            <TableHead>
              <TableRow>
                {headers.map((header) => (
                  <TableHeader {...getHeaderProps({ header })}>
                    {header.header}
                  </TableHeader>
                ))}
                <TableHeader>Ações</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const lanc = porId.get(row.id)
                if (!lanc) return null
                const rotuloPago = lanc.direcao === 'DESPESA' ? 'Pago' : 'Recebido'
                return (
                  <TableRow {...getRowProps({ row })}>
                    {row.cells.map((cell) =>
                      cell.info.header === 'direcao' ? (
                        <TableCell key={cell.id}>
                          <Tag type={lanc.direcao === 'DESPESA' ? 'red' : 'green'} size="sm">
                            {cell.value}
                          </Tag>
                          <div>
                            <Checkbox
                              id={`pago-${lanc.id}`}
                              labelText={rotuloPago}
                              checked={lanc.pago}
                              onChange={(_e, { checked }) => onAlternarPago(lanc, checked)}
                            />
                          </div>
                        </TableCell>
                      ) : (
                        <TableCell key={cell.id}>{cell.value}</TableCell>
                      ),
                    )}
                    <TableCell>
                      <div className="aj-layout-39">
                        {lanc.asaas_cobranca_id ? (
                          <span title={`Cobrança ${lanc.asaas_cobranca_id}`}>Cobrança gerada</span>
                        ) : (
                          !lanc.pago && (
                            <Button kind="tertiary" size="sm" onClick={() => onGerarCobranca(lanc)}>
                              Gerar cobrança
                            </Button>
                          )
                        )}
                        <Button kind="danger--tertiary" size="sm" onClick={() => onExcluir(lanc)}>
                          Excluir
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  )
}
