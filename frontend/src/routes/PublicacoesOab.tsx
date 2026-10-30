import TextoTabela from '../TextoTabela'
import Carregamento from '../Carregamento'
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Accordion,
  AccordionItem,
  Button,
  Column,
  DataTable,
  DatePicker,
  DatePickerInput,
  Grid,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBatchAction,
  TableBatchActions,
  TableBody,
  TableCell,
  TableContainer,
  TableExpandedRow,
  TableExpandHeader,
  TableExpandRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAll,
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
} from '@carbon/react'
import { Archive, Checkmark, Undo } from '@carbon/icons-react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { useNavegacao } from '../api/NavegacaoContext'
import { formatarDataSimples, formatarDdMmAaaa, formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import { formatarData } from '../utils/listasRapidas'
import { traduzirTabela } from '../utils/tabela'
import { siglaTribunalPorNumero } from '../utils/tribunalPorNumero'

type DadosDjen = {
  data_disponibilizacao?: string
  tipoComunicacao?: string
  siglaTribunal?: string
  nomeOrgao?: string
  nomeClasse?: string
  numeroprocessocommascara?: string
  texto?: string
  link?: string
  destinatarios?: Array<{ nome?: string; polo?: string }>
  destinatarioadvogados?: Array<{ nome?: string; numero_oab?: string; uf_oab?: string }>
}

type PublicacaoOab = {
  hash: string
  status: 'nao_tratada' | 'tratada' | 'arquivada'
  criado_em?: string
  numero_processo?: string
  nome_pesquisado?: string
  dados?: DadosDjen
}

const ROTULO_STATUS: Record<string, string> = { nao_tratada: 'Não tratada', tratada: 'Tratada', arquivada: 'Arquivada' }
const TAG_STATUS: Record<string, 'red' | 'green' | 'gray'> = { nao_tratada: 'red', tratada: 'green', arquivada: 'gray' }
const TAMANHO_PAGINA = 20

export default function PublicacoesOab() {
  const { cliente } = useCliente()
  const [filtroStatus, setFiltroStatus] = useState('')
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [publicacoes, setPublicacoes] = useState<PublicacaoOab[] | null>(null)
  const [total, setTotal] = useState(0)
  const [aplicandoLote, setAplicandoLote] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const query = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO_PAGINA) })
      if (filtroStatus) query.set('status', filtroStatus)
      const dados = await buscarJson<{ publicacoes: PublicacaoOab[]; total?: number; pagina?: number }>(
        cliente,
        `/publicacoes-oab?${query}`,
      )
      setPublicacoes(dados.publicacoes ?? [])
      setTotal(dados.total ?? dados.publicacoes?.length ?? 0)
      if (dados.pagina) setPagina(dados.pagina)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
      setPublicacoes(null)
    } finally {
      setCarregando(false)
    }
  }, [cliente, filtroStatus, pagina])

  useEffect(() => {
    if (cliente) void carregar()
    else setCarregando(false)
  }, [cliente, carregar])

  function aoMudarFiltro(valor: string) {
    setFiltroStatus(valor)
    setPagina(1)
  }

  async function alterarStatus(pub: PublicacaoOab, novoStatus: string) {
    const anterior = pub.status
    setPublicacoes((atual) => atual?.map((p) => (p.hash === pub.hash ? { ...p, status: novoStatus as PublicacaoOab['status'] } : p)) ?? null)
    try {
      await enviarJson(cliente, '/publicacoes-oab/status', { hashes: [pub.hash], status: novoStatus })
    } catch (e) {
      setPublicacoes((atual) => atual?.map((p) => (p.hash === pub.hash ? { ...p, status: anterior } : p)) ?? null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar status.')
    }
  }

  async function aplicarStatusLote(hashes: string[], novoStatus: string) {
    if (!hashes.length) return
    setAplicandoLote(true)
    try {
      await enviarJson(cliente, '/publicacoes-oab/status', { hashes, status: novoStatus })
      carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar em lote.')
    } finally {
      setAplicandoLote(false)
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))

  return (
    <Stack gap={6}>
      <div>
        <h1>Publicações monitoradas</h1>
      </div>
      <Accordion>
        <AccordionItem title="Como funciona a captura">
          <p>As publicações dos monitoramentos por OAB são capturadas a cada 24 horas. Os avisos por e-mail, quando configurados, são verificados a cada 6 horas.</p>
          <p>Para criar um monitoramento, abra "Consultar publicações", informe a OAB, consulte e clique em "Criar monitoramento por e-mail".</p>
          <p>Para consultar um período agora e adicionar os resultados à lista, use "Capturar publicações por OAB" abaixo.</p>
        </AccordionItem>
        <AccordionItem title="O que significa cada status">
          <p>
            <strong>Não tratada</strong>: ainda não revisada.
          </p>
          <p>
            <strong>Tratada</strong>: revisada, com as providências necessárias tomadas.
          </p>
          <p>
            <strong>Arquivada</strong>: dispensada sem ação.
          </p>
        </AccordionItem>
      </Accordion>
      <CapturaManual onCapturado={carregar} />
      <div className="aj-layout-57">
        <div className="aj-layout-58">
          <Select id="pub-oab-filtro-status" labelText="Status" value={filtroStatus} onChange={(e) => aoMudarFiltro(e.target.value)}>
            <SelectItem value="" text="Todos" />
            <SelectItem value="nao_tratada" text="Não tratada" />
            <SelectItem value="tratada" text="Tratada" />
            <SelectItem value="arquivada" text="Arquivada" />
          </Select>
        </div>
        <Button kind="ghost" size="sm" onClick={carregar} disabled={carregando}>
          Atualizar lista
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && publicacoes && publicacoes.length === 0 && (
          <InlineNotification
            kind="info"
            title={filtroStatus ? 'Nenhuma publicação com este status' : 'Nenhuma publicação encontrada'}
            subtitle={filtroStatus ? 'Selecione Todos no filtro de status para ver as demais publicações.' : 'Use a captura manual para adicionar publicações à lista.'}
            lowContrast
            hideCloseButton
          />
        )}
        {!carregando && publicacoes && publicacoes.length > 0 && (
          <TabelaPublicacoesOab publicacoes={publicacoes} onAlterarStatus={alterarStatus} onAplicarLote={aplicarStatusLote} aplicandoLote={aplicandoLote} />
        )}
      </div>
      {total > TAMANHO_PAGINA && (
        <div className="aj-layout-59">
          <Button kind="ghost" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            Página {pagina} de {totalPaginas}
          </span>
          <Button kind="ghost" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </Stack>
  )
}

const CABECALHOS_OAB = [
  { key: 'tribunal', header: 'Tribunal' },
  { key: 'tipo', header: 'Tipo' },
  { key: 'classe', header: 'Classe' },
  { key: 'processo', header: 'Processo' },
  { key: 'divulgado', header: 'Divulgado em' },
  { key: 'status', header: 'Status' },
]

function TabelaPublicacoesOab({
  publicacoes,
  onAlterarStatus,
  onAplicarLote,
  aplicandoLote,
}: {
  publicacoes: PublicacaoOab[]
  onAlterarStatus: (p: PublicacaoOab, status: string) => void
  onAplicarLote: (hashes: string[], status: string) => void
  aplicandoLote: boolean
}) {
  const { irPara } = useNavegacao()
  const porHash = new Map(publicacoes.map((p) => [p.hash, p]))
  const linhas = publicacoes.map((p) => {
    const d = p.dados ?? {}
    return {
      id: p.hash,
      tribunal: (d.siglaTribunal ?? '?').toUpperCase(),
      tipo: d.tipoComunicacao ?? '—',
      classe: d.nomeClasse ?? 'Classe não informada',
      processo: formatarNumeroCNJ(d.numeroprocessocommascara ?? p.numero_processo) || 'não informado',
      divulgado: formatarDataSimples(d.data_disponibilizacao) || '—',
      status: ROTULO_STATUS[p.status] ?? p.status,
    }
  })

  return (
    <DataTable rows={linhas} headers={CABECALHOS_OAB} size="md" isSortable>
      {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps, getToolbarProps, getBatchActionProps, selectedRows, getTableProps, getExpandHeaderProps }) => {
        const batchActionProps = getBatchActionProps()
        return (
          <TableContainer className="oab-table">
            <TableToolbar {...getToolbarProps()}>
              <TableBatchActions {...batchActionProps} translateWithId={traduzirTabela}>
                <TableBatchAction
                  tabIndex={batchActionProps.shouldShowBatchActions ? 0 : -1}
                  renderIcon={Undo}
                  disabled={aplicandoLote}
                  onClick={() => onAplicarLote(selectedRows.map((r) => r.id), 'nao_tratada')}
                >
                  Marcar como não tratada
                </TableBatchAction>
                <TableBatchAction
                  tabIndex={batchActionProps.shouldShowBatchActions ? 0 : -1}
                  renderIcon={Checkmark}
                  disabled={aplicandoLote}
                  onClick={() => onAplicarLote(selectedRows.map((r) => r.id), 'tratada')}
                >
                  Marcar como tratada
                </TableBatchAction>
                <TableBatchAction
                  tabIndex={batchActionProps.shouldShowBatchActions ? 0 : -1}
                  renderIcon={Archive}
                  disabled={aplicandoLote}
                  onClick={() => onAplicarLote(selectedRows.map((r) => r.id), 'arquivada')}
                >
                  Marcar como arquivada
                </TableBatchAction>
              </TableBatchActions>
              <TableToolbarContent aria-hidden={batchActionProps.shouldShowBatchActions}>{null}</TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} aria-label="Publicações monitoradas">
              <TableHead>
                <TableRow>
                  <TableExpandHeader {...getExpandHeaderProps()} aria-label="Expandir todas as publicações" />
                  <TableSelectAll {...getSelectionProps()} aria-label="Selecionar todas as linhas" />
                  {headers.map((header) => (
                    <TableHeader {...getHeaderProps({ header })}>
                      {header.header}
                    </TableHeader>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const p = porHash.get(row.id)
                  const d = p?.dados ?? {}
                  const destinatarios = (d.destinatarios ?? []).map((x) => formatarNomeExibicao(x.nome)).filter(Boolean)
                  const advogados = (d.destinatarioadvogados ?? []).map((a) => `${formatarNomeExibicao(a.nome)} OAB ${a.numero_oab ?? '?'}/${a.uf_oab ?? '?'}`)
                  return (
                    <Fragment key={row.id}>
                      <TableExpandRow {...getRowProps({ row })} ariaLabel={row.isExpanded ? 'Recolher publicação' : 'Expandir publicação'}>
                        <TableSelectRow {...getSelectionProps({ row })} aria-label="Selecionar linha" />
                        {row.cells.map((cell) =>
                          cell.info.header === 'status' && p ? (
                            <TableCell key={cell.id}>
                              <div className="aj-layout-60">
                                <Tag type={TAG_STATUS[p.status] ?? 'gray'}>{cell.value}</Tag>
                                <div className="aj-layout-61">
                                  <Select
                                    id={`status-${p.hash}`}
                                    labelText={`Status da publicação ${p.numero_processo || p.hash}`}
                                    hideLabel
                                    size="sm"
                                    value={p.status}
                                    onChange={(e) => onAlterarStatus(p, e.target.value)}
                                  >
                                    <SelectItem value="nao_tratada" text="Não tratada" />
                                    <SelectItem value="tratada" text="Tratada" />
                                    <SelectItem value="arquivada" text="Arquivada" />
                                  </Select>
                                </div>
                              </div>
                            </TableCell>
                          ) : cell.info.header === 'processo' && p && !p.numero_processo ? (
                            <TableCell key={cell.id}>
                              <button
                                type="button"
                                className="contato-nome-link"
                                onClick={() => {
                                  const numero = d.numeroprocessocommascara ?? ''
                                  irPara('processo', { tribunal: siglaTribunalPorNumero(numero) ?? '', numero_processo: numero })
                                }}
                              >
                                Consultar processo
                              </button>
                            </TableCell>
                          ) : (
                            <TableCell key={cell.id}>{['classe', 'tipo', 'orgao', 'nome', 'referencia'].includes(cell.info.header) ? <TextoTabela texto={String(cell.value ?? '')} /> : cell.value}</TableCell>
                          ),
                        )}
                      </TableExpandRow>
                      <TableExpandedRow colSpan={headers.length + 2}>
                        <Stack gap={3}>
                          {p?.nome_pesquisado && <p>Referência: {formatarNomeExibicao(p.nome_pesquisado)}</p>}
                          {destinatarios.length > 0 && <p>Partes: {destinatarios.join(' · ')}</p>}
                          {advogados.length > 0 && <p>Advogados: {advogados.join(' · ')}</p>}
                          <p>capturado em {formatarData(p?.criado_em)}</p>
                          {d.texto && <p className="oab-inteiro-teor">{d.texto}</p>}
                          {d.link && (
                            <a href={d.link} target="_blank" rel="noopener noreferrer">
                              Ver no sistema do tribunal
                            </a>
                          )}
                        </Stack>
                      </TableExpandedRow>
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      }}
    </DataTable>
  )
}

function CapturaManual({ onCapturado }: { onCapturado: () => void }) {
  const { cliente } = useCliente()
  const [numeroOab, setNumeroOab] = useState('')
  const [ufOab, setUfOab] = useState('')
  const [nome, setNome] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setStatus('Consultando o DJEN…')
    try {
      const resultado = (await enviarJson(cliente, '/publicacoes-oab/capturar-manual', {
        numero_oab: numeroOab.trim(),
        uf_oab: ufOab.trim(),
        nome: nome.trim(),
        data_inicio: dataInicio,
        data_fim: dataFim,
      })) as { encontradas: number; novas: number }
      setStatus(
        `${resultado.encontradas} ${resultado.encontradas === 1 ? 'publicação encontrada' : 'publicações encontradas'} no DJEN. ` +
          `${resultado.novas} ${resultado.novas === 1 ? 'nova publicação adicionada' : 'novas publicações adicionadas'} à lista.`,
      )
      onCapturado()
    } catch (e) {
      setStatus(e instanceof ErroMCP ? e.message : 'Falha inesperada.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Accordion>
      <AccordionItem title="Capturar publicações por OAB">
        <form onSubmit={aoEnviar}>
          <Stack gap={5}>
            <Grid narrow fullWidth>
              <Column sm={4} md={2} lg={2}>
                <TextInput
                  id="pub-oab-manual-numero"
                  labelText="Número da OAB"
                  placeholder="Ex.: 330659"
                  maxLength={6}
                  autoComplete="off"
                  required
                  value={numeroOab}
                  onChange={(e) => setNumeroOab(e.target.value)}
                />
              </Column>
              <Column sm={4} md={2} lg={2}>
                <TextInput
                  id="pub-oab-manual-uf"
                  labelText="UF da OAB (opcional)"
                  placeholder="Ex.: SP"
                  maxLength={2}
                  autoComplete="off"
                  value={ufOab}
                  onChange={(e) => setUfOab(e.target.value)}
                />
              </Column>
              <Column sm={4} md={4} lg={5}>
                <TextInput
                  id="pub-oab-manual-nome"
                  labelText="Nome para identificar os registros (opcional)"
                  placeholder="Ex.: Maria Silva"
                  helperText="Identifica os registros na lista; não filtra a consulta no DJEN."
                  autoComplete="off"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </Column>
              <Column sm={4} md={8} lg={7}>
                <DatePicker
                  datePickerType="range"
                  dateFormat="Y-m-d"
                  onChange={(datas: Date[]) => {
                    const [inicio, fim] = datas
                    setDataInicio(inicio ? isoDeData(inicio) : '')
                    setDataFim(fim ? isoDeData(fim) : '')
                  }}
                >
                  <DatePickerInput id="pub-oab-manual-data-inicio" labelText="Data inicial" placeholder="aaaa-mm-dd" />
                  <DatePickerInput id="pub-oab-manual-data-fim" labelText="Data final" placeholder="aaaa-mm-dd" />
                </DatePicker>
              </Column>
            </Grid>
            <div>
              <Button type="submit" size="sm" disabled={enviando}>
                Capturar agora
              </Button>
            </div>
            {status && <p role="status">{status}</p>}
          </Stack>
        </form>
      </AccordionItem>
    </Accordion>
  )
}

function isoDeData(data: Date): string {
  const [dia, mes, ano] = formatarDdMmAaaa(data).split('/')
  return `${ano}-${mes}-${dia}`
}
