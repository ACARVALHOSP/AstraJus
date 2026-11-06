import TabelaResponsiva from '../TabelaResponsiva'
import TextoTabela from '../TextoTabela'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarMoeda } from '../utils/formatadores'
import { mascaraCpfCnpj } from '../utils/mascaras'
import NovaCobrancaModal from './pagamentos/NovaCobrancaModal'

type Cobranca = {
  id: string
  cliente_nome?: string
  value?: number
  dueDate?: string
  billingType?: string
  status?: string
  bankSlipUrl?: string
  invoiceUrl?: string
}

type Cliente = { id: string; nome?: string; cpf_cnpj?: string }

const ROTULOS_STATUS: Record<string, [string, 'gray' | 'red' | 'green']> = {
  PENDING: ['Pendente', 'gray'],
  OVERDUE: ['Vencido', 'red'],
  RECEIVED: ['Recebido', 'green'],
  CONFIRMED: ['Confirmado', 'green'],
  RECEIVED_IN_CASH: ['Recebido em dinheiro', 'green'],
  REFUNDED: ['Estornado', 'gray'],
  REFUND_REQUESTED: ['Estorno solicitado', 'gray'],
  REFUND_IN_PROGRESS: ['Estorno em andamento', 'gray'],
}
const ROTULOS_TIPO: Record<string, string> = { BOLETO: 'Boleto', PIX: 'Pix', UNDEFINED: 'A definir' }
const STATUS_FINALIZADOS = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'REFUNDED'])

