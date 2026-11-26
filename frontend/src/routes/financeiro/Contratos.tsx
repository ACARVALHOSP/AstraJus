import { useMemo, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FilePlus2, Info } from 'lucide-react'
import {
  AlertDialog, Badge, Button, Callout, Dialog, Flex, Heading, Progress, Select, Switch, Table, Text, TextField,
} from '@radix-ui/themes'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import LinhaFiltros from '../../LinhaFiltros'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { useCasos, useClientes, useNomePessoa } from '../../api/consultas'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao, hojeIso } from '../../utils/formatadores'
import {
  COR_SITUACAO_CONTRATO, ROTULO_SITUACAO_CONTRATO, situacaoParcela,
  type Contrato, type SituacaoContrato,
} from './dadosContrato'
import NovoContratoModal from './NovoContratoModal'
import './financeiro.scss'

type Cliente = { id: string; nome?: string }
type Caso = { id: string; titulo?: string }
const SEM_CLIENTES: Cliente[] = []
const SEM_CASOS: Caso[] = []

const dataOuTraco = (iso?: string | null) => (iso ? formatarDataSimples(iso) : '—')

/** Contratos de honorários: rascunho, parcelas lançadas no Financeiro e acompanhamento do pagamento. */
export default function Contratos({ abas }: { abas: ReactNode }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const [busca, setBusca] = useState('')
  const [situacao, setSituacao] = useState<'' | SituacaoContrato>('')
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [editando, setEditando] = useState<Contrato | null>(null)

  const consulta = useQuery({
    queryKey: ['contratos', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ contratos: Contrato[] }>(cliente, '/contratos-honorarios', signal).then(r => r.contratos ?? []),
  })
  const consultaClientes = useClientes<Cliente>()
  const consultaCasos = useCasos<Caso>()

  const contratos = consulta.data ?? []
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const casos = consultaCasos.data ?? SEM_CASOS
  const carregando = consulta.isPending
  const falha = consulta.error ?? consultaClientes.error ?? consultaCasos.error
  const erro = falha ? (falha instanceof ErroMCP ? falha.message : 'Não foi possível carregar os contratos.') : null

  const nomeCliente = (id?: string | null) => formatarNomeExibicao(clientes.find(c => c.id === id)?.nome ?? '') || '—'
  const tituloCaso = (id?: string | null) => (!id
    ? 'Sem processo'
    : formatarNomeExibicao(casos.find(c => c.id === id)?.titulo ?? '') || 'Processo sem título')

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return contratos.filter(c => {
      if (situacao && c.situacao !== situacao) return false
      if (!termo) return true
      const nome = formatarNomeExibicao(clientes.find(x => x.id === c.cliente_id)?.nome ?? '')
      return `${c.titulo} ${nome}`.toLocaleLowerCase('pt-BR').includes(termo)
    })
  }, [contratos, situacao, busca, clientes])

  // A lista não traz o resumo; para os contratos vigentes, busca o detalhe para mostrar pago/em aberto.
  const vigentes = useMemo(() => filtrados.filter(c => c.situacao === 'vigente'), [filtrados])
  const consultasDetalhe = useQueries({
    queries: vigentes.map(c => ({
      queryKey: ['contrato', c.id, cliente?.token],
      enabled: Boolean(cliente),
      queryFn: ({ signal }) => buscarJson<{ contrato: Contrato }>(cliente, `/contratos-honorarios/${c.id}`, signal).then(r => r.contrato),
    })),
  })
  const detalhes = new Map<string, Contrato>()
  vigentes.forEach((c, i) => {
    const detalhe = consultasDetalhe[i]?.data
    if (detalhe) detalhes.set(c.id, detalhe)
  })

  function aoSalvar(contrato: Contrato) {
    const eraEdicao = Boolean(editando)
    setNovoAberto(false)
    setEditando(null)
    setSelecionado(contrato.id)
    avisar({ texto: eraEdicao ? 'Contrato atualizado.' : 'Rascunho de contrato salvo.' })
    void queryClient.invalidateQueries({ queryKey: ['contratos'] })
    void queryClient.invalidateQueries({ queryKey: ['contrato', contrato.id] })
  }

  function aoEditar(contrato: Contrato) {
    setSelecionado(null)
    setEditando(contrato)
  }

  function fecharNovo() {
    setNovoAberto(false)
    setEditando(null)
  }

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Financeiro"
        abas={abas}
        descricao="Contratos de honorários: rascunho, parcelas lançadas no Financeiro e acompanhamento dos pagamentos."
        acoes={<Button size="2" onClick={() => setNovoAberto(true)}><FilePlus2 size={15} aria-hidden="true" />Novo contrato</Button>}
      />

      <LinhaFiltros ativos={situacao ? 1 : 0}>
        <div className="form-campo aj-filtros-busca">
          <label className="form-campo-label" htmlFor="contratos-busca">Buscar</label>
          <TextField.Root
            id="contratos-busca"
            type="search"
            placeholder="Título ou cliente"
            autoComplete="off"
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="contratos-situacao-rotulo">Situação</label>
          <Select.Root value={situacao || '__todas__'} onValueChange={v => setSituacao(v === '__todas__' ? '' : v as SituacaoContrato)}>
            <Select.Trigger aria-labelledby="contratos-situacao-rotulo" />
            <Select.Content>
              <Select.Item value="__todas__">Todas as situações</Select.Item>
              {(Object.keys(ROTULO_SITUACAO_CONTRATO) as SituacaoContrato[]).map(s => (
                <Select.Item key={s} value={s}>{ROTULO_SITUACAO_CONTRATO[s]}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        {situacao && <Button size="2" variant="soft" color="gray" onClick={() => setSituacao('')}>Limpar filtro</Button>}
      </LinhaFiltros>

      {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && <Carregamento tipo="tabela" descricao="Carregando contratos…" />}

      {!carregando && !erro && !filtrados.length && (
        <Callout.Root color="blue" size="1" role="status">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>
            {contratos.length
              ? 'Nenhum contrato com esta busca ou situação.'
              : 'Nenhum contrato ainda. Crie o primeiro para organizar as parcelas no Financeiro.'}
          </Callout.Text>
        </Callout.Root>
      )}

      {!carregando && filtrados.length > 0 && (
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Contrato</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Cliente</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Processo</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Valor total</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Pago / Em aberto</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Situação</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {filtrados.map(c => {
              const resumo = detalhes.get(c.id)?.resumo
              return (
                <Table.Row
                  key={c.id}
                  tabIndex={0}
                  aria-label={`Abrir contrato ${c.titulo}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelecionado(c.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelecionado(c.id)
                    }
                  }}
                >
                  <Table.RowHeaderCell>
                    <Text size="2" weight="medium">{c.titulo}</Text>
                    {c.entrada > 0 && <Text as="div" size="1" color="gray">Entrada de {formatarMoeda(c.entrada)}</Text>}
                  </Table.RowHeaderCell>
                  <Table.Cell>{nomeCliente(c.cliente_id)}</Table.Cell>
                  <Table.Cell>{c.caso_id ? tituloCaso(c.caso_id) : 'Sem processo'}</Table.Cell>
                  <Table.Cell justify="end">{formatarMoeda(c.valor_total)}</Table.Cell>
                  <Table.Cell>
                    {c.situacao === 'vigente' && resumo
                      ? (
                        <>
                          <Text size="2" className="fin-receita">{formatarMoeda(resumo.pago)}</Text>
                          <Text as="div" size="1" color="gray">{formatarMoeda(resumo.em_aberto)} em aberto</Text>
                        </>
                      )
                      : <Text size="1" color="gray">—</Text>}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={COR_SITUACAO_CONTRATO[c.situacao]} variant="soft">{ROTULO_SITUACAO_CONTRATO[c.situacao]}</Badge>
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table.Root>
      )}

      {selecionado && (
        <DetalheContrato id={selecionado} onFechar={() => setSelecionado(null)} onEditar={aoEditar} />
      )}
      <NovoContratoModal
        open={novoAberto || Boolean(editando)}
        contrato={editando}
        onClose={fecharNovo}
        onSalvo={aoSalvar}
      />
    </Flex>
  )
}

function DetalheContrato({ id, onFechar, onEditar }: {
  id: string
  onFechar: () => void
  onEditar: (contrato: Contrato) => void
}) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const nomePessoa = useNomePessoa()
  const queryClient = useQueryClient()
  const consulta = useQuery({
    queryKey: ['contrato', id, cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ contrato: Contrato }>(cliente, `/contratos-honorarios/${id}`, signal).then(r => r.contrato),
  })
  const consultaClientes = useClientes<Cliente>()
  const consultaCasos = useCasos<Caso>()
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const casos = consultaCasos.data ?? SEM_CASOS
  const [confirmacao, setConfirmacao] = useState<null | 'ativar' | 'cancelar' | 'encerrar'>(null)
  const [ocupado, setOcupado] = useState(false)
  const hoje = hojeIso()

  const contrato = consulta.data
  const erro = consulta.error
    ? (consulta.error instanceof ErroMCP ? consulta.error.message : 'Não foi possível carregar o contrato.')
    : null

  const nomeCliente = (clienteId?: string | null) => formatarNomeExibicao(clientes.find(c => c.id === clienteId)?.nome ?? '') || '—'
  const tituloCaso = (casoId?: string | null) => (!casoId
    ? 'Sem processo'
    : formatarNomeExibicao(casos.find(c => c.id === casoId)?.titulo ?? '') || 'Processo sem título')

  async function executar() {
    if (!contrato || !confirmacao) return
    setOcupado(true)
    try {
      if (confirmacao === 'ativar') {
        const r = await enviarJson<{ contrato: Contrato }>(cliente, `/contratos-honorarios/${contrato.id}/ativar`, {})
        queryClient.setQueryData(['contrato', contrato.id, cliente?.token], r.contrato)
        avisar({ texto: 'Contrato ativado e parcelas lançadas no Financeiro.' })
      } else if (confirmacao === 'encerrar') {
        const r = await enviarJson<{ contrato: Contrato }>(cliente, `/contratos-honorarios/${contrato.id}/encerrar`, {})
        queryClient.setQueryData(['contrato', contrato.id, cliente?.token], r.contrato)
        avisar({ texto: 'Contrato encerrado.' })
      } else {
        const r = await enviarJson<{ removidos: number; mantidos: number; contrato: Contrato }>(
          cliente, `/contratos-honorarios/${contrato.id}/cancelar`, {},
        )
        queryClient.setQueryData(['contrato', contrato.id, cliente?.token], r.contrato)
        avisar({ texto: `Contrato cancelado. ${r.removidos} removidas, ${r.mantidos} mantidas.` })
      }
      setConfirmacao(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contratos'] }),
        queryClient.invalidateQueries({ queryKey: ['lancamentos'] }),
      ])
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível concluir a ação.' })
    } finally {
      setOcupado(false)
    }
  }

  const textos = {
    ativar: {
      titulo: 'Ativar contrato',
      rotulo: 'Ativar e gerar parcelas',
      descricao: contrato
        ? `${contrato.entrada > 0 ? `A entrada de ${formatarMoeda(contrato.entrada)} e ` : ''}${contrato.parcelas} parcela(s) serão lançadas no Financeiro, totalizando ${formatarMoeda(contrato.valor_total)}.`
        : '',
    },
    cancelar: {
      titulo: 'Cancelar contrato',
      rotulo: 'Cancelar contrato',
      descricao: contrato?.situacao === 'rascunho'
        ? 'Cancelar este contrato? Ele ainda não gerou parcelas no Financeiro.'
        : 'Cancelar este contrato? As parcelas não pagas e sem cobrança emitida serão removidas do Financeiro. As pagas ou com cobrança continuam.',
    },
    encerrar: {
      titulo: 'Encerrar contrato',
      rotulo: 'Encerrar',
      descricao: 'Encerrar este contrato? As parcelas continuam no Financeiro e o contrato deixa de ser acompanhado como vigente.',
    },
  }

  return (
    <>
      <Dialog.Root open onOpenChange={aberto => !aberto && onFechar()}>
        <Dialog.Content maxWidth="900px" maxHeight="90vh">
          <Dialog.Title>{contrato?.titulo ?? 'Contrato'}</Dialog.Title>
          <Dialog.Description>
            {contrato ? `${nomeCliente(contrato.cliente_id)} · ${contrato.caso_id ? tituloCaso(contrato.caso_id) : 'Sem processo'}` : 'Detalhes do contrato'}
          </Dialog.Description>

          {erro && <Callout.Root color="red" size="1" role="alert" mt="4"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
          {!contrato && !erro && <Carregamento tipo="detalhe" descricao="Carregando contrato…" />}

          {contrato && (
            <Flex direction="column" gap="5" mt="4">
              <dl className="fin-mini">
                <div><dt>Cliente</dt><dd>{nomeCliente(contrato.cliente_id)}</dd></div>
                <div><dt>Processo</dt><dd>{contrato.caso_id ? tituloCaso(contrato.caso_id) : 'Sem processo'}</dd></div>
                <div><dt>Valor total</dt><dd>{formatarMoeda(contrato.valor_total)}</dd></div>
                <div>
                  <dt>Entrada</dt>
                  <dd>{contrato.entrada > 0
                    ? `${formatarMoeda(contrato.entrada)}${contrato.entrada_vencimento ? ` em ${formatarDataSimples(contrato.entrada_vencimento)}` : ''}`
                    : 'Sem entrada'}</dd>
                </div>
                <div><dt>Parcelas</dt><dd>{contrato.parcelas}</dd></div>
                <div><dt>Primeiro vencimento</dt><dd>{formatarDataSimples(contrato.primeiro_vencimento)}</dd></div>
                <div>
                  <dt>Vigência</dt>
                  <dd>{contrato.vigencia_inicio || contrato.vigencia_fim
                    ? `${dataOuTraco(contrato.vigencia_inicio)} a ${dataOuTraco(contrato.vigencia_fim)}`
                    : 'Não informada'}</dd>
                </div>
                <div>
                  <dt>Êxito</dt>
                  <dd>{contrato.exito_percentual === null
                    ? 'Sem êxito'
                    : `${contrato.exito_percentual.toLocaleString('pt-BR')}%${contrato.exito_descricao ? ` — ${contrato.exito_descricao}` : ''}`}</dd>
                </div>
                <div><dt>Responsável</dt><dd>{nomePessoa(contrato.responsavel) || '—'}</dd></div>
                <div><dt>Documento</dt><dd>{contrato.documento_id ? `#${contrato.documento_id}` : 'Sem documento'}</dd></div>
                <div>
                  <dt>Situação</dt>
                  <dd><Badge color={COR_SITUACAO_CONTRATO[contrato.situacao]} variant="soft">{ROTULO_SITUACAO_CONTRATO[contrato.situacao]}</Badge></dd>
                </div>
              </dl>

              {contrato.resumo && (
                <div>
                  <Flex justify="between" align="baseline" gap="3" wrap="wrap" mb="1">
                    <Text size="2" weight="medium">Pago: {formatarMoeda(contrato.resumo.pago)} de {formatarMoeda(contrato.resumo.total)}</Text>
                    <Text size="1" color="gray">{contrato.resumo.quitado ? 'Quitado' : `${formatarMoeda(contrato.resumo.em_aberto)} em aberto`}</Text>
                  </Flex>
                  <Progress
                    value={contrato.resumo.total > 0 ? Math.min(100, Math.round((contrato.resumo.pago / contrato.resumo.total) * 100)) : 0}
                    color="green"
                    aria-label="Progresso do pagamento"
                  />
                  {contrato.resumo.vencido > 0 && <Text as="p" size="1" color="red" mt="1">{formatarMoeda(contrato.resumo.vencido)} vencido(s).</Text>}
                </div>
              )}

              <div>
                <Heading as="h4" size="2" mb="2">Parcelas</Heading>
                {contrato.parcelas_lancamentos?.length
                  ? (
                    <Table.Root variant="surface" size="1">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Vencimento</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Descrição</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell justify="end">Valor</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Situação</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {contrato.parcelas_lancamentos.map(l => {
                          const s = situacaoParcela(l, hoje)
                          return (
                            <Table.Row key={l.id}>
                              <Table.Cell>{formatarDataSimples(l.vencimento)}</Table.Cell>
                              <Table.Cell>{l.descricao}</Table.Cell>
                              <Table.Cell justify="end">{formatarMoeda(l.valor)}</Table.Cell>
                              <Table.Cell>
                                <Badge color={s === 'paga' ? 'green' : s === 'vencida' ? 'red' : 'gray'} variant="soft">
                                  {s === 'paga' ? 'Paga' : s === 'vencida' ? 'Vencida' : 'Em aberto'}
                                </Badge>
                              </Table.Cell>
                            </Table.Row>
                          )
                        })}
                      </Table.Body>
                    </Table.Root>
                  )
                  : (
                    <Text size="2" color="gray">
                      {contrato.situacao === 'rascunho'
                        ? 'As parcelas aparecem aqui depois de ativar o contrato.'
                        : 'Nenhuma parcela vinculada a este contrato.'}
                    </Text>
                  )}
              </div>

              <div>
                <Heading as="h4" size="2" mb="2">Automação</Heading>
                <Flex direction="column" gap="2">
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <Switch checked={contrato.ativar_ao_assinar} disabled aria-label="Ativar ao assinar o contrato" />
                      Ativar ao assinar o contrato
                    </Flex>
                  </Text>
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <Switch checked={contrato.recibo_automatico} disabled aria-label="Enviar recibo automático" />
                      Enviar recibo automático
                    </Flex>
                  </Text>
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <Switch checked={contrato.lembrete_automatico} disabled aria-label="Enviar lembrete automático" />
                      Enviar lembrete automático
                    </Flex>
                  </Text>
                  <Text size="1" color="gray">Automações chegam nas próximas versões; hoje tudo é manual.</Text>
                </Flex>
              </div>

              <Flex gap="2" justify="end" wrap="wrap">
                {contrato.situacao === 'rascunho' && (
                  <>
                    <Button size="2" variant="soft" color="gray" onClick={() => onEditar(contrato)}>Editar</Button>
                    <Button size="2" variant="soft" color="red" onClick={() => setConfirmacao('cancelar')}>Cancelar contrato</Button>
                    <Button size="2" onClick={() => setConfirmacao('ativar')}>Ativar e gerar parcelas</Button>
                  </>
                )}
                {contrato.situacao === 'vigente' && (
                  <>
                    <Button size="2" variant="soft" color="gray" onClick={() => onEditar(contrato)}>Editar dados</Button>
                    <Button size="2" variant="soft" color="amber" onClick={() => setConfirmacao('encerrar')}>Encerrar</Button>
                    <Button size="2" variant="soft" color="red" onClick={() => setConfirmacao('cancelar')}>Cancelar</Button>
                  </>
                )}
                <Button size="2" variant="soft" color="gray" onClick={onFechar}>Fechar</Button>
              </Flex>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root open={confirmacao !== null} onOpenChange={aberto => !aberto && setConfirmacao(null)}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>{confirmacao ? textos[confirmacao].titulo : ''}</AlertDialog.Title>
          <AlertDialog.Description>{confirmacao ? textos[confirmacao].descricao : ''}</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button size="2" variant="soft" color="gray">Voltar</Button></AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                size="2"
                loading={ocupado}
                color={confirmacao === 'cancelar' ? 'red' : confirmacao === 'encerrar' ? 'amber' : undefined}
                onClick={() => void executar()}
              >
                {confirmacao ? textos[confirmacao].rotulo : ''}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  )
}
