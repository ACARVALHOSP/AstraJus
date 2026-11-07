import LinhaFiltros from '../LinhaFiltros'
import CabecalhoPagina from '../CabecalhoPagina'
import Paginacao, { paginaPara, POR_PAGINA } from '../Paginacao'
import { useAvisos } from '../Avisos'
import CampoData from '../CampoData'
import Carregamento from '../Carregamento'
import TabelaResponsiva from '../TabelaResponsiva'
import AcoesTabela from '../AcoesTabela'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Callout, Checkbox, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, CalendarCheck, Info } from 'lucide-react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import AtividadeModal from './casos/AtividadeModal'
import type { Atividade as AtividadeCaso } from './casos/AtividadesCaso'
import './atividades/atividades.scss'
import {
  COR_STATUS, COR_TIPO, dataCurta, grupoDe, isoLocal, ORDEM_GRUPOS, quandoRelativo, ROTULO_STATUS, ROTULO_TIPO, TITULO_GRUPO, type Atalho, type Grupo,
} from './atividades/dados'

type CasoResumo = { id: string; titulo?: string | null; responsavel?: string | null; processos?: string[] }
type Atividade = {
  id: number | string; caso_id: string; titulo: string; tipo: string; status: string
  responsavel?: string | null; data?: string | null; hora?: string | null; observacoes?: string | null
  caso: CasoResumo; agenda?: unknown
}
const chave = (a: Atividade) => `${a.caso_id}:${a.id}`

