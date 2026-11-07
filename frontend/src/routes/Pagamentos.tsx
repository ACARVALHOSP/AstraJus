import CabecalhoPagina from '../CabecalhoPagina'
import TabelaResponsiva from '../TabelaResponsiva'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import CampoData from '../CampoData'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import NovaCobrancaModal from './pagamentos/NovaCobrancaModal'
import './financeiro/financeiro.scss'
import './pagamentos/pagamentos.scss'

type Cobranca = {
  id: string
  cliente_nome?: string | null
  description?: string
  value?: number
  dueDate?: string
  paymentDate?: string
  clientPaymentDate?: string
  billingType?: string
  status?: string
  bankSlipUrl?: string
  invoiceUrl?: string
  transactionReceiptUrl?: string
  installment?: string
  installmentNumber?: number
  parcelas_total?: number
}
type Cliente = { id: string; nome?: string; cpf_cnpj?: string }
type Situacao = 'a_receber' | 'vencidas' | 'recebidas' | 'todas'
type Resumo = {
  a_receber: { total: number; quantidade: number; proximo_vencimento: string | null }
  vencidas: { total: number; quantidade: number; mais_antigo: string | null }
  recebidas_mes: { total: number; quantidade: number; mes: string }
}
type Painel = {
  resumo: Resumo
  contagens: Record<Situacao, number>
  cobrancas: Cobranca[]
  totalCount: number
  hasMore: boolean
  truncado?: boolean
}

