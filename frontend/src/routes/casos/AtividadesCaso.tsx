import AcoesTabela from '../../AcoesTabela'
import { useAvisos } from '../../Avisos'
import Carregamento from '../../Carregamento'
import TabelaResponsiva from '../../TabelaResponsiva'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertDialog, Badge, Button, Callout, Checkbox, Flex, IconButton, Text } from '@radix-ui/themes'
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import {
  COR_STATUS, COR_TIPO, dataCurta, grupoDe, isoLocal, ORDEM_GRUPOS, quandoRelativo, ROTULO_STATUS, ROTULO_TIPO, TITULO_GRUPO, type Grupo,
} from '../atividades/dados'
import AtividadeModal from './AtividadeModal'
import AgendaAtividade, { type VinculoAgenda } from './AgendaAtividade'
import '../atividades/atividades.scss'

export type Atividade = {
  id: string
  tipo: string
  titulo: string
  status: string
  data?: string | null
  hora?: string | null
  responsavel?: string | null
  observacoes?: string | null
  agenda?: VinculoAgenda | null
  agenda_institucional_anterior?: boolean
  origem_djen_hash?: string | null
  checklist?: { total: number; concluidos: number } | null
}

export default function AtividadesCaso({ casoId, atividadeInicialId, onAlterado }: {
  casoId: string; atividadeInicialId?: string | number; onAlterado?: () => void
}) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const estreita = useEstreita()
  const [hoje] = useState(() => isoLocal(new Date()))
  const [operando, setOperando] = useState(false)
  const [erroLocal, setErro] = useState<string | null>(null)
  const [situacao, setSituacao] = useState<'abertas' | 'concluidas'>('abertas')
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Atividade | null>(null)
  const [paraExcluir, setParaExcluir] = useState<Atividade | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const destinoConsumido = useRef(false)

  const consulta = useQuery({
    queryKey: ['caso-atividades', cliente?.token, casoId],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ atividades: Atividade[]; agenda_disponivel?: boolean }>(cliente, `/casos/${casoId}/atividades`, signal)
      .then(r => ({ atividades: r.atividades ?? [], agendaDisponivel: Boolean(r.agenda_disponivel) })),
  })
  const atividades = consulta.data?.atividades ?? null
  const agendaDisponivel = consulta.data?.agendaDisponivel ?? false
  const carregando = consulta.isLoading
  const erro = erroLocal ?? (consulta.error ? (consulta.error instanceof ErroMCP ? consulta.error.message : 'Falha ao carregar.') : null)
  const carregar = () => { setErro(null); void consulta.refetch() }

  useEffect(() => {
    if (atividadeInicialId == null || !atividades || carregando || destinoConsumido.current) return
    destinoConsumido.current = true
    const atividade = atividades.find(item => String(item.id) === String(atividadeInicialId))
    if (!atividade) {
      setErro('A atividade desta notificação não está mais disponível. Atualize as notificações.')
      return
    }
    setEditando(atividade)
    setModalAberto(true)
  }, [atividadeInicialId, atividades, carregando])

  const abertas = useMemo(() => (atividades ?? []).filter(a => a.status !== 'concluida'), [atividades])
  const concluidas = useMemo(() => (atividades ?? []).filter(a => a.status === 'concluida')
    .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '')), [atividades])
  const visiveis = situacao === 'abertas' ? abertas : concluidas
  const grupos = useMemo(() => {
    if (situacao === 'concluidas') return [{ grupo: null as Grupo | null, itens: concluidas }]
    const ordenadas = [...abertas].sort((a, b) =>
      (a.data ?? '9999').localeCompare(b.data ?? '9999') || (a.hora ?? '99').localeCompare(b.hora ?? '99'))
    return ORDEM_GRUPOS.map(g => ({ grupo: g as Grupo | null, itens: ordenadas.filter(a => grupoDe(a, hoje) === g) })).filter(g => g.itens.length)
  }, [situacao, abertas, concluidas, hoje])
  const lote = selecionadas.size > 0
  const todasVisiveis = visiveis.length > 0 && visiveis.every(a => selecionadas.has(String(a.id)))

  type Par = [Atividade, Record<string, unknown>]
  async function aplicar(pares: Par[]) {
    const feitas: Atividade[] = []
    let falha = ''
    for (const [a, campos] of pares) {
      try {
        await enviarJson(cliente, `/casos/${casoId}/atividades/${a.id}`, campos, 'PATCH')
        feitas.push(a)
      } catch (e) { falha = e instanceof ErroMCP ? e.message : 'Falha ao atualizar.' }
    }
    if (falha) avisar({ tipo: 'erro', texto: falha })
    return feitas
  }
  async function atualizar(alvos: Atividade[], campos: Record<string, unknown>) {
    if (!alvos.length || operando) return
    setOperando(true)
    const feitas = await aplicar(alvos.map(a => [a, campos] as Par))
    const ids = new Set(feitas.map(a => String(a.id)))
    setSelecionadas(s => new Set([...s].filter(id => !ids.has(id))))
    setOperando(false)
    carregar()
    onAlterado?.()
    if (!feitas.length) return
    const anteriores: Par[] = feitas.map(a => [a, Object.fromEntries(Object.keys(campos).map(k => [k, (a as Record<string, unknown>)[k] ?? null]))])
    const novo = typeof campos.status === 'string' ? (ROTULO_STATUS[campos.status] ?? campos.status).toLowerCase() : 'atualizada'
    avisar({
      texto: feitas.length === 1 ? `“${feitas[0].titulo}”: ${novo}.` : `${feitas.length} atividades: ${novo}.`,
      desfazer: async () => { await aplicar(anteriores); carregar(); onAlterado?.() },
    })
  }
  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${paraExcluir.id}`, {}, 'DELETE')
      avisar({ texto: `Atividade “${paraExcluir.titulo}” excluída.` })
      setParaExcluir(null)
      carregar()
      onAlterado?.()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao excluir.' })
    } finally {
      setExcluindo(false)
    }
  }
  function alternar(conjunto: 'sel' | 'exp', id: string) {
    const setar = conjunto === 'sel' ? setSelecionadas : setExpandidas
    setar(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const editar = (a: Atividade) => { setEditando(a); setModalAberto(true) }

  function acaoPrincipal(a: Atividade, grande = false) {
    const props = { size: (grande ? '3' : '1') as '1' | '3', style: grande ? { flex: 1 } : undefined, disabled: operando || lote }
    return a.status === 'concluida'
      ? <Button {...props} variant="soft" color="gray" onClick={() => atualizar([a], { status: 'pendente' })}>Reabrir</Button>
      : <Button {...props} variant="soft" onClick={() => atualizar([a], { status: 'concluida' })}>Concluir</Button>
  }
  function menu(a: Atividade) {
    const mudar = (status: string) => ({ texto: `Marcar como “${ROTULO_STATUS[status].toLowerCase()}”`, desabilitada: operando || a.status === status, executar: () => atualizar([a], { status }) })
    return <AcoesTabela rotulo={a.titulo} acoes={[
      { texto: 'Editar atividade e checklist', executar: () => editar(a) },
      ...(a.status === 'concluida' ? [] : [mudar('pendente'), mudar('em_andamento'), mudar('aguardando')]),
      { texto: 'Excluir', executar: () => setParaExcluir(a), perigo: true },
    ]} />
  }
  function checklist(a: Atividade) {
    if (!a.checklist?.total) return <Text size="1" color="gray">—</Text>
    const { total, concluidos } = a.checklist
    return (
      <div>
        <Text size="1">{concluidos} de {total} itens</Text>
        <div className="atividades-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={concluidos} aria-label="Checklist">
          <div style={{ width: `${Math.round((concluidos / total) * 100)}%` }} />
        </div>
      </div>
    )
  }
  function tituloCelula(a: Atividade) {
    return (
      <>
        <div className="atividades-titulo">{formatarNomeExibicao(a.titulo)}</div>
        <Flex gap="2" align="center" mt="1" wrap="wrap">
          <Badge color={COR_TIPO[a.tipo] ?? 'gray'} variant="soft">{ROTULO_TIPO[a.tipo] ?? a.tipo}</Badge>
          {a.origem_djen_hash && <Text size="1" color="gray">criada a partir de uma publicação</Text>}
          {a.agenda && <Text size="1" color="gray">na agenda Google</Text>}
        </Flex>
      </>
    )
  }
  function detalhes(a: Atividade) {
    return (
      <div className="atividades-detalhes">
        <div>
          <Text as="p" size="1" weight="bold" color="gray" className="atividades-rotulo">Observações</Text>
          <Text as="p" size="2">{a.observacoes || 'Sem observações.'}</Text>
        </div>
        {(a.agenda || agendaDisponivel) && (
          <AgendaAtividade casoId={casoId} atividadeId={a.id} titulo={a.titulo} data={a.data} hora={a.hora}
            agenda={a.agenda} agendaInstitucionalAnterior={a.agenda_institucional_anterior}
            agendaDisponivel={agendaDisponivel} onAtualizado={carregar} />
        )}
      </div>
    )
  }
  const atrasada = (a: Atividade) => a.status !== 'concluida' && grupoDe(a, hoje) === 'atrasadas'
  const situacaoSelo = (a: Atividade) => <Badge color={COR_STATUS[a.status] ?? 'gray'} variant="soft" radius="full">{ROTULO_STATUS[a.status] ?? a.status}</Badge>

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="2" wrap="wrap">
        <div className="atividades-atalhos" role="group" aria-label="Situação das atividades">
          {([['abertas', 'Abertas', abertas.length], ['concluidas', 'Concluídas', concluidas.length]] as const).map(([valor, rotulo, qtd]) => {
            const ativo = situacao === valor
            return (
              <Button key={valor} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
                aria-pressed={ativo} onClick={() => { setSituacao(valor); setSelecionadas(new Set()) }}>
                {rotulo} <Text size="1" color="gray">{qtd}</Text>
              </Button>
            )
          })}
        </div>
        <Button size="2" ml="auto" onClick={() => { setEditando(null); setModalAberto(true) }}>Nova atividade</Button>
      </Flex>

      {lote && (
        <div className="atividades-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">{selecionadas.size} selecionada(s)</Text>
          {situacao === 'abertas'
            ? <Button size="1" disabled={operando} onClick={() => atualizar(visiveis.filter(a => selecionadas.has(String(a.id))), { status: 'concluida' })}>Concluir</Button>
            : <Button size="1" disabled={operando} onClick={() => atualizar(visiveis.filter(a => selecionadas.has(String(a.id))), { status: 'pendente' })}>Reabrir</Button>}
          <Button size="1" variant="ghost" disabled={operando} onClick={() => setSelecionadas(new Set())}>Cancelar</Button>
        </div>
      )}

      <div aria-live="polite">
        {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && atividades && !visiveis.length && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>{situacao === 'abertas' ? 'Nenhuma atividade aberta neste processo.' : 'Nenhuma atividade concluída ainda.'}</Callout.Text>
          </Callout.Root>
        )}
      </div>

      {!carregando && visiveis.length > 0 && (estreita ? (
        <div className="atividades-cartoes">
          {grupos.map(({ grupo, itens }) => (
            <section key={grupo ?? 'todas'} aria-label={grupo ? TITULO_GRUPO[grupo] : 'Concluídas'}>
              {grupo && <h3 className={`atividades-grupo-titulo${grupo === 'atrasadas' ? ' atividades-alerta' : ''}`}>{TITULO_GRUPO[grupo]} · {itens.length}</h3>}
              <ul>
                {itens.map(a => (
                  <li key={a.id} className="atividades-cartao">
                    <div className="atividades-cartao-corpo">
                      <Flex gap="2" align="center" wrap="wrap">
                        <Checkbox aria-label={`Selecionar ${a.titulo}`} checked={selecionadas.has(String(a.id))} onCheckedChange={() => alternar('sel', String(a.id))} />
                        <Text size="2" weight="bold" className={atrasada(a) ? 'atividades-alerta' : undefined}>{dataCurta(a.data)}</Text>
                        <Text size="1" color="gray">{quandoRelativo(a, hoje)}</Text>
                        <span style={{ marginLeft: 'auto' }}>{situacaoSelo(a)}</span>
                      </Flex>
                      {tituloCelula(a)}
                      <Text size="1" color="gray">{a.responsavel ? formatarNomeExibicao(a.responsavel) : 'Sem responsável'}</Text>
                      {a.checklist?.total ? checklist(a) : null}
                      {expandidas.has(String(a.id)) && detalhes(a)}
                      <Flex gap="2" mt="1">
                        {acaoPrincipal(a, true)}
                        <Button size="3" variant="soft" color="gray" aria-expanded={expandidas.has(String(a.id))} onClick={() => alternar('exp', String(a.id))}>
                          {expandidas.has(String(a.id)) ? 'Fechar' : 'Detalhes'}
                        </Button>
                        {menu(a)}
                      </Flex>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <TabelaResponsiva principais={['Atividade']}>
          <table aria-label={situacao === 'abertas' ? 'Atividades abertas do processo' : 'Atividades concluídas do processo'} className="atividades-tabela">
            <thead>
              <tr>
                <th aria-label="Detalhes" />
                <th className="tabela-controle">
                  <Checkbox aria-label="Selecionar todas" checked={todasVisiveis ? true : lote ? 'indeterminate' : false}
                    onCheckedChange={() => setSelecionadas(todasVisiveis ? new Set() : new Set(visiveis.map(a => String(a.id))))} />
                </th>
                <th className="atividades-col-quando">Quando</th>
                <th>Atividade</th>
                <th className="atividades-col-resp">Responsável</th>
                <th className="atividades-col-checklist">Checklist</th>
                <th className="atividades-col-situacao">Situação</th>
                <th className="tabela-acoes atividades-col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(({ grupo, itens }) => (
                <Fragment key={grupo ?? 'todas'}>
                  {grupo && (
                    <tr className="atividades-grupo">
                      <td colSpan={8}>
                        <span className={grupo === 'atrasadas' ? 'atividades-alerta' : undefined}>{TITULO_GRUPO[grupo]}</span>
                        <span className="atividades-grupo-qtd">{itens.length}</span>
                      </td>
                    </tr>
                  )}
                  {itens.map(a => {
                    const aberta = expandidas.has(String(a.id))
                    return (
                      <Fragment key={a.id}>
                        <tr className={selecionadas.has(String(a.id)) ? 'atividades-selecionada' : undefined}>
                          <td>
                            <IconButton variant="ghost" size="1" aria-expanded={aberta} aria-label={`${aberta ? 'Recolher' : 'Expandir'} ${a.titulo}`} onClick={() => alternar('exp', String(a.id))}>
                              {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </IconButton>
                          </td>
                          <td className="tabela-controle">
                            <Checkbox aria-label={`Selecionar ${a.titulo}`} checked={selecionadas.has(String(a.id))} onCheckedChange={() => alternar('sel', String(a.id))} />
                          </td>
                          <td>
                            <div className="atividades-data">{dataCurta(a.data)}</div>
                            <div className={atrasada(a) ? 'atividades-relativo atividades-alerta' : 'atividades-relativo'}>{quandoRelativo(a, hoje)}</div>
                          </td>
                          <td>{tituloCelula(a)}</td>
                          <td>{a.responsavel ? formatarNomeExibicao(a.responsavel) : <Text color="gray">Sem responsável</Text>}</td>
                          <td>{checklist(a)}</td>
                          <td>{situacaoSelo(a)}</td>
                          <td className="tabela-acoes"><Flex gap="1" justify="end" align="center">{acaoPrincipal(a)}{menu(a)}</Flex></td>
                        </tr>
                        {aberta && (
                          <tr><td colSpan={8} className="atividades-detalhes-celula">{detalhes(a)}</td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TabelaResponsiva>
      ))}

      <AtividadeModal
        open={modalAberto}
        casoId={casoId}
        atividade={editando}
        onClose={() => setModalAberto(false)}
        onSalva={() => { setModalAberto(false); carregar(); onAlterado?.() }}
      />
      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir atividade</AlertDialog.Title>
          <AlertDialog.Description>Excluir "{paraExcluir?.titulo}"?</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={excluindo} onClick={confirmarExclusao}>Excluir</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