export default function Pagamentos() {
  const { cliente } = useCliente()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [status, setStatus] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [clienteEncontrado, setClienteEncontrado] = useState<Cliente | null>(null)

  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [avisoIntegracao, setAvisoIntegracao] = useState<string | null>(null)
  const [cobrancas, setCobrancas] = useState<Cobranca[] | null>(null)
  const [paraCancelar, setParaCancelar] = useState<Cobranca | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [modalNovaAberto, setModalNovaAberto] = useState(false)

  const carregar = useCallback(
    async (clienteId: string) => {
      setCarregando(true)
      setErro(null)
      setAvisoIntegracao(null)
      try {
        let listaClientes = clientes
        if (!listaClientes.length) {
          const resp = await buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes')
          listaClientes = resp.clientes ?? []
          setClientes(listaClientes)
        }
        const params = new URLSearchParams()
        if (status) params.set('status', status)
        if (clienteId) params.set('cliente_id', clienteId)
        const url = '/pagamentos' + (params.toString() ? `?${params}` : '')
        const resp = await buscarJson<{ cobrancas: Cobranca[] }>(cliente, url)
        setCobrancas(resp.cobrancas ?? [])
      } catch (e) {
        if (e instanceof ErroMCP && e.status === 404) {
          setAvisoIntegracao(e.message)
          setCobrancas(null)
        } else {
          setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
        }
      } finally {
        setCarregando(false)
      }
    },
    [cliente, status, clientes],
  )

  useEffect(() => {
    carregar(clienteEncontrado?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  function aoDigitarCpfCnpj(valor: string) {
    const mascarado = mascaraCpfCnpj(valor)
    setCpfCnpj(mascarado)
    const digitos = mascarado.replace(/\D/g, '')
    const encontrado = digitos.length >= 11 ? clientes.find((c) => (c.cpf_cnpj ?? '').replace(/\D/g, '') === digitos) ?? null : null
    setClienteEncontrado(encontrado)
    carregar(encontrado?.id ?? '')
  }

  function statusCpfCnpj(): string {
    const digitos = cpfCnpj.replace(/\D/g, '')
    if (!digitos) return ''
    if (clienteEncontrado) return `Cliente: ${clienteEncontrado.nome}`
    if (digitos.length >= 11) return 'Nenhum cliente cadastrado com esse CPF/CNPJ.'
    return ''
  }

  async function confirmarCancelamento() {
    if (!paraCancelar) return
    setCancelando(true)
    try {
      await enviarJson(cliente, `/pagamentos/${paraCancelar.id}`, {}, 'DELETE')
      setParaCancelar(null)
      await carregar(clienteEncontrado?.id ?? '')
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao cancelar.')
    } finally {
      setCancelando(false)
    }
  }

  return (
    <Flex direction="column" gap="6">
      <Flex justify="between" align="center" wrap="wrap" gap="2">
        <Heading as="h1" size="6">Pagamentos</Heading>
        <Button size="2" onClick={() => setModalNovaAberto(true)}>
          Nova cobrança
        </Button>
      </Flex>
      <Text as="p" size="2" color="gray">Cobranças (boleto ou Pix) emitidas via Asaas para os clientes cadastrados.</Text>
      {avisoIntegracao && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>Integração Asaas não configurada — {avisoIntegracao}</Callout.Text>
        </Callout.Root>
      )}
      <div className="aj-form-grade">
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="pagamentos-filtro-status">Status</label>
          <Select.Root value={status || '__todos__'} onValueChange={(v) => setStatus(v === '__todos__' ? '' : v)}>
            <Select.Trigger id="pagamentos-filtro-status" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__todos__">— todos —</Select.Item>
              <Select.Item value="PENDING">Pendente</Select.Item>
              <Select.Item value="OVERDUE">Vencido</Select.Item>
              <Select.Item value="RECEIVED">Recebido</Select.Item>
              <Select.Item value="CONFIRMED">Confirmado</Select.Item>
              <Select.Item value="REFUNDED">Estornado</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="pagamentos-filtro-cliente-cpf">Cliente (CPF/CNPJ)</label>
          <TextField.Root
            id="pagamentos-filtro-cliente-cpf"
            placeholder="Ex.: 123.456.789-00"
            autoComplete="off"
            value={cpfCnpj}
            onChange={(e) => aoDigitarCpfCnpj(e.target.value)}
          />
          {statusCpfCnpj() && <Text size="1" color="gray">{statusCpfCnpj()}</Text>}
        </div>
      </div>
      <div aria-live="polite">
        {carregando && <Carregamento />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && cobrancas && cobrancas.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhuma cobrança encontrada.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && cobrancas && cobrancas.length > 0 && <TabelaCobrancas cobrancas={cobrancas} onCancelar={setParaCancelar} />}
      </div>
      <AlertDialog.Root open={paraCancelar !== null} onOpenChange={(open) => !open && setParaCancelar(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Cancelar cobrança</AlertDialog.Title>
          <AlertDialog.Description>Cancelar esta cobrança no Asaas? Essa ação não pode ser desfeita.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Voltar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={cancelando} onClick={confirmarCancelamento}>Cancelar cobrança</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <NovaCobrancaModal
        open={modalNovaAberto}
        clientes={clientes}
        onClose={() => setModalNovaAberto(false)}
        onCriada={() => {
          setModalNovaAberto(false)
          carregar(clienteEncontrado?.id ?? '')
        }}
      />
    </Flex>
  )
}

function TabelaCobrancas({ cobrancas, onCancelar }: { cobrancas: Cobranca[]; onCancelar: (c: Cobranca) => void }) {
  return (
    <TabelaResponsiva principais={['Cliente', 'Valor']}>
      <table aria-label="Cobranças">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Valor</th>
            <th>Vencimento</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {cobrancas.map((cobranca) => {
            const [rotuloStatus, corStatus] = ROTULOS_STATUS[cobranca.status ?? ''] || [cobranca.status ?? '?', 'gray']
            const link = cobranca.bankSlipUrl || cobranca.invoiceUrl
            return (
              <tr key={cobranca.id}>
                <td><TextoTabela texto={cobranca.cliente_nome || '(cliente sem cadastro local)'} /></td>
                <td className="tabela-numero">{formatarMoeda(cobranca.value)}</td>
                <td className="tabela-numero">{formatarDataSimples(cobranca.dueDate)}</td>
                <td>{ROTULOS_TIPO[cobranca.billingType ?? ''] ?? cobranca.billingType ?? '—'}</td>
                <td><Badge color={corStatus}>{rotuloStatus}</Badge></td>
                <td>
                  <AcoesTabela rotulo={`cobrança ${cobranca.id}`} acoes={[
                    ...(link ? [{ texto: 'Ver cobrança', href: link }] : []),
                    ...(!STATUS_FINALIZADOS.has(cobranca.status ?? '') ? [{ texto: 'Cancelar', executar: () => onCancelar(cobranca), perigo: true }] : []),
                  ]} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TabelaResponsiva>
  )
}
