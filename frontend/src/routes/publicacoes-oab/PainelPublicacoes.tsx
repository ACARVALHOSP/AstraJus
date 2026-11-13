import LinhaFiltros from '../../LinhaFiltros'
import { useAvisos } from '../../Avisos'
import CabecalhoPagina from '../../CabecalhoPagina'
import CampoData from '../../CampoData'
import TabelaResponsiva from '../../TabelaResponsiva'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, Archive, Check, ChevronDown, ChevronRight, FilePlus, Info, Keyboard, Link2, Unlink } from 'lucide-react'
import { Badge, Button, Callout, Checkbox, Dialog, Flex, IconButton, Popover, Select, Text, TextField } from '@radix-ui/themes'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCliente } from '../../api/ClienteContext'
import { useResponsaveis } from '../../api/consultas'
import { buscarJson, enviarJson } from '../../api/rest'
import { useNavegacao } from '../../api/NavegacaoContext'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import {
  advogadosPublicacao, CHAVE_COLUNAS, COLUNAS_OPCIONAIS, COR_STATUS, corTipo, dataCaptura, dataCapturaCurta, dataDivulgacao, lerPreferencias,
  nomePublicacao, numeroPublicacao, orgaoPublicacao, ROTULO_STATUS, urlPublicacao, type ContagemStatus, type PublicacaoOab,
} from './dados'
import ProcessoPublicacao from './ProcessoPublicacao'
import type { Caso } from '../casos/ListaCasos'
import AtividadePublicacao from './AtividadePublicacao'
import { PRAZOS_PADRAO } from './prazos'
import { pct, selosTriagem, type InfoTriagem } from './triagem'
import { POLO_CURTO } from '../../utils/polos'
import './publicacoes.scss'

type Status = PublicacaoOab['status']
type RespostaLista = {
  publicacoes: PublicacaoOab[]; total: number; pagina: number
  hashes_disponiveis?: string[]; contagem_status?: ContagemStatus; tipos_disponiveis?: string[]; triagem?: InfoTriagem; destinadas_a_clientes?: number
}
type ResultadoStatus = { hashes_atualizados: string[]; hashes_falharam: string[] }
type Periodo = '' | 'hoje' | '7' | '30' | 'personalizado'

const SEM_PUBLICACOES: PublicacaoOab[] = []
const SEM_RESPONSAVEIS: string[] = []

const ATALHOS: Array<{ valor: Status | ''; rotulo: string }> = [
  { valor: 'nao_tratada', rotulo: 'Não tratadas' },
  { valor: 'tratada', rotulo: 'Tratadas' },
  { valor: 'arquivada', rotulo: 'Arquivadas' },
  { valor: '', rotulo: 'Todas' },
]