export default function Atividades() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const estreita = useEstreita()
  const [hoje, setHoje] = useState(() => isoLocal(new Date()))
  const [situacao, setSituacao] = useState<'abertas' | 'concluidas'>('abertas')
  const [atalho, setAtalho] = useState<Atalho>('')
  const [tipo, setTipo] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [responsavelProcesso, setResponsavelProcesso] = useState('')
  const [textoBusca, setTextoBusca] = useState(''), [busca, setBusca] = useState('')
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [responsaveis, setResponsaveis] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true), [operando, setOperando] = useState(false)
  const [erro, setErro] = useState('')
  const { avisar } = useAvisos()
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [dialogo, setDialogo] = useState<'' | 'reatribuir' | 'data' | 'nova'>('')
  const [novoResponsavel, setNovoResponsavel] = useState(''), [novaData, setNovaData] = useState('')
  const [processoNovo, setProcessoNovo] = useState(''), [processos, setProcessos] = useState<CasoResumo[]>([])
  const [editando, setEditando] = useState<{ casoId: string; atividade: AtividadeCaso | null } | null>(null)
  const sequencia = useRef(0)

  useEffect(() => {
    const espera = window.setTimeout(() => setBusca(textoBusca.trim()), 400)
    return () => window.clearTimeout(espera)
  }, [textoBusca])
  useEffect(() => {
    // Vira o dia sem recarregar a página: reagrupa as atividades à meia-noite.
    const relogio = window.setInterval(() => setHoje(isoLocal(new Date())), 60_000)
    return () => window.clearInterval(relogio)
  }, [])

  const carregar = useCallback(async () => {
    const pedido = ++sequencia.current
    if (!cliente) { setCarregando(false); return }
    setCarregando(true); setErro('')
    try {
      const query = new URLSearchParams({
        situacao, ...(tipo ? { tipo } : {}), ...(responsavel ? { responsavel } : {}),
        ...(responsavelProcesso ? { responsavel_processo: responsavelProcesso } : {}), ...(busca ? { busca } : {}),
      })
      const dados = await buscarJson<{ atividades: Atividade[] }>(cliente, `/atividades?${query}`)
      if (pedido !== sequencia.current) return
      setAtividades(dados.atividades ?? [])
      const visiveis = new Set((dados.atividades ?? []).map(chave))
      setSelecionadas(s => new Set([...s].filter(k => visiveis.has(k))))
    } catch (e) {
      if (pedido === sequencia.current) setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar as atividades. Tente de novo.')
    } finally { if (pedido === sequencia.current) setCarregando(false) }
  }, [cliente, situacao, tipo, responsavel, responsavelProcesso, busca])
  useEffect(() => {
    const controle = sequencia
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
    return () => { controle.current++ }
  }, [carregar])
  useEffect(() => {
    if (!cliente) return
    buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis').then(r => setResponsaveis(r.responsaveis ?? [])).catch(() => {})
  }, [cliente])

  const contagem = useMemo(() => {
    const c: Record<Grupo, number> = { atrasadas: 0, hoje: 0, semana: 0, depois: 0, sem_data: 0 }
    for (const a of atividades) c[grupoDe(a, hoje)]++
    return c
  }, [atividades, hoje])
  const visiveis = useMemo(() => situacao === 'concluidas' || !atalho ? atividades : atividades.filter(a => grupoDe(a, hoje) === atalho), [atividades, atalho, situacao, hoje])
  // 20 por página; volta para a 1ª página quando os filtros mudam. Os grupos (Atrasadas, Hoje…)
  // são montados com os itens da página, que já vêm em ordem de data.
  const chavePagina = [situacao, atalho, tipo, responsavel, responsavelProcesso, busca].join('|')
  const [estadoPagina, setEstadoPagina] = useState({ chave: chavePagina, pagina: 1 })
  const pagina = paginaPara(estadoPagina, chavePagina)
  const naPagina = useMemo(() => visiveis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA), [visiveis, pagina])
  const grupos = useMemo(() => {
    if (situacao === 'concluidas') return [{ grupo: null as Grupo | null, itens: naPagina }]
    return ORDEM_GRUPOS.map(g => ({ grupo: g as Grupo | null, itens: naPagina.filter(a => grupoDe(a, hoje) === g) })).filter(g => g.itens.length)
  }, [naPagina, situacao, hoje])
  const responsaveisProcesso = useMemo(() => [...new Set(atividades.map(a => a.caso.responsavel).filter((r): r is string => Boolean(r)))].sort(), [atividades])
  const filtrosAtivos = Boolean(tipo || responsavel || responsavelProcesso || busca)
  const lote = selecionadas.size > 0
  const ocupado = carregando || operando
  const todasVisiveis = naPagina.length > 0 && naPagina.every(a => selecionadas.has(chave(a)))

  function alternar(a: Atividade) {
    setSelecionadas(s => { const n = new Set(s); const k = chave(a); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  type Par = [Atividade, Record<string, unknown>]
  async function aplicar(pares: Par[]) {
    const feitas: Atividade[] = []
    const falhas: string[] = []
    for (const [a, campos] of pares) {
      try {
        await enviarJson(cliente, `/casos/${a.caso_id}/atividades/${a.id}`, campos, 'PATCH')
        feitas.push(a)
      } catch (e) { falhas.push(`${a.titulo}: ${e instanceof ErroMCP ? e.message : 'falha inesperada'}`) }
    }
    if (falhas.length) avisar({ tipo: 'erro', texto: `Não foi possível atualizar ${falhas.length}: ${falhas.join('; ')}` })
    return feitas
  }
  async function atualizar(alvos: Atividade[], campos: Record<string, unknown>, descricao: string) {
    if (!alvos.length || operando) return
    setOperando(true)
    const feitas = await aplicar(alvos.map(a => [a, campos] as Par))
    // Falhas continuam selecionadas para nova tentativa.
    const chavesFeitas = new Set(feitas.map(chave))
    setSelecionadas(s => new Set([...s].filter(k => !chavesFeitas.has(k))))
    setOperando(false)
    await carregar()
    if (!feitas.length) return
    // Guarda os valores anteriores de cada atividade para o "Desfazer".
    const anteriores: Par[] = feitas.map(a => [a, Object.fromEntries(Object.keys(campos).map(k => [k, (a as Record<string, unknown>)[k] ?? null]))])
    avisar({
      texto: feitas.length === 1 ? `“${feitas[0].titulo}” ${descricao.slice(0, -1)}.` : `${feitas.length} atividades ${descricao}.`,
      desfazer: async () => { await aplicar(anteriores); await carregar() },
    })
  }
  const selecionadasLista = () => atividades.filter(a => selecionadas.has(chave(a)))
  function abrirProcesso(a: Atividade) { irPara('casos', { id: a.caso_id, aba: 'atividades', atividadeId: a.id }) }
  function editar(a: Atividade) {
    setEditando({ casoId: a.caso_id, atividade: { ...a, id: String(a.id) } as unknown as AtividadeCaso })
  }
  async function abrirNova() {
    setProcessoNovo(''); setDialogo('nova')
    try {
      const r = await buscarJson<{ casos: CasoResumo[] }>(cliente, '/casos')
      setProcessos(r.casos ?? [])
    } catch (e) { setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar os processos.') }
  }

  function acaoPrincipal(a: Atividade, grande = false) {
    const tamanho = grande ? '3' : '1'
    return a.status === 'concluida'
      ? <Button size={tamanho} variant="soft" color="gray" style={grande ? { flex: 1 } : undefined} disabled={ocupado || lote} onClick={() => atualizar([a], { status: 'pendente' }, 'reabertas')}>Reabrir</Button>
      : <Button size={tamanho} variant="soft" style={grande ? { flex: 1 } : undefined} disabled={ocupado || lote} onClick={() => atualizar([a], { status: 'concluida' }, 'concluídas')}>Concluir</Button>
  }
  function menu(a: Atividade) {
    const bloqueado = ocupado || lote
    const mudar = (status: string) => ({ texto: `Marcar como “${ROTULO_STATUS[status].toLowerCase()}”`, desabilitada: bloqueado || a.status === status, executar: () => atualizar([a], { status }, 'atualizadas') })
    return <AcoesTabela rotulo={a.titulo} acoes={[
      { texto: 'Abrir processo', executar: () => abrirProcesso(a) },
      { texto: 'Editar atividade', desabilitada: bloqueado, executar: () => editar(a) },
      ...(a.status === 'concluida' ? [] : [mudar('pendente'), mudar('em_andamento'), mudar('aguardando')]),
    ]} />
  }
  const seloTipo = (a: Atividade) => <Badge color={COR_TIPO[a.tipo] ?? 'gray'} variant="soft">{ROTULO_TIPO[a.tipo] ?? a.tipo}</Badge>
  const seloStatus = (a: Atividade) => <Badge color={COR_STATUS[a.status] ?? 'gray'} variant="soft" radius="full">{ROTULO_STATUS[a.status] ?? a.status}</Badge>
  const atrasada = (a: Atividade) => a.status !== 'concluida' && grupoDe(a, hoje) === 'atrasadas'
  const processoNumero = (a: Atividade) => formatarNumeroCNJ(a.caso.processos?.[0] ?? '')
  const tituloProcesso = (a: Atividade) => formatarNomeExibicao(a.caso.titulo) || 'Processo sem título'

  const atalhos: Array<{ valor: Atalho; rotulo: string; qtd: number; alerta?: boolean }> = [
    { valor: 'atrasadas', rotulo: 'Atrasadas', qtd: contagem.atrasadas, alerta: true },
    { valor: 'hoje', rotulo: 'Hoje', qtd: contagem.hoje },
    { valor: 'semana', rotulo: 'Próximos 7 dias', qtd: contagem.semana },
    { valor: 'sem_data', rotulo: 'Sem data', qtd: contagem.sem_data },
    { valor: '', rotulo: 'Todas abertas', qtd: situacao === 'abertas' ? atividades.length : 0 },
  ]

  return (
    <Flex direction="column" gap="5" className="atividades-tela">
      <CabecalhoPagina
        titulo="Atividades"
        descricao="Prazos, audiências e tarefas de todos os processos, em ordem de data. As datas são as cadastradas, sem cálculo de prazo."
        acoes={<>
          <Button variant="soft" color="gray" size="2" onClick={carregar} disabled={ocupado}>Atualizar</Button>
          <Button size="2" disabled={!cliente} onClick={abrirNova}>Nova atividade</Button>
        </>}
      />

      <div className="atividades-atalhos" role="group" aria-label="Período">
        {atalhos.map(a => {
          const ativo = situacao === 'abertas' && atalho === a.valor
          return (
            <Button key={a.valor || 'todas'} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
              aria-pressed={ativo} disabled={carregando && situacao === 'abertas'}
              onClick={() => { setSituacao('abertas'); setAtalho(a.valor); setSelecionadas(new Set()) }}>
              {a.rotulo}
              {situacao === 'abertas' && (a.alerta && a.qtd > 0
                ? <Badge color="red" variant="solid" radius="full">{a.qtd}</Badge>
                : <Text size="1" color="gray">{a.qtd}</Text>)}
            </Button>
          )
        })}
        <Button size="2" radius="full" variant={situacao === 'concluidas' ? 'soft' : 'outline'} color={situacao === 'concluidas' ? undefined : 'gray'}
          aria-pressed={situacao === 'concluidas'} onClick={() => { setSituacao('concluidas'); setAtalho(''); setSelecionadas(new Set()) }}>
          <CalendarCheck size={14} aria-hidden="true" /> Concluídas
        </Button>
      </div>

      <LinhaFiltros ativos={[tipo, responsavel, responsavelProcesso].filter(Boolean).length}>
        <div className="form-campo aj-filtros-busca">
          <label className="form-campo-label" htmlFor="atividades-busca">Buscar</label>
          <TextField.Root id="atividades-busca" type="search" placeholder="Atividade, processo ou número" autoComplete="off"
            value={textoBusca} onChange={e => setTextoBusca(e.target.value)} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="atividades-resp-rotulo">Responsável pela atividade</label>
          <Select.Root value={responsavel || '__todos__'} onValueChange={v => setResponsavel(v === '__todos__' ? '' : v)}>
            <Select.Trigger aria-labelledby="atividades-resp-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os responsáveis</Select.Item>
              {responsaveis.map(r => <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}
              <Select.Item value="__sem__">Sem responsável</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="atividades-tipo-rotulo">Tipo</label>
          <Select.Root value={tipo || '__todos__'} onValueChange={v => setTipo(v === '__todos__' ? '' : v)}>
            <Select.Trigger aria-labelledby="atividades-tipo-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os tipos</Select.Item>
              {Object.entries(ROTULO_TIPO).map(([v, r]) => <Select.Item key={v} value={v}>{r}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="atividades-proc-rotulo">Responsável pelo processo</label>
          <Select.Root value={responsavelProcesso || '__todos__'} onValueChange={v => setResponsavelProcesso(v === '__todos__' ? '' : v)}>
            <Select.Trigger aria-labelledby="atividades-proc-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os responsáveis</Select.Item>
              {[...new Set([...responsaveisProcesso, ...(responsavelProcesso ? [responsavelProcesso] : [])])].map(r =>
                <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        {filtrosAtivos && (
          <Button variant="soft" color="gray" size="2" onClick={() => { setTipo(''); setResponsavel(''); setResponsavelProcesso(''); setTextoBusca(''); setBusca('') }}>
            Limpar filtros
          </Button>
        )}
      </LinhaFiltros>

      {lote && (
        <div className="atividades-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">{selecionadas.size} selecionada(s)</Text>
          {situacao === 'abertas'
            ? <Button size="1" disabled={ocupado} onClick={() => atualizar(selecionadasLista(), { status: 'concluida' }, 'concluídas')}>Concluir</Button>
            : <Button size="1" disabled={ocupado} onClick={() => atualizar(selecionadasLista(), { status: 'pendente' }, 'reabertas')}>Reabrir</Button>}
          <Button size="1" variant="soft" color="gray" disabled={ocupado} onClick={() => { setNovoResponsavel(''); setDialogo('reatribuir') }}>Reatribuir</Button>
          <Button size="1" variant="soft" color="gray" disabled={ocupado} onClick={() => { setNovaData(''); setDialogo('data') }}>Mudar data</Button>
          <Button size="1" variant="ghost" disabled={operando} onClick={() => setSelecionadas(new Set())}>Cancelar</Button>
        </div>
      )}

      <section aria-label="Lista de atividades" aria-busy={ocupado}>
        {estreita ? (
          <div className="atividades-cartoes">
            {grupos.map(({ grupo, itens }) => (
              <section key={grupo ?? 'todas'} aria-label={grupo ? TITULO_GRUPO[grupo] : 'Concluídas'}>
                {grupo && <h2 className={`atividades-grupo-titulo${grupo === 'atrasadas' ? ' atividades-alerta' : ''}`}>{TITULO_GRUPO[grupo]} · {itens.length}</h2>}
                <ul>
                  {itens.map(a => {
                    const [, m, d] = (a.data ?? '').slice(0, 10).split('-')
                    return (
                      <li key={chave(a)} className="atividades-cartao">
                        <div className={`atividades-cartao-data${atrasada(a) ? ' atividades-alerta' : ''}`}>
                          <span className="atividades-cartao-dia">{a.data ? d : '—'}</span>
                          <span className="atividades-cartao-mes">{a.data ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] : 'sem data'}</span>
                          <span className="atividades-cartao-hora">{quandoRelativo(a, hoje)}</span>
                        </div>
                        <div className="atividades-cartao-corpo">
                          <Flex gap="2" align="center" wrap="wrap">
                            <Checkbox aria-label={`Selecionar ${a.titulo}`} checked={selecionadas.has(chave(a))} disabled={ocupado} onCheckedChange={() => alternar(a)} />
                            {seloTipo(a)}
                            <Text size="1" color="gray">{a.responsavel ? formatarNomeExibicao(a.responsavel) : 'Sem responsável'}</Text>
                          </Flex>
                          <Text as="p" size="3" weight="bold">{formatarNomeExibicao(a.titulo)}</Text>
                          <button type="button" className="atividades-link" onClick={() => abrirProcesso(a)}>{tituloProcesso(a)}</button>
                          <Flex gap="2" mt="1">{acaoPrincipal(a, true)}{menu(a)}</Flex>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <TabelaResponsiva principais={['Atividade', 'Processo']}>
            <table aria-label={situacao === 'concluidas' ? 'Atividades concluídas' : 'Atividades abertas'} className="atividades-tabela">
              <thead>
                <tr>
                  <th className="tabela-controle">
                    <Checkbox aria-label="Selecionar todas as atividades desta página" disabled={ocupado || !naPagina.length}
                      checked={todasVisiveis ? true : selecionadas.size ? 'indeterminate' : false}
                      onCheckedChange={() => setSelecionadas(todasVisiveis ? new Set() : new Set(naPagina.map(chave)))} />
                  </th>
                  <th className="atividades-col-quando">Quando</th>
                  <th>Atividade</th>
                  <th className="atividades-col-processo">Processo</th>
                  <th className="atividades-col-resp">Responsável</th>
                  <th className="atividades-col-situacao">Situação</th>
                  <th className="tabela-acoes atividades-col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map(({ grupo, itens }) => (
                  <Fragment key={grupo ?? 'todas'}>
                    {grupo && (
                      <tr className="atividades-grupo">
                        <td colSpan={7}>
                          <span className={grupo === 'atrasadas' ? 'atividades-alerta' : undefined}>{TITULO_GRUPO[grupo]}</span>
                          <span className="atividades-grupo-qtd">{itens.length}</span>
                        </td>
                      </tr>
                    )}
                    {itens.map(a => (
                      <tr key={chave(a)} className={selecionadas.has(chave(a)) ? 'atividades-selecionada' : undefined}>
                        <td className="tabela-controle">
                          <Checkbox aria-label={`Selecionar ${a.titulo}`} checked={selecionadas.has(chave(a))} disabled={ocupado} onCheckedChange={() => alternar(a)} />
                        </td>
                        <td>
                          <div className="atividades-data">{dataCurta(a.data)}</div>
                          <div className={atrasada(a) ? 'atividades-relativo atividades-alerta' : 'atividades-relativo'}>{quandoRelativo(a, hoje)}</div>
                        </td>
                        <td>
                          <div className="atividades-titulo">{formatarNomeExibicao(a.titulo)}</div>
                          <Flex gap="2" align="center" mt="1" wrap="wrap">
                            {seloTipo(a)}
                            {Boolean(a.agenda) && <Text size="1" color="gray">na agenda Google</Text>}
                          </Flex>
                        </td>
                        <td>
                          <button type="button" className="atividades-link" onClick={() => abrirProcesso(a)}>{tituloProcesso(a)}</button>
                          {processoNumero(a) && <div className="atividades-secundario">{processoNumero(a)}</div>}
                        </td>
                        <td>
                          <span>
                            {a.responsavel ? formatarNomeExibicao(a.responsavel) : <Text color="gray">Sem responsável</Text>}
                          </span>
                        </td>
                        <td>{seloStatus(a)}</td>
                        <td className="tabela-acoes">
                          <Flex gap="1" justify="end" align="center">{acaoPrincipal(a)}{menu(a)}</Flex>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </TabelaResponsiva>
        )}
      </section>

      {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && <Carregamento tipo="tabela" descricao="Carregando atividades…" />}
      {!carregando && !erro && !visiveis.length && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>
            {!cliente ? 'Conecte-se na tela Acesso para ver as atividades.'
              : situacao === 'concluidas' ? 'Nenhuma atividade concluída com estes filtros.'
                : atalho || filtrosAtivos ? 'Nenhuma atividade aberta com estes filtros.' : 'Nenhuma atividade aberta. Tudo em dia.'}
          </Callout.Text>
        </Callout.Root>
      )}
      {!carregando && visiveis.length > POR_PAGINA && (
        <Paginacao pagina={pagina} total={visiveis.length} nome="atividades"
          onPagina={n => { setEstadoPagina({ chave: chavePagina, pagina: n }); document.getElementById('main-content')?.scrollTo({ top: 0 }) }} />
      )}
      {!carregando && visiveis.length > 0 && visiveis.length <= POR_PAGINA && (
        <Text size="2" color="gray">
          {situacao === 'concluidas' ? `${visiveis.length} atividade(s) concluída(s)` : `${visiveis.length} de ${atividades.length} atividade(s) abertas`}
        </Text>
      )}


      <Dialog.Root open={dialogo === 'reatribuir'} onOpenChange={v => { if (!v) setDialogo('') }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Reatribuir {selecionadas.size} atividade(s)</Dialog.Title>
          <div className="form-campo">
            <label className="form-campo-label" id="reatribuir-rotulo">Novo responsável</label>
            <Select.Root value={novoResponsavel || undefined} onValueChange={setNovoResponsavel}>
              <Select.Trigger aria-labelledby="reatribuir-rotulo" placeholder="Selecione o responsável" />
              <Select.Content>{responsaveis.map(r => <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}</Select.Content>
            </Select.Root>
          </div>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button disabled={!novoResponsavel || operando} onClick={() => { setDialogo(''); void atualizar(selecionadasLista(), { responsavel: novoResponsavel }, 'reatribuídas') }}>Reatribuir</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={dialogo === 'data'} onOpenChange={v => { if (!v) setDialogo('') }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Mudar a data de {selecionadas.size} atividade(s)</Dialog.Title>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="atividades-nova-data">Nova data</label>
            <CampoData id="atividades-nova-data" value={novaData} onChange={setNovaData} />
          </div>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button disabled={!novaData || operando} onClick={() => { setDialogo(''); void atualizar(selecionadasLista(), { data: novaData }, 'remarcadas') }}>Mudar data</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={dialogo === 'nova'} onOpenChange={v => { if (!v) setDialogo('') }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Nova atividade: selecionar processo</Dialog.Title>
          {processos.length ? (
            <div className="form-campo">
              <label className="form-campo-label" id="nova-processo-rotulo">Processo</label>
              <Select.Root value={processoNovo || undefined} onValueChange={setProcessoNovo}>
                <Select.Trigger aria-labelledby="nova-processo-rotulo" placeholder="Selecione um processo" />
                <Select.Content>{processos.map(p => <Select.Item key={p.id} value={p.id}>{formatarNomeExibicao(p.titulo) || 'Processo sem título'}</Select.Item>)}</Select.Content>
              </Select.Root>
            </div>
          ) : <Carregamento tipo="texto" descricao="Carregando processos…" />}
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button disabled={!processoNovo} onClick={() => { setDialogo(''); setEditando({ casoId: processoNovo, atividade: null }) }}>Continuar</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {editando && (
        <AtividadeModal open casoId={editando.casoId} atividade={editando.atividade}
          onClose={() => setEditando(null)} onSalva={() => { setEditando(null); void carregar() }} />
      )}
    </Flex>
  )
}
