import { useCallback, useEffect, useState } from 'react'
import { Button, InlineNotification, Link, Modal, Select, SelectItem, Stack, Tag, TextInput } from '@carbon/react'
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
    <Stack gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Pagamentos</h2>
        <Button size="sm" onClick={() => setModalNovaAberto(true)}>
          Nova cobrança
        </Button>
      </div>
      <p>Cobranças (boleto ou Pix) emitidas via Asaas para os clientes cadastrados.</p>
      {avisoIntegracao && (
        <InlineNotification kind="info" title="Integração Asaas não configurada" subtitle={avisoIntegracao} lowContrast hideCloseButton />
      )}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Select id="pagamentos-filtro-status" labelText="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <SelectItem value="" text="— todos —" />
          <SelectItem value="PENDING" text="Pendente" />
          <SelectItem value="OVERDUE" text="Vencido" />
          <SelectItem value="RECEIVED" text="Recebido" />
          <SelectItem value="CONFIRMED" text="Confirmado" />
          <SelectItem value="REFUNDED" text="Estornado" />
        </Select>
        <TextInput
          id="pagamentos-filtro-cliente-cpf"
          labelText="Cliente (CPF/CNPJ)"
          placeholder="Ex.: 123.456.789-00"
          autoComplete="off"
          helperText={statusCpfCnpj()}
          value={cpfCnpj}
          onChange={(e) => aoDigitarCpfCnpj(e.target.value)}
        />
      </div>
      <div aria-live="polite">
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && cobrancas && cobrancas.length === 0 && (
          <InlineNotification kind="info" title="Nenhuma cobrança encontrada" lowContrast hideCloseButton />
        )}
        {!carregando && cobrancas && cobrancas.length > 0 && (
          <div className="tabela-responsiva-wrap">
            <table className="tabela-responsiva tabela-pagamentos">
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
                      <td data-label="Cliente">{cobranca.cliente_nome || '(cliente sem cadastro local)'}</td>
                      <td data-label="Valor">{formatarMoeda(cobranca.value)}</td>
                      <td data-label="Vencimento">{formatarDataSimples(cobranca.dueDate)}</td>
                      <td data-label="Tipo">{ROTULOS_TIPO[cobranca.billingType ?? ''] ?? cobranca.billingType}</td>
                      <td data-label="Status">
                        <Tag type={corStatus} size="sm">
                          {rotuloStatus}
                        </Tag>
                      </td>
                      <td data-label="Ações">
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {link && (
                            <Link href={link} target="_blank" rel="noopener">
                              Ver cobrança
                            </Link>
                          )}
                          {!STATUS_FINALIZADOS.has(cobranca.status ?? '') && (
                            <Button kind="danger--tertiary" size="sm" onClick={() => setParaCancelar(cobranca)}>
                              Cancelar
                            </Button>
                          )}
                        </div>
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
        open={paraCancelar !== null}
        danger
        modalHeading="Cancelar cobrança"
        primaryButtonText="Cancelar cobrança"
        secondaryButtonText="Voltar"
        primaryButtonDisabled={cancelando}
        onRequestClose={() => setParaCancelar(null)}
        onRequestSubmit={confirmarCancelamento}
      >
        <p>Cancelar esta cobrança no Asaas? Essa ação não pode ser desfeita.</p>
      </Modal>
      <NovaCobrancaModal
        open={modalNovaAberto}
        clientes={clientes}
        onClose={() => setModalNovaAberto(false)}
        onCriada={() => {
          setModalNovaAberto(false)
          carregar(clienteEncontrado?.id ?? '')
        }}
      />
    </Stack>
  )
}