function isoLocal(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}
function intervalo(periodo: Periodo, desde: string, ate: string): { desde?: string; ate?: string } {
  const hoje = new Date()
  if (periodo === 'hoje') return { desde: isoLocal(hoje), ate: isoLocal(hoje) }
  if (periodo === '7' || periodo === '30') {
    const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - Number(periodo) + 1)
    return { desde: isoLocal(inicio), ate: isoLocal(hoje) }
  }
  if (periodo === 'personalizado') return { ...(desde ? { desde } : {}), ...(ate ? { ate } : {}) }
  return {}
}
export default function PainelPublicacoes({ Captura, abas }: { Captura: ComponentType<{ onCapturado: () => void }>; abas?: ReactNode }) {
  const { cliente } = useCliente(), { irPara, consumirPayload, versaoNavegacao } = useNavegacao()
  const estreita = useEstreita()
  const [status, setStatus] = useState<Status | ''>('nao_tratada')
  const [tipo, setTipo] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('')
  const [desde, setDesde] = useState(''), [ate, setAte] = useState('')
  const [textoBusca, setTextoBusca] = useState(''), [busca, setBusca] = useState('')
  const [ordemAsc, setOrdemAsc] = useState(false)
  const [porPrioridade, setPorPrioridade] = useState(false)
  const [infoTriagem, setInfoTriagem] = useState<InfoTriagem | null>(null)
  const [classificando, setClassificando] = useState(false)
  const [pagina, setPagina] = useState(1), [tamanho, setTamanho] = useState(20)
  useEffect(() => {
    const destino = consumirPayload<{ status?: string }>('publicacoes-oab')
    if (destino?.status === 'nao_tratada') { setStatus('nao_tratada'); setPagina(1) }
  }, [consumirPayload, versaoNavegacao])
  useEffect(() => {
    const espera = window.setTimeout(() => { setBusca(textoBusca.trim()); setPagina(1) }, 400)
    return () => window.clearTimeout(espera)
  }, [textoBusca])

  const [contagem, setContagem] = useState<ContagemStatus | null>(null), [tipos, setTipos] = useState<string[]>([])
  const [preferencias, setPreferencias] = useState(lerPreferencias)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set()), [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [todasFiltro, setTodasFiltro] = useState(false)
  const [hashesLote, setHashesLote] = useState<string[] | null>(null)
  const [criarLote, setCriarLote] = useState<PublicacaoOab[] | null>(null)
  const [operacao, setOperacao] = useState(false)
  const { avisar } = useAvisos()
  const [modal, setModal] = useState<{ tipo: 'processo' | 'atividade'; p: PublicacaoOab } | null>(null)
  const [capturaAberta, setCapturaAberta] = useState(false)
  const trava = useRef(false)
  const opcionais = COLUNAS_OPCIONAIS.filter(c => preferencias.includes(c.key))
  const { desde: filtroDesde, ate: filtroAte } = intervalo(periodo, desde, ate)

  const queryClient = useQueryClient()
  const chaveLista = ['publicacoes-oab', cliente?.token, { pagina, tamanho, status, tipo, busca, filtroDesde, filtroAte, ordemAsc, porPrioridade }]
  const consulta = useQuery({
    queryKey: chaveLista,
    enabled: Boolean(cliente),
    placeholderData: keepPreviousData, // a lista anterior fica na tela enquanto a nova carrega
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({
        pagina: String(pagina), tamanho: String(tamanho), ordem: porPrioridade ? 'prioridade' : ordemAsc ? 'divulgado_asc' : 'divulgado_desc',
        ...(status ? { status } : {}), ...(tipo ? { tipo } : {}), ...(busca ? { busca } : {}),
        ...(filtroDesde ? { desde: filtroDesde } : {}), ...(filtroAte ? { ate: filtroAte } : {}),
      })
      return buscarJson<RespostaLista>(cliente, `/publicacoes-oab?${query}`, signal)
    },
  })
  const dados = consulta.data
  const publicacoes = dados?.publicacoes ?? SEM_PUBLICACOES
  const total = dados?.total ?? 0
  const paraClientes = dados?.destinadas_a_clientes ?? 0
  const carregando = consulta.isFetching
  const erro = consulta.error ? consulta.error.message : ''
  const carregar = () => consulta.refetch()
  // Contagens, tipos e triagem só vêm em algumas respostas: guarda o último valor recebido.
  // A resposta também corrige a página e tira da seleção o que saiu da lista.
  useEffect(() => {
    if (!dados) return
    /* eslint-disable react/set-state-in-effect */
    if (dados.contagem_status) setContagem(dados.contagem_status)
    if (dados.triagem) setInfoTriagem(dados.triagem)
    if (dados.tipos_disponiveis) setTipos(dados.tipos_disponiveis)
    if (dados.pagina && dados.pagina !== pagina) setPagina(dados.pagina)
    if (dados.hashes_disponiveis) {
      const disponiveis = new Set(dados.hashes_disponiveis)
      setSelecionadas(s => new Set([...s].filter(id => disponiveis.has(id))))
      setExpandidas(s => new Set([...s].filter(id => disponiveis.has(id))))
    }
    /* eslint-enable react/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados])

  const ocupada = carregando || operacao || modal !== null
  const lote = selecionadas.size > 0
  const todasPagina = publicacoes.length > 0 && publicacoes.every(p => selecionadas.has(p.hash))
  const algumasPagina = publicacoes.some(p => selecionadas.has(p.hash)) && !todasPagina
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho))
  const primeira = total ? (pagina - 1) * tamanho + 1 : 0, ultima = Math.min(total, pagina * tamanho)
  const filtrosAtivos = Boolean(tipo || periodo || busca)

  function filtrar(acao: () => void) {
    if (ocupada) return
    acao(); setPagina(1); setSelecionadas(new Set()); setTodasFiltro(false)
  }

  // O servidor aceita no máximo 300 por página: percorre todas as páginas do filtro.
  async function publicacoesTodasFiltro(): Promise<PublicacaoOab[]> {
    const todas: PublicacaoOab[] = []
    for (let pag = 1; ; pag++) {
      const query = new URLSearchParams({
        pagina: String(pag), tamanho: '300',
        ordem: porPrioridade ? 'prioridade' : ordemAsc ? 'divulgado_asc' : 'divulgado_desc',
        ...(status ? { status } : {}), ...(tipo ? { tipo } : {}), ...(busca ? { busca } : {}),
        ...(filtroDesde ? { desde: filtroDesde } : {}), ...(filtroAte ? { ate: filtroAte } : {}),
      })
      const dados = await buscarJson<RespostaLista>(cliente, `/publicacoes-oab?${query}`)
      const lote = dados.publicacoes ?? []
      todas.push(...lote)
      if (!lote.length || todas.length >= (dados.total ?? 0)) return todas
    }
  }
  async function hashesTodasFiltro(): Promise<string[]> {
    return (await publicacoesTodasFiltro()).map(p => p.hash)
  }

  async function abrirCriarLote() {
    if (ocupada) return
    setOperacao(true)
    try {
      const todas = todasFiltro ? await publicacoesTodasFiltro() : publicacoes.filter(p => selecionadas.has(p.hash))
      setCriarLote(todas)
    } catch (e) { avisar({ tipo: 'erro', texto: (e as Error).message }) }
    finally { setOperacao(false) }
  }

  async function abrirVincularLote() {
    if (ocupada) return
    setOperacao(true)
    try {
      const hashes = todasFiltro ? await hashesTodasFiltro() : [...selecionadas]
      setHashesLote(hashes)
    } catch (e) { avisar({ tipo: 'erro', texto: (e as Error).message }) }
    finally { setOperacao(false) }
  }
  function alternar(id: string) {
    if (ocupada || trava.current) return
    setSelecionadas(s => { const novo = new Set(s); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo })
  }
  function alternarExpandida(id: string) {
    setExpandidas(s => { const novo = new Set(s); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo })
  }
  async function mudarStatus(hashes: string[], novo: Status, emLote = false, desfazendo = false) {
    if (trava.current || (!desfazendo && (ocupada || (!emLote && lote))) || !hashes.length) return
    // Situação anterior de cada publicação, para o "Desfazer".
    const anteriores = new Map(publicacoes.filter(p => hashes.includes(p.hash)).map(p => [p.hash, p.status as Status]))
    trava.current = true; setOperacao(true)
    try {
      // The backend limits request bodies to 4096 bytes. Keep each batch below that.
      const r: ResultadoStatus = { hashes_atualizados: [], hashes_falharam: [] }
      for (let inicio = 0; inicio < hashes.length; inicio += 30) {
        const bloco = hashes.slice(inicio, inicio + 30)
        try {
          const parcial = await enviarJson<ResultadoStatus>(cliente, '/publicacoes-oab/status', { hashes: bloco, status: novo })
          if (!Array.isArray(parcial.hashes_atualizados) || !Array.isArray(parcial.hashes_falharam)) throw new Error('Resposta de status incompleta. Atualize a lista antes de repetir.')
          r.hashes_atualizados.push(...parcial.hashes_atualizados); r.hashes_falharam.push(...parcial.hashes_falharam)
        } catch (e) {
          r.hashes_falharam.push(...hashes.slice(inicio)); avisar({ tipo: 'erro', texto: (e as Error).message }); break
        }
      }
      const sucessos = new Set(r.hashes_atualizados)
      setSelecionadas(s => new Set([...s].filter(h => !sucessos.has(h))))
      if (r.hashes_falharam.length) {
        avisar({ tipo: 'erro', texto: `${sucessos.size} atualizada(s); ${r.hashes_falharam.length} falharam. As falhas permanecem selecionadas quando disponíveis.` })
      } else if (!desfazendo && sucessos.size) {
        const grupos = new Map<Status, string[]>()
        for (const h of sucessos) {
          const antes = anteriores.get(h)
          if (antes && antes !== novo) grupos.set(antes, [...(grupos.get(antes) ?? []), h])
        }
        avisar({
          texto: sucessos.size === 1 ? `Publicação marcada como ${ROTULO_STATUS[novo].toLowerCase()}.` : `${sucessos.size} publicações marcadas como ${ROTULO_STATUS[novo].toLowerCase()}.`,
          desfazer: grupos.size ? async () => { for (const [status, lista] of grupos) await mudarStatus(lista, status, true, true) } : undefined,
        })
      }
      await carregar()
    } catch (e) { avisar({ tipo: 'erro', texto: (e as Error).message }) }
    finally { trava.current = false; setOperacao(false) }
  }
  function escolherColuna(chave: string, marcada: boolean) {
    const novas = marcada ? [...new Set([...preferencias, chave])] : preferencias.filter(k => k !== chave)
    setPreferencias(novas)
    try { localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(novas)) } catch { avisar({ tipo: 'info', texto: 'Preferências aplicadas nesta sessão; armazenamento indisponível.' }) }
  }
  function abrirAcao(tipoAcao: 'processo' | 'atividade', p: PublicacaoOab) {
    if (ocupada || lote || trava.current) return
    if (tipoAcao === 'processo' && p.caso_id) { irPara('casos', { id: p.caso_id }); return }
    setModal({ tipo: tipoAcao, p })
  }

  // Atalhos de teclado para a triagem (no computador): J/K navegam, T trata, E arquiva, U reabre,
  // A cria atividade, V vincula processo, O abre o texto, X seleciona, ? mostra a lista.
  const [foco, setFoco] = useState<string | null>(null)
  const [atalhosAbertos, setAtalhosAbertos] = useState(false)
  useEffect(() => {
    if (estreita) return
    function aoTeclar(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const alvo = e.target as HTMLElement | null
      if (alvo && (alvo.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"]'))) return
      if (modal || capturaAberta || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (e.key === '?') { e.preventDefault(); setAtalhosAbertos(v => !v); return }
      if (!publicacoes.length) return
      const indice = foco ? publicacoes.findIndex(p => p.hash === foco) : -1
      const mover = (passo: number) => {
        const novo = publicacoes[Math.min(publicacoes.length - 1, Math.max(0, indice + passo))]
        setFoco(novo.hash)
        document.querySelector(`[data-publicacao="${novo.hash}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      const tecla = e.key.toLowerCase()
      if (tecla === 'j' || e.key === 'ArrowDown' && indice >= 0) { e.preventDefault(); mover(indice < 0 ? 0 : 1); return }
      if (tecla === 'k' || e.key === 'ArrowUp' && indice >= 0) { e.preventDefault(); mover(indice < 0 ? 0 : -1); return }
      const atual = indice >= 0 ? publicacoes[indice] : null
      if (!atual) return
      const acoes: Record<string, () => void> = {
        t: () => { if (atual.status !== 'tratada') void mudarStatus([atual.hash], 'tratada') },
        e: () => { if (atual.status !== 'arquivada') void mudarStatus([atual.hash], 'arquivada') },
        u: () => { if (atual.status !== 'nao_tratada') void mudarStatus([atual.hash], 'nao_tratada') },
        a: () => { if (atual.caso_id) abrirAcao('atividade', atual) },
        v: () => { if (atual.caso_id || numeroPublicacao(atual).length === 20) abrirAcao('processo', atual) },
        o: () => alternarExpandida(atual.hash),
        enter: () => alternarExpandida(atual.hash),
        x: () => alternar(atual.hash),
      }
      const acao = acoes[tecla]
      if (acao) { e.preventDefault(); acao() }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  })

  /** Próxima ação provável da publicação, exibida como botão visível. */
  function acaoPrincipal(p: PublicacaoOab, largura = false) {
    const bloqueada = ocupada || lote
    const estilo = largura ? { flex: 1 } : undefined
    if (p.status !== 'nao_tratada') {
      return <Button size={largura ? '3' : '1'} variant="soft" color="gray" style={estilo} disabled={bloqueada} onClick={() => mudarStatus([p.hash], 'nao_tratada')}>Reabrir</Button>
    }
    if (!p.caso_id) {
      return <Button size={largura ? '3' : '1'} variant="soft" style={estilo} disabled={bloqueada || numeroPublicacao(p).length !== 20} onClick={() => abrirAcao('processo', p)}>Vincular processo</Button>
    }
    return <Button size={largura ? '3' : '1'} variant="soft" style={estilo} disabled={bloqueada} onClick={() => abrirAcao('atividade', p)}>Criar atividade</Button>
  }
  function menuAcoes(p: PublicacaoOab) {
    const bloqueada = ocupada || lote, link = urlPublicacao(p)
    return <AcoesTabela rotulo={`publicação ${formatarNumeroCNJ(numeroPublicacao(p)) || p.hash}`} acoes={[
      ...(link ? [{ texto: 'Abrir no DJEN', href: link }] : []),
      { texto: p.caso_id ? 'Abrir processo' : 'Criar / vincular processo', desabilitada: bloqueada || (!p.caso_id && numeroPublicacao(p).length !== 20), executar: () => abrirAcao('processo', p) },
      { texto: p.caso_id ? 'Criar atividade' : 'Criar atividade (vincule um processo)', desabilitada: bloqueada || !p.caso_id, executar: () => abrirAcao('atividade', p) },
      { texto: 'Marcar como tratada', desabilitada: bloqueada || p.status === 'tratada', executar: () => mudarStatus([p.hash], 'tratada') },
      { texto: 'Arquivar', desabilitada: bloqueada || p.status === 'arquivada', executar: () => mudarStatus([p.hash], 'arquivada') },
      ...(p.status !== 'nao_tratada' ? [{ texto: 'Reabrir como não tratada', desabilitada: bloqueada, executar: () => mudarStatus([p.hash], 'nao_tratada') }] : []),
    ]} />
  }
  function vinculo(p: PublicacaoOab) {
    if (p.caso_id) {
      return <button type="button" className="oab-vinculo" disabled={ocupada || lote} onClick={() => abrirAcao('processo', p)}>{formatarNomeExibicao(p.caso_titulo) || 'Processo vinculado'}</button>
    }
    if (p.status !== 'nao_tratada') return null
    return <span className="oab-sem-vinculo"><Unlink size={12} aria-hidden="true" /> Sem processo vinculado</span>
  }
  function detalhes(p: PublicacaoOab) {
    const link = urlPublicacao(p)
    return (
      <div className="oab-detalhes">
        <dl className="oab-detalhes-grade">
          <div><dt>Classe</dt><dd>{p.dados?.nomeClasse || '—'}</dd></div>
          <div><dt>Advogados intimados</dt><dd>{advogadosPublicacao(p) || '—'}</dd></div>
          <div><dt>Referência pesquisada</dt><dd>{formatarNomeExibicao(p.nome_pesquisado) || '—'}</dd></div>
          <div><dt>Capturado em</dt><dd>{dataCaptura(p)}</dd></div>
        </dl>
        <div>
          <Text as="p" size="1" weight="bold" color="gray" className="oab-rotulo">Inteiro teor</Text>
          <p className="oab-inteiro-teor">{p.dados?.texto || 'Inteiro teor não disponibilizado.'}</p>
        </div>
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="oab-link">Abrir no DJEN</a>}
      </div>
    )
  }
  const seloTipo = (p: PublicacaoOab) => p.dados?.tipoComunicacao
    ? <Badge color={corTipo(p.dados.tipoComunicacao)} variant="soft">{p.dados.tipoComunicacao}</Badge>
    : <Text size="1" color="gray">—</Text>
  const triagemAtiva = infoTriagem?.modo === 'simulado' || infoTriagem?.modo === 'jev'
  const rotuloPrazo = (id: string) => PRAZOS_PADRAO.find(x => x.id === id)?.rotulo ?? id
  async function classificarPagina() {
    const pendentes = publicacoes.filter(p => !p.triagem).map(p => p.hash)
    if (!pendentes.length) { avisar({ tipo: 'info', texto: 'As publicações desta página já foram classificadas.' }); return }
    setClassificando(true)
    try {
      const r = await enviarJson<{ resultados: Record<string, NonNullable<PublicacaoOab['triagem']>>; falhas: Record<string, string> }>(cliente, '/publicacoes-oab/triagem', { hashes: pendentes.slice(0, 50) })
      queryClient.setQueryData<RespostaLista>(chaveLista, d => d && { ...d, publicacoes: d.publicacoes.map(p => r.resultados[p.hash] ? { ...p, triagem: r.resultados[p.hash] } : p) })
      const falhas = Object.keys(r.falhas ?? {}).length
      avisar({ tipo: falhas ? 'info' : 'sucesso', texto: `${Object.keys(r.resultados).length} publicação(ões) classificada(s)${falhas ? `; ${falhas} falharam` : ''}. São sugestões: confira antes de agir.` })
    } catch (e) { avisar({ tipo: 'erro', texto: (e as Error).message }) } finally { setClassificando(false) }
  }
  const seloTriagem = (p: PublicacaoOab) => {
    const selos = selosTriagem(p.triagem, rotuloPrazo)
    if (!p.triagem) return triagemAtiva ? <Text size="1" color="gray">Sem classificação</Text> : null
    if (!selos.length) return <Text size="1" color="gray">Sem sugestão confiável</Text>
    return (
      <Flex gap="1" wrap="wrap" className="oab-triagem">
        {selos.map(s => <Badge key={s.chave} color={s.cor} variant={s.revisar ? 'outline' : 'soft'} title={s.dica}>{s.texto}{s.revisar ? ' (revisar)' : ''}</Badge>)}
      </Flex>
    )
  }
  const seloDestino = (p: PublicacaoOab) => {
    const d = p.destino
    if (!d) return null
    if (d.tipo === 'contraria') return <Badge color="gray" variant="outline" title="A publicação é para a outra parte do processo">Parte contrária</Badge>
    return (
      <Flex direction="column" gap="1" className="oab-destino">
        {d.clientes.map(c => (
          <Badge key={c.id} color="red" variant="solid" title="A publicação é destinada a um cliente do escritório: atenção ao prazo">
            <span aria-hidden="true">❗</span><span className="aj-sr-only">Atenção: </span>
            Cliente{c.polo ? ` (parte ${POLO_CURTO[c.polo]})` : ''}: {formatarNomeExibicao(c.nome)}
          </Badge>
        ))}
      </Flex>
    )
  }
  const paraCliente = (p: PublicacaoOab) => p.destino?.tipo === 'cliente'
  const seloStatus = (p: PublicacaoOab) => <Badge color={COR_STATUS[p.status]} variant="soft" radius="full">{ROTULO_STATUS[p.status]}</Badge>

  return (
    <Flex direction="column" gap="5" className="oab-painel">
      <CabecalhoPagina
        titulo="Publicações recebidas"
        descricao="Revise as publicações capturadas pelos monitoramentos por OAB."
        abas={abas}
        acoes={<>
          <Popover.Root>
            <Popover.Trigger>
              <IconButton variant="ghost" color="gray" size="2" aria-label="Como funciona a captura"><Info size={16} /></IconButton>
            </Popover.Trigger>
            <Popover.Content style={{ maxWidth: 360 }}>
              <Text as="p" size="2">
                A captura dos monitoramentos por OAB ocorre a cada 24 horas; os avisos por e-mail, a cada 6 horas.
                Não tratada: aguarda revisão, mesmo quando vinculada a um processo. Tratada: revisão confirmada ou
                atividade criada. Arquivada: dispensada, preservando dados e vínculos. É possível reabrir.
              </Text>
            </Popover.Content>
          </Popover.Root>
          {!estreita && (
            <Popover.Root open={atalhosAbertos} onOpenChange={setAtalhosAbertos}>
              <Popover.Trigger>
                <IconButton variant="ghost" color="gray" size="2" aria-label="Atalhos de teclado"><Keyboard size={16} /></IconButton>
              </Popover.Trigger>
              <Popover.Content style={{ maxWidth: 340 }}>
                <Text as="p" size="2" weight="bold" mb="2">Atalhos de teclado</Text>
                <dl className="oab-atalhos-teclado">
                  {[['J / K', 'Próxima / anterior'], ['O ou Enter', 'Abrir ou fechar o texto'], ['T', 'Marcar como tratada'], ['E', 'Arquivar'], ['U', 'Voltar para não tratada'],
                    ['A', 'Criar atividade'], ['V', 'Vincular ou abrir processo'], ['X', 'Selecionar'], ['?', 'Mostrar esta lista']].map(([k, d]) => (
                    <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>
                  ))}
                </dl>
              </Popover.Content>
            </Popover.Root>
          )}
          {triagemAtiva && <Button variant="soft" size="2" loading={classificando} disabled={ocupada} onClick={() => void classificarPagina()}>Classificar esta página</Button>}
          <Button variant="soft" size="2" disabled={ocupada || lote} onClick={() => setCapturaAberta(true)}>Capturar por OAB</Button>
          <Button variant="soft" color="gray" size="2" disabled={ocupada} onClick={carregar}>Atualizar</Button>
        </>}
      />

      {infoTriagem?.modo === 'simulado' && (
        <Callout.Root color="amber" size="1" role="status">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>Triagem <strong>simulada</strong>: demonstração por palavras-chave, sem inteligência real. Os selos abaixo são só um exemplo de como a triagem aparecerá.</Callout.Text>
        </Callout.Root>
      )}
      {infoTriagem?.modo === 'jev' && (
        <Callout.Root color="gray" size="1" role="status">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>Triagem automática ({pct(infoTriagem.limite_alto)}+ de confiança em destaque; entre {pct(infoTriagem.limite_baixo)} e {pct(infoTriagem.limite_alto)} marcada como "revisar"). O texto é enviado sem nomes das partes. São apenas sugestões: nada é criado, tratado ou arquivado sozinho.</Callout.Text>
        </Callout.Root>
      )}
      {paraClientes > 0 && (
        <Callout.Root color="red" size="1" role="status">
          <Callout.Icon><span aria-hidden="true">❗</span></Callout.Icon>
          <Callout.Text><strong>{paraClientes}</strong> {paraClientes === 1 ? 'publicação é destinada a um cliente' : 'publicações são destinadas a clientes'} do escritório (neste filtro). Confira os prazos.</Callout.Text>
        </Callout.Root>
      )}
      <div className="oab-atalhos" role="group" aria-label="Filtrar por situação">
        {ATALHOS.map(a => {
          const ativo = status === a.valor
          const quantidade = contagem ? (a.valor ? contagem[a.valor] : contagem.nao_tratada + contagem.tratada + contagem.arquivada) : null
          return (
            <Button key={a.valor || 'todas'} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
              aria-pressed={ativo} disabled={ocupada} onClick={() => filtrar(() => setStatus(a.valor))}>
              {a.rotulo}
              {quantidade !== null && (
                a.valor === 'nao_tratada' && quantidade > 0
                  ? <Badge color="red" variant="solid" radius="full">{quantidade}</Badge>
                  : <Text size="1" color="gray">{quantidade}</Text>
              )}
            </Button>
          )
        })}
        <Button size="2" radius="full" variant={porPrioridade ? 'soft' : 'outline'} color={porPrioridade ? undefined : 'gray'} aria-pressed={porPrioridade}
          disabled={ocupada} title="Publicações de clientes primeiro e, depois, as mais urgentes" onClick={() => { setPorPrioridade(v => !v); setPagina(1) }}>
          Prioridade: clientes primeiro
        </Button>
      </div>

      <LinhaFiltros ativos={[tipo, periodo].filter(Boolean).length}>
        <div className="form-campo aj-filtros-busca">
          <label className="form-campo-label" htmlFor="oab-busca">Buscar</label>
          <TextField.Root id="oab-busca" type="search" placeholder="Número do processo, parte ou advogado" autoComplete="off"
            value={textoBusca} onChange={e => setTextoBusca(e.target.value)} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="oab-tipo-rotulo">Tipo</label>
          <Select.Root value={tipo || '__todos__'} disabled={ocupada} onValueChange={v => filtrar(() => setTipo(v === '__todos__' ? '' : v))}>
            <Select.Trigger aria-labelledby="oab-tipo-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os tipos</Select.Item>
              {tipos.map(t => <Select.Item key={t} value={t}>{t}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="oab-periodo-rotulo">Divulgação</label>
          <Select.Root value={periodo || '__qualquer__'} disabled={ocupada} onValueChange={v => filtrar(() => setPeriodo(v === '__qualquer__' ? '' : v as Periodo))}>
            <Select.Trigger aria-labelledby="oab-periodo-rotulo" />
            <Select.Content>
              <Select.Item value="__qualquer__">Qualquer data</Select.Item>
              <Select.Item value="hoje">Hoje</Select.Item>
              <Select.Item value="7">Últimos 7 dias</Select.Item>
              <Select.Item value="30">Últimos 30 dias</Select.Item>
              <Select.Item value="personalizado">Personalizado…</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        {periodo === 'personalizado' && <>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-desde">De</label>
            <CampoData id="oab-desde" value={desde} onChange={v => { setDesde(v); setPagina(1) }} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-ate">Até</label>
            <CampoData id="oab-ate" value={ate} onChange={v => { setAte(v); setPagina(1) }} />
          </div>
        </>}
        {filtrosAtivos && (
          <Button variant="soft" color="gray" size="2" disabled={ocupada}
            onClick={() => filtrar(() => { setTipo(''); setPeriodo(''); setDesde(''); setAte(''); setTextoBusca(''); setBusca('') })}>
            Limpar filtros
          </Button>
        )}
        {!estreita && (
          <Popover.Root>
            <Popover.Trigger>
              <Button size="2" variant="soft" color="gray">Colunas</Button>
            </Popover.Trigger>
            <Popover.Content style={{ width: 260 }}>
              <Text as="p" size="1" weight="bold" mb="2">Colunas adicionais</Text>
              <Flex direction="column" gap="2">
                {COLUNAS_OPCIONAIS.map(c => (
                  <Text as="label" size="2" key={c.key}>
                    <Flex gap="2" align="center">
                      <Checkbox checked={preferencias.includes(c.key)} onCheckedChange={marcada => escolherColuna(c.key, Boolean(marcada))} />
                      {c.header}
                    </Flex>
                  </Text>
                ))}
              </Flex>
            </Popover.Content>
          </Popover.Root>
        )}
      </LinhaFiltros>

      {lote && (
        <div className="oab-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">
            {todasFiltro ? `Todas ${total} publicações selecionadas` : `${selecionadas.size} selecionada(s)`}
          </Text>
          {todasPagina && !todasFiltro && total > publicacoes.length && (
            <Button size="1" variant="ghost" disabled={ocupada} onClick={() => setTodasFiltro(true)}>
              Selecionar todas {total} publicações
            </Button>
          )}
          <Button size="1" disabled={ocupada} onClick={() => {
            void (todasFiltro
              ? hashesTodasFiltro().then(hashes => mudarStatus(hashes, 'tratada', true))
              : mudarStatus([...selecionadas], 'tratada', true))
          }}><Check size={14} /> Marcar como tratadas</Button>
          <Button size="1" variant="soft" color="gray" disabled={ocupada} onClick={() => {
            void (todasFiltro
              ? hashesTodasFiltro().then(hashes => mudarStatus(hashes, 'arquivada', true))
              : mudarStatus([...selecionadas], 'arquivada', true))
          }}><Archive size={14} /> Arquivar</Button>
          <Button size="1" variant="soft" color="gray" disabled={ocupada} onClick={() => void abrirVincularLote()}>
            <Link2 size={14} /> Vincular processo
          </Button>
          <Button size="1" variant="soft" color="gray" disabled={ocupada} onClick={() => void abrirCriarLote()}>
            <FilePlus size={14} /> Criar processos
          </Button>
          <Button size="1" variant="ghost" disabled={operacao} onClick={() => { setSelecionadas(new Set()); setTodasFiltro(false) }}>Cancelar</Button>
        </div>
      )}

      <section aria-label="Lista de publicações" aria-busy={carregando || operacao}>
        {estreita ? (
          <ul className="oab-cartoes">
            {publicacoes.map(p => {
              const aberta = expandidas.has(p.hash)
              return (
                <li key={p.hash} className={`oab-cartao${paraCliente(p) ? ' oab-linha-cliente' : ''}`}>
                  <Flex align="center" gap="2" wrap="wrap">
                    <Checkbox aria-label={`Selecionar publicação ${formatarNumeroCNJ(numeroPublicacao(p))}`} checked={selecionadas.has(p.hash)} disabled={ocupada} onCheckedChange={() => alternar(p.hash)} />
                    <Text size="2" weight="bold">{dataDivulgacao(p)}</Text>
                    {seloTipo(p)}
                    <span style={{ marginLeft: 'auto' }}>{seloStatus(p)}</span>
                  </Flex>
                  <div>
                    <div className="oab-numero">{formatarNumeroCNJ(numeroPublicacao(p)) || 'Número não informado'}</div>
                    <div className="oab-secundario">{orgaoPublicacao(p)}</div>
                  </div>
                  <Text as="p" size="2">{nomePublicacao(p)}</Text>
                  {seloDestino(p)}
                  {triagemAtiva && seloTriagem(p)}
                  {vinculo(p)}
                  {aberta && detalhes(p)}
                  <Flex gap="2" align="center" className="oab-cartao-acoes">
                    {acaoPrincipal(p, true)}
                    <Button size="3" variant="soft" color="gray" aria-expanded={aberta} onClick={() => alternarExpandida(p.hash)}>{aberta ? 'Fechar' : 'Ler'}</Button>
                    {menuAcoes(p)}
                  </Flex>
                </li>
              )
            })}
          </ul>
        ) : (
          <TabelaResponsiva principais={triagemAtiva ? ['Processo', 'Partes', 'Triagem', 'Situação'] : ['Processo', 'Partes', 'Situação']}>
            <table aria-label="Publicações recebidas" className="oab-tabela">
              <thead>
                <tr>
                  <th aria-label="Detalhes" />
                  <th className="tabela-controle">
                    <Checkbox
                      aria-label="Selecionar publicações desta página"
                      checked={todasPagina ? true : algumasPagina ? 'indeterminate' : false}
                      disabled={ocupada || !publicacoes.length}
                      onCheckedChange={() => { if (ocupada) return; setSelecionadas(s => { const novo = new Set(s); for (const p of publicacoes) { if (todasPagina) novo.delete(p.hash); else novo.add(p.hash) } return novo }) }}
                    />
                  </th>
                  <th className="oab-col-data" aria-sort={ordemAsc ? 'ascending' : 'descending'}>
                    <button type="button" className="oab-ordenar" disabled={ocupada} onClick={() => { setOrdemAsc(v => !v); setPagina(1) }}>
                      Divulgado {ordemAsc ? '↑' : '↓'}
                    </button>
                  </th>
                  <th className="oab-col-processo">Processo</th>
                  <th>Partes</th>
                  {opcionais.map(c => <th key={c.key}>{c.header}</th>)}
                  <th className="oab-col-tipo">Tipo</th>
                  {triagemAtiva && (
                    <th className="oab-col-triagem">Triagem</th>
                  )}
                  <th className="oab-col-situacao">Situação</th>
                  <th className="tabela-acoes oab-col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {publicacoes.map(p => {
                  const aberta = expandidas.has(p.hash)
                  return (
                    <Fragment key={p.hash}>
                      <tr data-publicacao={p.hash} onClick={() => setFoco(p.hash)}
                        className={[selecionadas.has(p.hash) ? 'oab-linha-selecionada' : '', foco === p.hash ? 'oab-linha-foco' : '', paraCliente(p) ? 'oab-linha-cliente' : ''].filter(Boolean).join(' ') || undefined}>
                        <td>
                          <IconButton variant="ghost" size="1" aria-expanded={aberta} aria-controls={`oab-detalhes-${p.hash}`}
                            aria-label={`${aberta ? 'Recolher' : 'Expandir'} publicação ${formatarNumeroCNJ(numeroPublicacao(p))}`}
                            onClick={() => alternarExpandida(p.hash)}>
                            {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </IconButton>
                        </td>
                        <td className="tabela-controle">
                          <Checkbox aria-label={`Selecionar publicação ${formatarNumeroCNJ(numeroPublicacao(p))}`} checked={selecionadas.has(p.hash)} disabled={ocupada} onCheckedChange={() => alternar(p.hash)} />
                        </td>
                        <td>
                          <div className="oab-data">{dataDivulgacao(p)}</div>
                          <div className="oab-secundario">capturado {dataCapturaCurta(p)}</div>
                        </td>
                        <td>
                          <div className="oab-numero">{formatarNumeroCNJ(numeroPublicacao(p)) || 'Não informado'}</div>
                          <div className="oab-secundario">{orgaoPublicacao(p)}</div>
                        </td>
                        <td>{nomePublicacao(p)}{p.destino && <div className="oab-destino-linha">{seloDestino(p)}</div>}</td>
                        {opcionais.map(c => <td key={c.key}>{c.valor(p)}</td>)}
                        <td>{seloTipo(p)}</td>
                        {triagemAtiva && <td>{seloTriagem(p)}</td>}
                        <td>
                          {seloStatus(p)}
                          <div className="oab-vinculo-linha">{vinculo(p)}</div>
                        </td>
                        <td className="tabela-acoes">
                          <Flex gap="1" justify="end" align="center">
                            {acaoPrincipal(p)}
                            {menuAcoes(p)}
                          </Flex>
                        </td>
                      </tr>
                      {aberta && (
                        <tr id={`oab-detalhes-${p.hash}`}>
                          <td colSpan={8 + opcionais.length + (triagemAtiva ? 1 : 0)} className="oab-detalhes-celula">{detalhes(p)}</td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </TabelaResponsiva>
        )}
      </section>

      {erro && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>{erro} <Button variant="ghost" size="1" disabled={ocupada} onClick={carregar}>Tentar novamente</Button></Callout.Text>
        </Callout.Root>
      )}
      {carregando && <Carregamento tipo="tabela" descricao="Carregando publicações…" />}
      {!carregando && !erro && !publicacoes.length && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>
            {status === 'nao_tratada' && !filtrosAtivos
              ? 'Nenhuma publicação aguardando revisão.'
              : 'Nenhuma publicação encontrada com estes filtros.'}
          </Callout.Text>
        </Callout.Root>
      )}

      <nav aria-label="Páginas de publicações recebidas" className="aj-paginacao">
        <Text size="2" color="gray">{total ? `Mostrando ${primeira}–${ultima} de ${total} publicações` : '0 publicações'}</Text>
        <span style={{ marginLeft: 'auto' }} />
        <Flex align="center" gap="2">
          <Text as="label" size="2" color="gray" id="oab-tamanho-rotulo">Por página</Text>
          <Select.Root value={String(tamanho)} disabled={ocupada} onValueChange={(v) => { const novo = Number(v); if (novo !== tamanho) { setTamanho(novo); setPagina(1); setSelecionadas(new Set()) } }}>
            <Select.Trigger aria-labelledby="oab-tamanho-rotulo" />
            <Select.Content>
              {[10, 20, 50].map(n => <Select.Item key={n} value={String(n)}>{n}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Button variant="soft" color="gray" size="2" disabled={ocupada || pagina <= 1} onClick={() => setPagina(p => p - 1)} aria-label="Página anterior">Anterior</Button>
        <Text size="2">Página {pagina} de {totalPaginas}</Text>
        <Button variant="soft" color="gray" size="2" disabled={ocupada || pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)} aria-label="Próxima página">Próxima</Button>
      </nav>


      <Dialog.Root open={capturaAberta} onOpenChange={setCapturaAberta}>
        <Dialog.Content maxWidth="640px">
          <Dialog.Title>Capturar publicações por OAB</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="4">Consulta o DJEN agora para uma OAB e um período, sem esperar a captura diária.</Dialog.Description>
          <Captura onCapturado={carregar} />
          <Flex justify="end" mt="4">
            <Dialog.Close><Button variant="soft" color="gray">Fechar</Button></Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      {modal?.tipo === 'processo' && <ProcessoPublicacao publicacao={modal.p} onClose={() => { setModal(null); void carregar() }} onConcluido={m => { avisar({ texto: m }); setModal(null); void carregar() }} />}
      {modal?.tipo === 'atividade' && <AtividadePublicacao publicacao={modal.p} onClose={() => setModal(null)} onConcluido={m => { avisar({ texto: m }); setModal(null); void carregar() }} />}
      {hashesLote && <VincularProcessoLote hashes={hashesLote} onClose={() => setHashesLote(null)} onConcluido={m => { avisar({ texto: m }); setHashesLote(null); setSelecionadas(new Set()); setTodasFiltro(false); void carregar() }} />}
      {criarLote && <CriarProcessosLote publicacoes={criarLote} onClose={() => setCriarLote(null)} onConcluido={m => { avisar({ texto: m }); setCriarLote(null); setSelecionadas(new Set()); setTodasFiltro(false); void carregar() }} />}
    </Flex>
  )
}

const CLIENTE_PENDENTE = 'Pendente'

function CriarProcessosLote({ publicacoes, onClose, onConcluido }: { publicacoes: PublicacaoOab[]; onClose: () => void; onConcluido: (msg: string) => void }) {
  const { cliente } = useCliente()
  const { data: responsaveis = SEM_RESPONSAVEIS, error: erroResponsaveis } = useResponsaveis()
  const [responsavel, setResponsavel] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erroLocal, setErro] = useState('')
  const erro = erroLocal || (erroResponsaveis ? erroResponsaveis.message : '')
  const trava = useRef(false)

  // Só publicações sem processo; agrupadas por CNJ. Sem CNJ de 20 dígitos são puladas.
  const pendentes = publicacoes.filter(p => !p.caso_id)
  const grupos = new Map<string, PublicacaoOab[]>()
  let semCnj = 0
  for (const p of pendentes) {
    const n = numeroPublicacao(p)
    if (n.length !== 20) { semCnj++; continue }
    grupos.set(n, [...(grupos.get(n) ?? []), p])
  }
  const numeros = [...grupos.keys()]

  async function confirmar() {
    if (trava.current || !responsavel) return
    trava.current = true; setSalvando(true); setErro(''); setProgresso(0)
    let criados = 0, vinculados = 0, falhas = 0
    try {
      const achar = async () => (await buscarJson<{ clientes: Array<{ id: string; nome: string }> }>(cliente, '/clientes'))
        .clientes.find(c => c.nome.trim().toLowerCase() === CLIENTE_PENDENTE.toLowerCase())?.id
      let clienteId = await achar()
      for (const numero of numeros) {
        const hashes = grupos.get(numero)!.map(p => p.hash)
        try {
          const r = await buscarJson<{ casos: Caso[] }>(cliente, `/casos?q=${encodeURIComponent(numero)}`)
          let caso = r.casos.find(c => c.processos?.some(n => n.replace(/\D/g, '') === numero))
          let restantes = hashes
          if (caso) vinculados++
          else {
            caso = await enviarJson<Caso>(cliente, `/publicacoes-oab/${encodeURIComponent(hashes[0])}/criar-caso`, {
              ...(clienteId ? { cliente_id: clienteId } : { nome_cliente: CLIENTE_PENDENTE }), responsavel,
            })
            criados++; restantes = hashes.slice(1)
            clienteId ??= await achar() // o primeiro lote cria o "Pendente"; os demais o reutilizam
          }
          for (const hash of restantes) await enviarJson(cliente, `/casos/${encodeURIComponent(caso.id)}/publicacoes`, { hash })
        } catch { falhas++ }
        setProgresso(p => p + 1)
      }
    } catch (e) { setErro((e as Error).message); trava.current = false; setSalvando(false); return }
    trava.current = false; setSalvando(false)
    const resumo = `${criados} processo(s) criado(s), ${vinculados} vinculado(s) a processo existente${semCnj ? `, ${semCnj} publicação(ões) sem CNJ ignorada(s)` : ''}.`
    if (falhas) setErro(`${resumo} ${falhas} processo(s) falharam; tente novamente para completar.`)
    else onConcluido(`${resumo} Cliente "${CLIENTE_PENDENTE}": ajuste em cada processo.`)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !salvando) onClose() }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Criar processos em lote</Dialog.Title>
        <Flex direction="column" gap="4">
          <Text as="p" size="2">
            {numeros.length} processo(s) serão criados ou vinculados (por número CNJ distinto), a partir de {pendentes.length - semCnj} publicação(ões) sem processo.
            {semCnj > 0 && ` ${semCnj} sem CNJ válido serão ignoradas.`}
            {publicacoes.length - pendentes.length > 0 && ` ${publicacoes.length - pendentes.length} já vinculadas serão ignoradas.`}
          </Text>
          <Text as="p" size="2" color="gray">O cliente será "{CLIENTE_PENDENTE}"; altere-o em cada processo depois.</Text>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="clote-responsavel">Responsável <span className="aj-obrigatorio" aria-hidden="true">*</span></label>
            <Select.Root value={responsavel || '__none__'} disabled={salvando} onValueChange={v => setResponsavel(v === '__none__' ? '' : v)}>
              <Select.Trigger id="clote-responsavel" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="__none__">Selecione</Select.Item>
                {responsaveis.map(r => <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          {salvando && <Text size="2" role="status" color="gray">Processando… {progresso} de {numeros.length}</Text>}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button disabled={!responsavel || !numeros.length || salvando} loading={salvando} onClick={() => void confirmar()}>Criar processos</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function VincularProcessoLote({ hashes, onClose, onConcluido }: { hashes: string[]; onClose: () => void; onConcluido: (msg: string) => void }) {
  const { cliente } = useCliente()
  const [termo, setTermo] = useState('')
  const [casos, setCasos] = useState<Caso[]>([])
  const [escolhido, setEscolhido] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState('')

  async function consultar() {
    if (!termo.trim()) return
    setBuscando(true); setErro('')
    try {
      const r = await buscarJson<{ casos: Caso[] }>(cliente, `/casos?q=${encodeURIComponent(termo.trim())}`)
      setCasos(r.casos); setEscolhido(r.casos[0]?.id ?? '')
    } catch (e) { setErro((e as Error).message) } finally { setBuscando(false) }
  }

  async function confirmar() {
    if (!escolhido) return
    setSalvando(true); setErro(''); setProgresso(0)
    let ok = 0, falhas = 0
    for (const hash of hashes) {
      try {
        await enviarJson(cliente, `/casos/${encodeURIComponent(escolhido)}/publicacoes`, { hash })
        ok++
      } catch { falhas++ }
      setProgresso(ok + falhas)
    }
    setSalvando(false)
    if (falhas === 0) onConcluido(`${ok} publicação(ões) vinculadas ao processo.`)
    else setErro(`${ok} vinculada(s); ${falhas} falharam. Tente vincular as restantes individualmente.`)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !salvando) onClose() }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Vincular {hashes.length} publicação(ões) a um processo</Dialog.Title>
        <Flex direction="column" gap="4">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="vlote-termo">Consultar por CNJ, parte ou cliente</label>
            <TextField.Root id="vlote-termo" value={termo} disabled={salvando}
              onChange={e => setTermo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void consultar() } }} />
          </div>
          <div>
            <Button variant="soft" size="1" disabled={salvando || !termo.trim()} loading={buscando} onClick={() => void consultar()}>Consultar</Button>
          </div>
          {casos.length > 0 && (
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="vlote-processo">Processo de destino</label>
              <Select.Root value={escolhido} disabled={salvando} onValueChange={setEscolhido}>
                <Select.Trigger id="vlote-processo" style={{ width: '100%' }} />
                <Select.Content>
                  {casos.map(c => <Select.Item key={c.id} value={c.id}>{`${formatarNomeExibicao(c.titulo) || c.id} · ${(c.processos ?? []).map(formatarNumeroCNJ).join(', ')}`}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
          )}
          {salvando && <Text size="2" role="status" color="gray">Vinculando… {progresso} de {hashes.length}</Text>}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button disabled={!escolhido || salvando} loading={salvando} onClick={() => void confirmar()}>Confirmar vínculo</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
