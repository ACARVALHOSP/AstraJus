import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useAvisos } from '../Avisos'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Callout, Dialog, Flex, SegmentedControl, Select, Switch, Text } from '@radix-ui/themes'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { usePerfil } from '../api/PerfilContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson } from '../api/rest'
import { formatarNomeExibicao } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import AtividadeModal from './casos/AtividadeModal'
import type { Atividade as AtividadeCaso } from './casos/AtividadesCaso'
import { COR_STATUS, COR_TIPO, dataCurta, isoLocal, ROTULO_STATUS, ROTULO_TIPO } from './atividades/dados'
import { DIAS_SEMANA, deslocar, diasDaVisao, gerarIcs, paraData, tituloDaVisao, type Visao } from './atividades/agenda'
import './atividades/agenda.scss'

type Item = {
  id: number | string; caso_id: string; titulo: string; tipo: string; status: string
  responsavel?: string | null; data?: string | null; hora?: string | null; observacoes?: string | null
  caso: { id: string; titulo?: string | null; responsavel?: string | null; processos?: string[] }
}
type CasoOpcao = { id: string; titulo?: string }

const hora = (a: Item) => (a.hora ? a.hora.slice(0, 5) : '')

export default function Agenda() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const { podeEditar } = usePerfil()
  const { avisar } = useAvisos()
  const estreita = useEstreita()
  const [hoje, setHoje] = useState(() => isoLocal(new Date()))
  const [visao, setVisao] = useState<Visao>('mes')
  const [ref, setRef] = useState(hoje)
  const [selecionado, setSelecionado] = useState(hoje)
  const [tipo, setTipo] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [concluidas, setConcluidas] = useState(false)
  const [itens, setItens] = useState<Item[]>([])
  const [responsaveis, setResponsaveis] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<{ casoId: string; atividade: AtividadeCaso | null; data?: string } | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  const sequencia = useRef(0)

  useEffect(() => {
    const relogio = window.setInterval(() => setHoje(isoLocal(new Date())), 60_000)
    return () => window.clearInterval(relogio)
  }, [])

  const dias = useMemo(() => diasDaVisao(visao, ref), [visao, ref])
  const de = dias[0], ate = dias[dias.length - 1]

  const carregar = useCallback(async () => {
    const pedido = ++sequencia.current
    if (!cliente) { setCarregando(false); return }
    setCarregando(true); setErro('')
    try {
      const q = new URLSearchParams({
        situacao: concluidas ? 'todas' : 'abertas', de, ate,
        ...(tipo ? { tipo } : {}), ...(responsavel ? { responsavel } : {}),
      })
      const dados = await buscarJson<{ atividades: Item[] }>(cliente, `/atividades?${q}`)
      if (pedido === sequencia.current) setItens(dados.atividades ?? [])
    } catch (e) {
      if (pedido === sequencia.current) setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar a agenda. Tente de novo.')
    } finally { if (pedido === sequencia.current) setCarregando(false) }
  }, [cliente, concluidas, de, ate, tipo, responsavel])
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

  const porDia = useMemo(() => {
    const mapa = new Map<string, Item[]>()
    for (const a of itens) {
      if (!a.data) continue
      const k = a.data.slice(0, 10)
      mapa.set(k, [...(mapa.get(k) ?? []), a])
    }
    for (const lista of mapa.values()) lista.sort((x, y) => (x.hora ?? '99:99').localeCompare(y.hora ?? '99:99') || x.titulo.localeCompare(y.titulo, 'pt-BR'))
    return mapa
  }, [itens])

  function navegar(sentido: 1 | -1) {
    const novo = deslocar(visao, ref, sentido)
    setRef(novo); setSelecionado(visao === 'dia' ? novo : visao === 'mes' ? `${novo.slice(0, 7)}-01` : novo)
  }
  function irParaHoje() { setRef(hoje); setSelecionado(hoje) }
  function escolherDia(dia: string) {
    setSelecionado(dia)
    if (visao === 'mes' && dia.slice(0, 7) !== ref.slice(0, 7)) setRef(dia)
  }
  function abrir(a: Item) {
    if (!podeEditar('atividades')) { irPara('casos', { id: a.caso_id, aba: 'atividades', atividadeId: a.id }); return }
    setEditando({ casoId: a.caso_id, atividade: a as unknown as AtividadeCaso })
  }
  function exportar() {
    const comData = itens.filter(a => a.data)
    if (!comData.length) { avisar({ tipo: 'info', texto: 'Não há atividades neste período para exportar.' }); return }
    const ics = gerarIcs(comData.map(a => ({
      id: `${a.caso_id}-${a.id}`, titulo: a.titulo, data: a.data!, hora: a.hora, tipo: ROTULO_TIPO[a.tipo] ?? a.tipo,
      descricao: [a.caso?.titulo, a.responsavel && `Responsável: ${a.responsavel}`, a.observacoes].filter(Boolean).join('\n'),
    })))
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    link.download = `agenda-${de}-a-${ate}.ics`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const atrasada = (a: Item) => a.status !== 'concluida' && !!a.data && a.data.slice(0, 10) < hoje
  const doDia = porDia.get(selecionado) ?? []
  const chip = (a: Item) => (
    <button key={`${a.caso_id}:${a.id}`} type="button"
      className={`aj-ag-chip aj-ag-chip--${COR_TIPO[a.tipo] ?? 'gray'}${a.status === 'concluida' ? ' aj-ag-chip--feita' : ''}`}
      onClick={(e) => { e.stopPropagation(); abrir(a) }}
      title={`${ROTULO_TIPO[a.tipo] ?? a.tipo}: ${a.titulo}${a.caso?.titulo ? ` — ${a.caso.titulo}` : ''}`}>
      {hora(a) && <b>{hora(a)}</b>} {a.titulo}
    </button>
  )
  const MAX_CHIPS = visao === 'semana' ? 12 : 3

  return (
    <section className="aj-agenda">
      <CabecalhoPagina titulo="Agenda" focavel descricao="Prazos, audiências, reuniões e tarefas de todos os processos no calendário."
        acoes={<Flex gap="2" wrap="wrap">
          <Button variant="soft" color="gray" onClick={exportar}><Download size={14} aria-hidden="true" />Exportar .ics</Button>
          {podeEditar('atividades') && <Button onClick={() => setEscolhendo(true)}><Plus size={14} aria-hidden="true" />Nova atividade</Button>}
        </Flex>} />

      <Flex className="aj-ag-barra" align="center" gap="3" wrap="wrap">
        <Flex gap="1" align="center">
          <Button variant="soft" color="gray" size="2" aria-label="Período anterior" onClick={() => navegar(-1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
          <Button variant="soft" color="gray" size="2" onClick={irParaHoje}>Hoje</Button>
          <Button variant="soft" color="gray" size="2" aria-label="Próximo período" onClick={() => navegar(1)}><ChevronRight size={16} aria-hidden="true" /></Button>
        </Flex>
        <Text as="p" size="4" weight="bold" className="aj-ag-titulo" role="status" aria-live="polite">{tituloDaVisao(visao, ref)}</Text>
        <SegmentedControl.Root value={visao} onValueChange={(v) => { setVisao(v as Visao); setRef(selecionado) }} aria-label="Visualização">
          <SegmentedControl.Item value="mes">Mês</SegmentedControl.Item>
          <SegmentedControl.Item value="semana">Semana</SegmentedControl.Item>
          <SegmentedControl.Item value="dia">Dia</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>

      <Flex className="aj-ag-filtros" gap="3" align="center" wrap="wrap">
        <Select.Root value={tipo || '__todos__'} onValueChange={(v) => setTipo(v === '__todos__' ? '' : v)}>
          <Select.Trigger aria-label="Tipo" />
          <Select.Content>
            <Select.Item value="__todos__">Todos os tipos</Select.Item>
            {Object.entries(ROTULO_TIPO).map(([v, t]) => <Select.Item key={v} value={v}>{t}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Select.Root value={responsavel || '__todos__'} onValueChange={(v) => setResponsavel(v === '__todos__' ? '' : v)}>
          <Select.Trigger aria-label="Responsável" />
          <Select.Content>
            <Select.Item value="__todos__">Todos os responsáveis</Select.Item>
            <Select.Item value="__sem__">Sem responsável</Select.Item>
            {responsaveis.map(r => <Select.Item key={r} value={r}>{r}</Select.Item>)}
          </Select.Content>
        </Select.Root>
        <Text as="label" size="2"><Flex gap="2" align="center"><Switch checked={concluidas} onCheckedChange={setConcluidas} />Mostrar concluídas</Flex></Text>
        <Flex gap="2" wrap="wrap" aria-label="Legenda">
          {Object.entries(COR_TIPO).filter(([t]) => t !== 'outro').map(([t, c]) => <Badge key={t} color={c} variant="soft">{ROTULO_TIPO[t]}</Badge>)}
        </Flex>
      </Flex>

      {erro && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{erro} <Button variant="ghost" size="1" onClick={() => void carregar()}>Tentar novamente</Button></Callout.Text>
        </Callout.Root>
      )}
      {carregando && <Carregamento tipo="texto" descricao="Carregando a agenda…" />}

      {visao !== 'dia' && (
        <div className={`aj-ag-grade aj-ag-grade--${visao}`} aria-busy={carregando}
          role="grid" aria-label={`Calendário de ${tituloDaVisao(visao, ref)}`}>
          <div className="aj-ag-semana-cab" role="row">
            {DIAS_SEMANA.map(d => <div key={d} role="columnheader">{d}</div>)}
          </div>
          <div className="aj-ag-dias">
            {dias.map(dia => {
              const lista = porDia.get(dia) ?? []
              const fora = visao === 'mes' && dia.slice(0, 7) !== ref.slice(0, 7)
              const d = paraData(dia)
              return (
                <div key={dia} role="gridcell" tabIndex={0}
                  className={`aj-ag-dia${fora ? ' aj-ag-dia--fora' : ''}${dia === hoje ? ' aj-ag-dia--hoje' : ''}${dia === selecionado ? ' aj-ag-dia--sel' : ''}`}
                  aria-label={`${d.getDate()}/${d.getMonth() + 1}: ${lista.length} atividade${lista.length === 1 ? '' : 's'}`}
                  aria-selected={dia === selecionado}
                  onClick={() => escolherDia(dia)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolherDia(dia) } }}>
                  <span className="aj-ag-num">{d.getDate()}</span>
                  {estreita
                    ? lista.length > 0 && <span className="aj-ag-pontos" aria-hidden="true">{lista.slice(0, 4).map(a => <i key={`${a.caso_id}:${a.id}`} className={`aj-ag-ponto aj-ag-ponto--${COR_TIPO[a.tipo] ?? 'gray'}`} />)}</span>
                    : <>
                        {lista.slice(0, MAX_CHIPS).map(chip)}
                        {lista.length > MAX_CHIPS && <button type="button" className="aj-ag-mais" onClick={(e) => { e.stopPropagation(); setSelecionado(dia); setRef(dia); setVisao('dia') }}>+{lista.length - MAX_CHIPS} mais</button>}
                      </>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <section className="aj-ag-lista" aria-label={`Atividades de ${dataCurta(selecionado)}`}>
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Text as="p" size="3" weight="bold">{visao === 'dia' ? 'Atividades do dia' : `Dia ${dataCurta(selecionado)}`}</Text>
          {podeEditar('atividades') && <Button variant="soft" size="1" onClick={() => setEscolhendo(true)}><Plus size={13} aria-hidden="true" />Nova neste dia</Button>}
        </Flex>
        {!carregando && doDia.length === 0 && <Text as="p" size="2" color="gray" role="status">Nenhuma atividade neste dia.</Text>}
        <ul>
          {doDia.map(a => (
            <li key={`${a.caso_id}:${a.id}`} className="aj-ag-linha">
              <span className="aj-ag-hora">{hora(a) || 'dia todo'}</span>
              <div className="aj-ag-conteudo">
                <Flex gap="2" align="center" wrap="wrap">
                  <Badge color={COR_TIPO[a.tipo] ?? 'gray'} variant="soft">{ROTULO_TIPO[a.tipo] ?? a.tipo}</Badge>
                  <Badge color={COR_STATUS[a.status] ?? 'gray'} variant="outline">{ROTULO_STATUS[a.status] ?? a.status}</Badge>
                  {atrasada(a) && <Badge color="red">Atrasada</Badge>}
                </Flex>
                <button type="button" className="aj-ag-titulo-item" onClick={() => abrir(a)}>{a.titulo}</button>
                <Text as="p" size="2" color="gray">
                  {a.caso?.titulo ? formatarNomeExibicao(a.caso.titulo) : 'Processo'}{a.responsavel ? ` · ${a.responsavel}` : ''}
                </Text>
              </div>
              <Button variant="ghost" size="1" onClick={() => irPara('casos', { id: a.caso_id, aba: 'atividades', atividadeId: a.id })}>Abrir processo</Button>
            </li>
          ))}
        </ul>
      </section>

      {escolhendo && <EscolherProcesso data={selecionado} onCancelar={() => setEscolhendo(false)}
        onEscolhido={(casoId) => { setEscolhendo(false); setEditando({ casoId, atividade: null, data: selecionado }) }} />}
      {editando && <AtividadeModal open casoId={editando.casoId} atividade={editando.atividade} dataInicial={editando.data}
        onClose={() => setEditando(null)}
        onSalva={() => { setEditando(null); avisar({ texto: 'Atividade salva.' }); void carregar() }} />}
    </section>
  )
}

function EscolherProcesso({ data, onCancelar, onEscolhido }: { data: string; onCancelar: () => void; onEscolhido: (casoId: string) => void }) {
  const { cliente } = useCliente()
  const [casos, setCasos] = useState<CasoOpcao[]>([])
  const [casoId, setCasoId] = useState('')
  const [erro, setErro] = useState('')
  useEffect(() => {
    buscarJson<{ casos: CasoOpcao[] }>(cliente, '/casos')
      .then(r => setCasos((r.casos ?? []).sort((a, b) => (a.titulo ?? '').localeCompare(b.titulo ?? '', 'pt-BR'))))
      .catch(() => setErro('Não foi possível carregar os processos.'))
  }, [cliente])
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onCancelar() }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Nova atividade em {dataCurta(data)}</Dialog.Title>
        <Dialog.Description size="2" mb="3">Escolha o processo da atividade. Você define o tipo e a hora na próxima janela.</Dialog.Description>
        <div className="form-campo">
          <label className="form-campo-label" id="agenda-processo-rotulo">Processo</label>
          <Select.Root value={casoId} onValueChange={setCasoId}>
            <Select.Trigger aria-labelledby="agenda-processo-rotulo" placeholder="Escolha o processo" style={{ width: '100%' }} />
            <Select.Content>
              {casos.map(c => <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.titulo || '(sem título)')}</Select.Item>)}
            </Select.Content>
          </Select.Root>
          {erro && <Text size="2" color="red" role="alert">{erro}</Text>}
        </div>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onCancelar}>Cancelar</Button>
          <Button disabled={!casoId} onClick={() => onEscolhido(casoId)}>Continuar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