const ROTULOS_STATUS: Record<string, [string, 'gray' | 'red' | 'green' | 'amber']> = {
  PENDING: ['Pendente', 'gray'],
  OVERDUE: ['Vencida', 'red'],
  RECEIVED: ['Recebida', 'green'],
  CONFIRMED: ['Confirmada', 'green'],
  RECEIVED_IN_CASH: ['Recebida em dinheiro', 'green'],
  REFUNDED: ['Estornada', 'gray'],
  REFUND_REQUESTED: ['Estorno solicitado', 'amber'],
  REFUND_IN_PROGRESS: ['Estorno em andamento', 'amber'],
}
const ROTULOS_FORMA: Record<string, string> = { BOLETO: 'Boleto', PIX: 'Pix', CREDIT_CARD: 'Cartão', UNDEFINED: 'A definir' }
const STATUS_FINALIZADOS = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function diasEntre(deIso: string, ateIso: string) {
  const [a, b] = [deIso, ateIso].map(v => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / 86_400_000)
}
function dataCurta(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function prazo(c: Cobranca, hoje: string) {
  if (!c.dueDate || STATUS_FINALIZADOS.has(c.status ?? '')) return ''
  const dias = diasEntre(hoje, c.dueDate)
  if (dias < -1) return `venceu há ${-dias} dias`
  if (dias === -1) return 'venceu ontem'
  if (dias === 0) return 'vence hoje'
  if (dias === 1) return 'vence amanhã'
  return `em ${dias} dias`
}
function dataPagamento(c: Cobranca) {
  return c.paymentDate || c.clientPaymentDate || ''
}
function parcela(c: Cobranca) {
  if (!c.installment) return ''
  if (c.installmentNumber && c.parcelas_total) return `parcela ${c.installmentNumber} de ${c.parcelas_total}`
  return c.installmentNumber ? `parcela ${c.installmentNumber}` : 'parcelada'
}
function quantas(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`
}

export default function Pagamentos() {
  const { cliente } = useCliente()
  const estreita = useEstreita()
  const [hoje] = useState(() => isoLocal(new Date()))
  const [situacao, setSituacao] = useState<Situacao>('a_receber')
  const [forma, setForma] = useState('')
  const [vencDe, setVencDe] = useState('')
  const [vencAte, setVencAte] = useState('')
  const [busca, setBusca] = useState('')
  const [buscaAtiva, setBuscaAtiva] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])

  const [carregando, setCarregando] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [avisoIntegracao, setAvisoIntegracao] = useState<string | null>(null)
  const [painel, setPainel] = useState<Painel | null>(null)
  const [paraCancelar, setParaCancelar] = useState<Cobranca | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [modalNovaAberto, setModalNovaAberto] = useState(false)
  const pedido = useRef(0)

  // A busca só vai ao servidor depois de uma pausa na digitação.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 350)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes')
      .then(r => setClientes(r.clientes ?? []))
      .catch(() => setClientes([]))
  }, [cliente])

  const carregar = useCallback(async (offset = 0) => {
    const meu = ++pedido.current
    if (offset) setCarregandoMais(true)
    else setCarregando(true)
    setErro(null)
    try {
      const params = new URLSearchParams({ situacao, offset: String(offset) })
      if (forma) params.set('forma', forma)
      if (vencDe) params.set('vencimento_de', vencDe)
      if (vencAte) params.set('vencimento_ate', vencAte)
      if (buscaAtiva) params.set('busca', buscaAtiva)
      const resp = await buscarJson<Painel>(cliente, `/pagamentos?${params}`)
      if (meu !== pedido.current) return
      setAvisoIntegracao(null)
      setPainel(atual => (offset && atual ? { ...resp, cobrancas: [...atual.cobrancas, ...resp.cobrancas] } : resp))
    } catch (e) {
      if (meu !== pedido.current) return
      if (e instanceof ErroMCP && e.status === 404) {
        setAvisoIntegracao(e.message)
        setPainel(null)
      } else {
        setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
      }
    } finally {
      if (meu === pedido.current) {
        setCarregando(false)
        setCarregandoMais(false)
      }
    }
  }, [cliente, situacao, forma, vencDe, vencAte, buscaAtiva])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void carregar(0)
  }, [carregar])

  async function copiarLink(c: Cobranca) {
    const link = c.invoiceUrl || c.bankSlipUrl
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setMensagem(`Link da cobrança de ${formatarNomeExibicao(c.cliente_nome ?? '') || 'cliente'} copiado.`)
    } catch {
      window.open(link, '_blank', 'noopener')
    }
  }

  async function confirmarCancelamento() {
    if (!paraCancelar) return
    setCancelando(true)
    try {
      await enviarJson(cliente, `/pagamentos/${paraCancelar.id}`, {}, 'DELETE')
      setParaCancelar(null)
      setMensagem('Cobrança cancelada.')
      await carregar(0)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao cancelar.')
    } finally {
      setCancelando(false)
    }
  }

  const resumo = painel?.resumo
  const contagens = painel?.contagens
  const cobrancas = painel?.cobrancas ?? []
  const filtrosAtivos = Boolean(forma || vencDe || vencAte || busca)
  const mesRecebido = resumo ? MESES[Number(resumo.recebidas_mes.mes.slice(5, 7)) - 1] : ''

  const atalhos: Array<{ valor: Situacao; rotulo: string; alerta?: boolean }> = [
    { valor: 'a_receber', rotulo: 'A receber' },
    { valor: 'vencidas', rotulo: 'Vencidas', alerta: true },
    { valor: 'recebidas', rotulo: 'Recebidas' },
    { valor: 'todas', rotulo: 'Todas' },
  ]

  function seloSituacao(c: Cobranca) {
    const [rotulo, cor] = ROTULOS_STATUS[c.status ?? ''] || [c.status ?? '?', 'gray']
    const pago = dataPagamento(c)
    return (
      <>
        <Badge color={cor} variant="soft" radius="full">{rotulo}</Badge>
        {pago && <div className="fin-secundario">paga em {dataCurta(pago)}</div>}
      </>
    )
  }
  function acaoPrincipal(c: Cobranca, grande = false) {
    const tamanho = grande ? '3' : '1'
    const estilo = grande ? { flex: 1 } : undefined
    if (!STATUS_FINALIZADOS.has(c.status ?? '') && (c.invoiceUrl || c.bankSlipUrl)) {
      return <Button size={tamanho} variant="soft" color="gray" style={estilo} onClick={() => copiarLink(c)}>Copiar link</Button>
    }
    const link = c.transactionReceiptUrl || c.invoiceUrl
    if (!link) return null
    return (
      <Button size={tamanho} variant="soft" color="gray" style={estilo} asChild>
        <a href={link} target="_blank" rel="noopener noreferrer">{c.transactionReceiptUrl ? 'Ver comprovante' : 'Ver cobrança'}</a>
      </Button>
    )
  }
  function menu(c: Cobranca) {
    return <AcoesTabela rotulo={`cobrança de ${c.cliente_nome ?? c.id}`} acoes={[
      ...(c.invoiceUrl ? [{ texto: 'Abrir cobrança', href: c.invoiceUrl }] : []),
      ...(c.bankSlipUrl ? [{ texto: 'Abrir boleto', href: c.bankSlipUrl }] : []),
      ...(!STATUS_FINALIZADOS.has(c.status ?? '') ? [{ texto: 'Cancelar cobrança', executar: () => setParaCancelar(c), perigo: true }] : []),
    ]} />
  }
  const nomeCliente = (c: Cobranca) => formatarNomeExibicao(c.cliente_nome ?? '') || 'Cliente sem cadastro local'
  const classePrazo = (c: Cobranca) => c.status === 'OVERDUE' ? 'fin-secundario fin-alerta' : 'fin-secundario'

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Pagamentos"
        descricao="Cobranças por boleto ou Pix emitidas pelo Asaas para os seus clientes."
        acoes={<Button size="2" onClick={() => setModalNovaAberto(true)}>Nova cobrança</Button>}
      />
      {avisoIntegracao && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>Integração Asaas não configurada — {avisoIntegracao}</Callout.Text>
        </Callout.Root>
      )}

      {resumo && (
        <dl className="fin-resumo pag-resumo">
          <div>
            <dt>A receber</dt>
            <dd>{formatarMoeda(resumo.a_receber.total)}</dd>
            <p>
              {quantas(resumo.a_receber.quantidade, 'cobrança', 'cobranças')}
              {resumo.a_receber.proximo_vencimento && ` · próxima vence em ${dataCurta(resumo.a_receber.proximo_vencimento)}`}
            </p>
          </div>
          <div className={resumo.vencidas.quantidade ? 'pag-resumo-alerta' : undefined}>
            <dt>Vencidas</dt>
            <dd className={resumo.vencidas.quantidade ? 'fin-despesa' : undefined}>{formatarMoeda(resumo.vencidas.total)}</dd>
            <p>
              {quantas(resumo.vencidas.quantidade, 'cobrança', 'cobranças')}
              {resumo.vencidas.mais_antigo && ` · a mais antiga venceu em ${dataCurta(resumo.vencidas.mais_antigo)}`}
            </p>
          </div>
          <div>
            <dt>Recebidas em {mesRecebido}</dt>
            <dd className="fin-receita">{formatarMoeda(resumo.recebidas_mes.total)}</dd>
            <p>{quantas(resumo.recebidas_mes.quantidade, 'cobrança', 'cobranças')}</p>
          </div>
        </dl>
      )}

      {!avisoIntegracao && (
        <>
          <div className="fin-atalhos" role="group" aria-label="Situação">
            {atalhos.map(a => {
              const ativo = situacao === a.valor
              const qtd = contagens?.[a.valor]
              return (
                <Button key={a.valor} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
                  aria-pressed={ativo} onClick={() => setSituacao(a.valor)}>
                  {a.rotulo}
                  {qtd === undefined ? null : a.alerta && qtd > 0
                    ? <Badge color="red" variant="solid" radius="full">{qtd}</Badge>
                    : <Text size="1" color="gray">{qtd}</Text>}
                </Button>
              )
            })}
          </div>

          <div className="aj-filtros-linha">
            <div className="form-campo aj-filtros-busca">
              <label className="form-campo-label" htmlFor="pag-busca">Buscar</label>
              <TextField.Root id="pag-busca" type="search" placeholder="Cliente, CPF/CNPJ ou descrição" autoComplete="off" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" id="pag-forma-rotulo">Forma</label>
              <Select.Root value={forma || '__todas__'} onValueChange={v => setForma(v === '__todas__' ? '' : v)}>
                <Select.Trigger aria-labelledby="pag-forma-rotulo" />
                <Select.Content>
                  <Select.Item value="__todas__">Boleto e Pix</Select.Item>
                  <Select.Item value="BOLETO">Boleto</Select.Item>
                  <Select.Item value="PIX">Pix</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pag-venc-de">Vencimento de</label>
              <CampoData id="pag-venc-de" value={vencDe} onChange={setVencDe} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pag-venc-ate">até</label>
              <CampoData id="pag-venc-ate" value={vencAte} onChange={setVencAte} />
            </div>
            {filtrosAtivos && <Button size="2" variant="soft" color="gray" onClick={() => { setForma(''); setVencDe(''); setVencAte(''); setBusca('') }}>Limpar filtros</Button>}
          </div>
        </>
      )}

      {carregando && <Carregamento tipo="tabela" descricao="Carregando cobranças…" />}
      {!carregando && painel && cobrancas.length === 0 && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>{filtrosAtivos ? 'Nenhuma cobrança com estes filtros.' : 'Nenhuma cobrança nesta situação.'}</Callout.Text>
        </Callout.Root>
      )}

      {!carregando && cobrancas.length > 0 && (estreita ? (
        <ul className="fin-cartoes">
          {cobrancas.map(c => (
            <li key={c.id} className="fin-cartao">
              <Flex align="center" gap="2" wrap="wrap">
                <Text size="2" weight="bold">{dataCurta(c.dueDate)}</Text>
                <span className={classePrazo(c)}>{prazo(c, hoje)}</span>
                <span style={{ marginLeft: 'auto' }}><Badge color={(ROTULOS_STATUS[c.status ?? ''] ?? ['', 'gray'])[1]} variant="soft" radius="full">{(ROTULOS_STATUS[c.status ?? ''] ?? [c.status ?? '?'])[0]}</Badge></span>
              </Flex>
              <div>
                <div className="fin-descricao">{nomeCliente(c)}</div>
                {c.description && <div className="fin-secundario">{c.description}</div>}
              </div>
              <Flex justify="between" align="end" gap="3">
                <Text size="2" color="gray">{ROTULOS_FORMA[c.billingType ?? ''] ?? c.billingType ?? '—'}{dataPagamento(c) && ` · paga em ${dataCurta(dataPagamento(c))}`}</Text>
                <div style={{ textAlign: 'right' }}>
                  <span className="fin-valor">{formatarMoeda(c.value)}</span>
                  {parcela(c) && <div className="fin-secundario">{parcela(c)}</div>}
                </div>
              </Flex>
              <Flex gap="2" className="fin-cartao-acoes">{acaoPrincipal(c, true)}{menu(c)}</Flex>
            </li>
          ))}
        </ul>
      ) : (
        <TabelaResponsiva principais={['Cliente', 'Valor']}>
          <table aria-label="Cobranças" className="pag-tabela">
            <thead>
              <tr>
                <th className="pag-col-venc">Vencimento</th>
                <th>Cliente</th>
                <th className="pag-col-valor">Valor</th>
                <th className="pag-col-forma">Forma</th>
                <th className="pag-col-situacao">Situação</th>
                <th className="tabela-acoes pag-col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {cobrancas.map(c => (
                <tr key={c.id}>
                  <td>
                    <div className="fin-data">{dataCurta(c.dueDate)}</div>
                    <div className={classePrazo(c)}>{prazo(c, hoje)}</div>
                  </td>
                  <td>
                    <div className="fin-descricao">{nomeCliente(c)}</div>
                    {c.description && <div className="fin-secundario pag-descricao" title={c.description}>{c.description}</div>}
                  </td>
                  <td className="pag-col-valor">
                    <span className="fin-valor">{formatarMoeda(c.value)}</span>
                    {parcela(c) && <div className="fin-secundario">{parcela(c)}</div>}
                  </td>
                  <td>{ROTULOS_FORMA[c.billingType ?? ''] ?? c.billingType ?? '—'}</td>
                  <td>{seloSituacao(c)}</td>
                  <td className="tabela-acoes"><Flex gap="1" justify="end" align="center">{acaoPrincipal(c)}{menu(c)}</Flex></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabelaResponsiva>
      ))}

      {!carregando && painel && cobrancas.length > 0 && (
        <Flex justify="between" align="center" gap="3" wrap="wrap">
          <Text size="2" color="gray">Mostrando {cobrancas.length} de {quantas(painel.totalCount, 'cobrança', 'cobranças')}</Text>
          {painel.hasMore && <Button size="2" variant="soft" color="gray" disabled={carregandoMais} onClick={() => carregar(cobrancas.length)}>{carregandoMais ? 'Carregando…' : 'Carregar mais'}</Button>}
        </Flex>
      )}
      {painel?.truncado && (
        <Text size="1" color="gray">Os totais consideram as 1.000 cobranças mais recentes do Asaas.</Text>
      )}

      <div aria-live="polite">
        {mensagem && <Callout.Root color="green" size="1"><Callout.Icon><Info size={14} /></Callout.Icon><Callout.Text>{mensagem}</Callout.Text></Callout.Root>}
        {erro && <Callout.Root color="red" size="1"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      </div>

      <AlertDialog.Root open={paraCancelar !== null} onOpenChange={(open) => !open && setParaCancelar(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Cancelar cobrança</AlertDialog.Title>
          <AlertDialog.Description>
            Cancelar a cobrança de {formatarMoeda(paraCancelar?.value)} para {paraCancelar ? nomeCliente(paraCancelar) : ''} no Asaas? Essa ação não pode ser desfeita.
          </AlertDialog.Description>
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
          setMensagem('Cobrança criada.')
          void carregar(0)
        }}
      />
    </Flex>
  )
}
