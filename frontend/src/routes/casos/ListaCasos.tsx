import { ariaSort, BotaoOrdenar, EscolherColunas, ordenarLista, useColunas, useOrdenacao } from '../../OrdenacaoColunas'
import LinhaFiltros from '../../LinhaFiltros'
import CabecalhoPagina from '../../CabecalhoPagina'
import TabelaResponsiva from '../../TabelaResponsiva'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { AlertTriangle, Download, Info, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog, Badge, Button, Callout, Flex, HoverCard, IconButton, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { baixarCsv } from '../../utils/csv'
import type { PoloCliente } from '../../utils/polos'
import { useAvisos } from '../../Avisos'
import { ErroMCP } from '../../api/mcpClient'
import { useNavegacao } from '../../api/NavegacaoContext'
import { enviarJson } from '../../api/rest'
import { useQueryClient } from '@tanstack/react-query'
import { useCasos, useClientes, useNomePessoa } from '../../api/consultas'
import { diasEntreDatas, formatarNomeExibicao, formatarNumeroCNJ, hojeIso } from '../../utils/formatadores'
import { alternarCasoFavorito, ehCasoFavorito, EVENTO_PREFERENCIAS } from '../../utils/listasRapidas'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import { useEstreita } from '../../utils/useEstreita'
import NovoProcessoModal from './NovoProcessoModal'
import './lista-casos.scss'

export type Caso = {
  id: string
  titulo?: string
  status?: string
  processos?: string[]
  cliente_id?: string
  clientes_adicionais?: string[]
  acao?: string
  foro?: string
  responsavel?: string
  pasta?: string
  drive_pasta_id?: string | null
  pasta_drive?: 'criada' | 'falhou' | 'nao_configurado'
  acesso?: string
  ultima_movimentacao?: string
  monitorado?: boolean
  desfecho?: string
  proximo_compromisso?: { id: number | string; tipo: string; titulo: string; data: string; hora?: string | null } | null
  publicacoes_a_revisar?: number
  ultima_movimentacao_data?: string | null
  ultima_movimentacao_descricao?: string | null
  polos?: PoloCliente[]
}

type Cliente = { id: string; nome?: string }
type Atalho = 'andamento' | 'revisar' | 'atrasado' | 'parado' | 'encerrados' | 'favoritos'

const ROTULO_DESFECHO: Record<string, string> = {
  procedente: 'Procedente',
  procedente_parcial: 'Parc. procedente',
  improcedente: 'Improcedente',
  acordo: 'Acordo',
  extinto: 'Extinto s/ mérito',
  provido: 'Provido',
  desprovido: 'Desprovido',
}
const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }
const DIAS_PARADO = 90
const POR_PAGINA = 20

function formatarClasse(valor?: string): string {
  const siglas = new Set(['CNJ', 'STF', 'STJ', 'TST', 'TRT', 'TRF', 'TJ', 'OAB', 'INSS', 'FGTS', 'ICMS', 'IPI', 'IPTU', 'ISS', 'IRPF', 'IRPJ', 'CPC', 'CPP', 'CLT', 'CDC', 'ECA', 'CTN', 'JEC', 'JEFAZ'])
  return String(valor || '')
    .split(' - ')
    .map((parte) => {
      const texto = parte
        .trim()
        .toLocaleLowerCase('pt-BR')
        .replace(/\p{L}+/gu, (palavra) => (siglas.has(palavra.toLocaleUpperCase('pt-BR')) ? palavra.toLocaleUpperCase('pt-BR') : palavra))
      return texto.replace(/^\p{L}/u, (letra) => letra.toLocaleUpperCase('pt-BR'))
    })
    .filter(Boolean)
    .join(' · ')
}
function dataCurta(iso?: string | null) {
  if (!iso) return ''
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}
function haQuanto(iso: string, hoje: string) {
  const dias = diasEntreDatas(iso, hoje)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}
const encerrado = (c: Caso) => Boolean(c.desfecho)
const atrasado = (c: Caso, hoje: string) => Boolean(c.proximo_compromisso?.data && c.proximo_compromisso.data.slice(0, 10) < hoje)
const parado = (c: Caso, hoje: string) => !encerrado(c) && Boolean(c.ultima_movimentacao_data) && diasEntreDatas(c.ultima_movimentacao_data!, hoje) > DIAS_PARADO

const SEM_CLIENTES: Cliente[] = []

export default function ListaCasos({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { avisar } = useAvisos()
  const { cliente } = useCliente()
  const nomePessoa = useNomePessoa()
  const { irPara } = useNavegacao()
  const estreita = useEstreita()
  const [hoje] = useState(hojeIso)
  const queryClient = useQueryClient()
  const consultaCasos = useCasos<Caso>()
  const consultaClientes = useClientes<Cliente>()
  const carregando = consultaCasos.isPending || consultaClientes.isPending
  const casos: Caso[] | null = consultaCasos.data ?? null
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const erroConsulta = consultaCasos.error ?? consultaClientes.error
  const erro = erroAcao ?? (erroConsulta ? (erroConsulta instanceof ErroMCP ? erroConsulta.message : 'Falha ao carregar.') : null)
  const [busca, setBusca] = useState('')
  const [atalho, setAtalho] = useState<Atalho>('andamento')
  const [responsavel, setResponsavel] = useState('')
  const [tribunal, setTribunal] = useState('')
  const { ordem, alternar: alternarOrdem, definir: definirOrdem } = useOrdenacao('processos', { campo: 'proximo', direcao: 'asc' })
  const colunas = useColunas('processos', [
    { chave: 'cliente', rotulo: 'Cliente' }, { chave: 'responsavel', rotulo: 'Responsável' },
    { chave: 'compromisso', rotulo: 'Próximo compromisso' }, { chave: 'movimentacao', rotulo: 'Última movimentação' },
  ], ['responsavel', 'compromisso'])
  const [pagina, setPagina] = useState(1)
  const [, setVersaoFavoritos] = useState(0)
  const [paraExcluir, setParaExcluir] = useState<Caso | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [casoCriado, setCasoCriado] = useState<Caso | null>(null)
  const botaoNovo = useRef<HTMLButtonElement>(null)

  const recarregando = consultaCasos.isFetching || consultaClientes.isFetching
  const carregar = () => { setErroAcao(null); void consultaCasos.refetch(); void consultaClientes.refetch() }

  useEffect(() => {
    const reler = () => setVersaoFavoritos(v => v + 1)
    window.addEventListener(EVENTO_PREFERENCIAS, reler)
    return () => window.removeEventListener(EVENTO_PREFERENCIAS, reler)
  }, [])

  function favoritar(casoId: string) {
    alternarCasoFavorito(casoId)
    setVersaoFavoritos(v => v + 1)
  }

  const nomeCliente = (id?: string) => clientes.find((c) => c.id === id)?.nome ?? ''

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${paraExcluir.id}`, {}, 'DELETE')
      queryClient.setQueryData(['casos', cliente?.token], (atual: Caso[] | undefined) => atual?.filter((c) => c.id !== paraExcluir.id))
      setErroAcao(null)
      setParaExcluir(null)
    } catch (e) {
      setErroAcao(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()
  const termo = normalizar(busca)
  const numeroFiltro = /^[\d.\-/\s]+$/.test(busca) ? busca.replace(/\D/g, '') : ''

  // Busca, responsável e tribunal valem para todos os atalhos (e para seus contadores).
  const filtrados = useMemo(() => (casos ?? []).filter((c) => {
    if (responsavel && (c.responsavel || '') !== responsavel) return false
    if (tribunal && !(c.processos ?? []).some(n => siglaTribunalPorNumero(n) === tribunal)) return false
    if (!termo) return true
    if (numeroFiltro.length >= 4 && c.processos?.some((n) => n.replace(/\D/g, '').includes(numeroFiltro))) return true
    const textos = [c.titulo, c.acao, c.foro, c.responsavel, c.pasta, nomeCliente(c.cliente_id), ...(c.clientes_adicionais ?? []).map(nomeCliente), ...(c.processos ?? [])]
    return textos.some((t) => normalizar(t || '').includes(termo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [casos, clientes, responsavel, tribunal, termo, numeroFiltro])

  const noAtalho = (c: Caso, a: Atalho) => {
    switch (a) {
      case 'andamento': return !encerrado(c)
      case 'revisar': return !encerrado(c) && (c.publicacoes_a_revisar ?? 0) > 0
      case 'atrasado': return !encerrado(c) && atrasado(c, hoje)
      case 'parado': return parado(c, hoje)
      case 'encerrados': return encerrado(c)
      case 'favoritos': return ehCasoFavorito(c.id)
    }
  }
  const contagem = (a: Atalho) => filtrados.filter(c => noAtalho(c, a)).length

  // Ordem pelo cabeçalho da tabela (ou pela lista "Ordenar por" no celular). Sem compromisso ou
  // sem movimentação ficam sempre no fim; empates seguem pelo título.
  const ordenados = ordenarLista(
    [...filtrados.filter(c => noAtalho(c, atalho))].sort((a, b) => normalizar(a.titulo || '').localeCompare(normalizar(b.titulo || ''), 'pt-BR')),
    ordem, {
      titulo: c => normalizar(c.titulo || ''),
      numero: c => c.processos?.[0] ?? '',
      cliente: c => normalizar(nomeCliente(c.cliente_id)),
      responsavel: c => normalizar(c.responsavel || ''),
      proximo: c => c.proximo_compromisso?.data ?? null,
      movimentacao: c => c.ultima_movimentacao_data ?? null,
      recente: c => c.ultima_movimentacao ?? null,
    })

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = ordenados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)
  const responsaveis = useMemo(() => [...new Set((casos ?? []).map(c => c.responsavel).filter((r): r is string => Boolean(r)))].sort(), [casos])
  const tribunais = useMemo(() => [...new Set((casos ?? []).flatMap(c => (c.processos ?? []).map(n => siglaTribunalPorNumero(n))).filter((t): t is string => Boolean(t)))].sort(), [casos])
  const filtrosAtivos = Boolean(busca || responsavel || tribunal)

  function mudarFiltro(acao: () => void) { acao(); setPagina(1) }
  const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
  function exportar() {
    if (!ordenados.length) { avisar({ tipo: 'info', texto: 'Não há processos nesta lista para exportar.' }); return }
    baixarCsv('processos', [
      { titulo: 'Processo', valor: c => c.titulo },
      { titulo: 'Cliente', valor: c => nomeCliente(c.cliente_id) },
      { titulo: 'Números', valor: c => (c.processos ?? []).map(formatarNumeroCNJ).join('; ') },
      { titulo: 'Ação', valor: c => c.acao },
      { titulo: 'Órgão / foro', valor: c => c.foro },
      { titulo: 'Responsável', valor: c => c.responsavel },
      { titulo: 'Situação', valor: c => (encerrado(c) ? 'Encerrado' : 'Em andamento') },
      { titulo: 'Última movimentação', valor: c => dataBr(c.ultima_movimentacao_data) },
      { titulo: 'Descrição da movimentação', valor: c => c.ultima_movimentacao_descricao },
      { titulo: 'Próximo compromisso', valor: c => (c.proximo_compromisso ? `${dataBr(c.proximo_compromisso.data)} - ${c.proximo_compromisso.titulo}` : '') },
      { titulo: 'Publicações a revisar', valor: c => c.publicacoes_a_revisar ?? 0 },
    ], ordenados)
    avisar({ texto: `${ordenados.length} processo(s) exportado(s).` })
  }

  const atalhos: Array<{ valor: Atalho; rotulo: string; alerta?: boolean; icone?: boolean }> = [
    { valor: 'andamento', rotulo: 'Em andamento' },
    { valor: 'revisar', rotulo: 'Publicação a revisar', alerta: true },
    { valor: 'atrasado', rotulo: 'Prazo atrasado', alerta: true },
    { valor: 'parado', rotulo: `Sem movimentação há ${DIAS_PARADO} dias` },
    { valor: 'encerrados', rotulo: 'Encerrados' },
    { valor: 'favoritos', rotulo: 'Favoritos', icone: true },
  ]

  function selosDe(c: Caso) {
    return (
      <>
        {c.monitorado && <Badge color="blue" variant="soft">Monitorado</Badge>}
        {c.acesso === 'privado' && <Badge color="gray" variant="soft">Privado</Badge>}
        {c.desfecho && ROTULO_DESFECHO[c.desfecho] && <Badge color="purple" variant="soft">{ROTULO_DESFECHO[c.desfecho]}</Badge>}
      </>
    )
  }
  function revisarBadge(c: Caso) {
    return (c.publicacoes_a_revisar ?? 0) > 0
      ? <Badge color="red" variant="soft">{c.publicacoes_a_revisar} publicaç{c.publicacoes_a_revisar === 1 ? 'ão' : 'ões'} a revisar</Badge>
      : null
  }
  // Na tabela os detalhes secundários ficam no hover-card (desktop); alertas ficam sempre na linha.
  function detalhesCard(c: Caso) {
    const p = c.proximo_compromisso
    const adicionais = (c.clientes_adicionais ?? []).map(id => formatarNomeExibicao(nomeCliente(id))).filter(Boolean)
    return (
      <Flex direction="column" gap="3">
        <Text as="p" size="2" weight="bold">{c.titulo ? formatarNomeExibicao(c.titulo) : '(sem título)'}</Text>
        <dl className="casos-card-lista">
          <dt>Ação</dt><dd>{c.acao ? formatarClasse(c.acao) : 'Não informada'}</dd>
          <dt>Órgão</dt><dd>{c.foro || 'Não informado'}</dd>
          <dt>Responsável</dt><dd>{c.responsavel ? nomePessoa(c.responsavel) : 'Sem responsável'}</dd>
          <dt>Próximo</dt>
          <dd>
            {p ? <>
              <span className={atrasado(c, hoje) ? 'casos-alerta' : undefined}>{dataCurta(p.data)}{atrasado(c, hoje) ? ' · atrasado' : p.hora ? ` · ${p.hora.slice(0, 5)}` : ''}</span>
              <div>{ROTULO_TIPO[p.tipo] ?? p.tipo}: {p.titulo}</div>
            </> : <>Nenhum compromisso <button type="button" className="casos-link casos-pequeno" onClick={() => onAbrir(c.id)}>Agendar</button></>}
          </dd>
          {adicionais.length > 0 && <><dt>Outros clientes</dt><dd>{adicionais.join('; ')}</dd></>}
          {c.pasta && <><dt>Pasta</dt><dd>{c.pasta}</dd></>}
        </dl>
        <Flex gap="2" align="center" wrap="wrap">
          <Button size="1" onClick={() => onAbrir(c.id)}>Abrir processo</Button>
          {selosDe(c)}
        </Flex>
      </Flex>
    )
  }
  function titulo(c: Caso, naTabela = false) {
    const botao = (
      <button type="button" className="casos-link casos-titulo" title={naTabela ? undefined : (c.titulo ? formatarNomeExibicao(c.titulo) : undefined)} onClick={() => onAbrir(c.id)}>
        {c.titulo ? formatarNomeExibicao(c.titulo) : '(sem título)'}
      </button>
    )
    return (
      <>
        {naTabela ? (
          <HoverCard.Root openDelay={500} closeDelay={100}>
            <HoverCard.Trigger>{botao}</HoverCard.Trigger>
            <HoverCard.Content className="casos-hovercard" side="bottom" align="start" sideOffset={6} maxWidth="400px">
              {detalhesCard(c)}
            </HoverCard.Content>
          </HoverCard.Root>
        ) : botao}
        <Flex gap="1" mt="1" wrap="wrap">
          {revisarBadge(c)}
          {naTabela
            ? (atrasado(c, hoje) && <Badge color="red" variant="soft">Prazo atrasado</Badge>)
            : selosDe(c)}
        </Flex>
      </>
    )
  }
  function numeros(c: Caso, naTabela = false) {
    const lista = c.processos ?? []
    return (
      <>
        {lista.length ? lista.map((numero) => (
          <div key={numero}>
            <button type="button" className="casos-link casos-numero" title="Consultar no DataJud"
              onClick={() => irPara('processo', { tribunal: siglaTribunalPorNumero(numero) ?? '', numero_processo: numero })}>
              {formatarNumeroCNJ(numero)}
            </button>
          </div>
        )) : <Text size="2" color="gray">Sem número</Text>}
        {!naTabela && c.acao && <div className="casos-secundario">{formatarClasse(c.acao)}</div>}
        {!naTabela && c.foro && <div className="casos-secundario">{c.foro}</div>}
      </>
    )
  }
  function clienteCelula(c: Caso) {
    const principal = formatarNomeExibicao(nomeCliente(c.cliente_id)) || 'Sem cliente vinculado'
    const extras = (c.clientes_adicionais ?? []).length
    return (
      <>
        <div>{principal}</div>
        {extras > 0 && <div className="casos-secundario">+ {extras} cliente{extras > 1 ? 's' : ''}</div>}
        {c.pasta && <div className="casos-secundario">Pasta {c.pasta}</div>}
      </>
    )
  }
  function compromisso(c: Caso) {
    const p = c.proximo_compromisso
    if (!p) return <><Text size="2" color="gray" aria-hidden="true">—</Text><span className="aj-sr-only">Nenhum compromisso</span><div><button type="button" className="casos-link casos-pequeno casos-agendar" onClick={() => onAbrir(c.id)}>Agendar</button></div></>
    const late = atrasado(c, hoje)
    return (
      <>
        <div className={late ? 'casos-data casos-alerta' : 'casos-data'}>
          {dataCurta(p.data)}{late ? ' · atrasado' : p.hora ? ` · ${p.hora.slice(0, 5)}` : ''}
        </div>
        <div className="casos-secundario">{ROTULO_TIPO[p.tipo] ?? p.tipo}: {p.titulo}</div>
      </>
    )
  }
  function movimentacao(c: Caso) {
    if (!c.ultima_movimentacao_data) return <Text size="1" color="gray">Sem movimentação registrada</Text>
    return (
      <>
        <div>{c.ultima_movimentacao_descricao || 'Movimentação'}</div>
        <div className={parado(c, hoje) ? 'casos-secundario casos-parado' : 'casos-secundario'}>
          {dataCurta(c.ultima_movimentacao_data)} · {haQuanto(c.ultima_movimentacao_data, hoje)}{parado(c, hoje) ? ' · parado' : ''}
        </div>
      </>
    )
  }
  function estrela(c: Caso, grande = false) {
    const fav = ehCasoFavorito(c.id)
    return (
      <IconButton variant="ghost" size={grande ? '3' : '1'} color={fav ? 'amber' : 'gray'} aria-pressed={fav}
        aria-label={fav ? `Remover ${c.titulo || 'processo'} dos favoritos` : `Adicionar ${c.titulo || 'processo'} aos favoritos`}
        onClick={() => favoritar(c.id)}>
        <Star size={16} fill={fav ? 'currentColor' : 'none'} />
      </IconButton>
    )
  }
  function menu(c: Caso) {
    const numero = c.processos?.[0]
    return <AcoesTabela rotulo={c.titulo || 'processo'} acoes={[
      { texto: 'Abrir processo', executar: () => onAbrir(c.id) },
      ...(numero ? [{ texto: 'Consultar no DataJud', executar: () => irPara('processo', { tribunal: siglaTribunalPorNumero(numero) ?? '', numero_processo: numero }) }] : []),
      { texto: 'Excluir', executar: () => setParaExcluir(c), perigo: true },
    ]} />
  }

  return (
    <div className="casos-lista">
      <Flex direction="column" gap="5">
        <CabecalhoPagina
          titulo="Processos"
          focavel
          descricao="Cadastros, atividades e acompanhamento do escritório."
          acoes={<>
            <Button size="2" variant="soft" color="gray" onClick={exportar}><Download size={14} aria-hidden="true" />Exportar CSV</Button>
            <Button ref={botaoNovo} size="2" onClick={() => setModalNovoAberto(true)}>Novo processo</Button>
          </>}
        />
        {casoCriado && (
          <Callout.Root color="green" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>
              Processo "{casoCriado.titulo || 'sem título'}" cadastrado.{' '}
              <button type="button" className="contato-nome-link" onClick={() => onAbrir(casoCriado.id)}>Abrir processo criado</button>{' '}
              <button type="button" className="contato-nome-link" onClick={() => setCasoCriado(null)}>Fechar</button>
            </Callout.Text>
          </Callout.Root>
        )}

        <div className="casos-atalhos" role="group" aria-label="Situação dos processos">
          {atalhos.map(a => {
            const ativo = atalho === a.valor, qtd = contagem(a.valor)
            return (
              <Button key={a.valor} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
                aria-pressed={ativo} onClick={() => mudarFiltro(() => setAtalho(a.valor))}>
                {a.icone && <Star size={14} aria-hidden="true" />}
                {a.rotulo}
                {a.alerta && qtd > 0 ? <Badge color="red" variant="solid" radius="full">{qtd}</Badge> : <Text size="1" color="gray">{qtd}</Text>}
              </Button>
            )
          })}
        </div>

        <LinhaFiltros ativos={[responsavel, tribunal].filter(Boolean).length}>
          <div className="form-campo aj-filtros-busca">
            <label className="form-campo-label" htmlFor="casos-busca">Buscar</label>
            <TextField.Root id="casos-busca" type="search" placeholder="Título, cliente, parte, número ou pasta" autoComplete="off"
              value={busca} onChange={(e) => mudarFiltro(() => setBusca(e.target.value))} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" id="casos-resp-rotulo">Responsável</label>
            <Select.Root value={responsavel || '__todos__'} onValueChange={v => mudarFiltro(() => setResponsavel(v === '__todos__' ? '' : v))}>
              <Select.Trigger aria-labelledby="casos-resp-rotulo" />
              <Select.Content>
                <Select.Item value="__todos__">Todos os responsáveis</Select.Item>
                {responsaveis.map(r => <Select.Item key={r} value={r}>{nomePessoa(r)}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" id="casos-tribunal-rotulo">Tribunal</label>
            <Select.Root value={tribunal || '__todos__'} onValueChange={v => mudarFiltro(() => setTribunal(v === '__todos__' ? '' : v))}>
              <Select.Trigger aria-labelledby="casos-tribunal-rotulo" />
              <Select.Content>
                <Select.Item value="__todos__">Todos os tribunais</Select.Item>
                {tribunais.map(t => <Select.Item key={t} value={t}>{t.toUpperCase()}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" id="casos-ordem-rotulo">Ordenar por</label>
            <Select.Root value={ordem.campo} onValueChange={v => definirOrdem({ campo: v, direcao: v === 'movimentacao' || v === 'recente' ? 'desc' : 'asc' })}>
              <Select.Trigger aria-labelledby="casos-ordem-rotulo" />
              <Select.Content>
                <Select.Item value="proximo">Próximo compromisso</Select.Item>
                <Select.Item value="movimentacao">Última movimentação</Select.Item>
                <Select.Item value="titulo">Título</Select.Item>
                <Select.Item value="recente">Atualização mais recente</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          {filtrosAtivos && <Button size="2" variant="soft" color="gray" onClick={() => mudarFiltro(() => { setBusca(''); setResponsavel(''); setTribunal('') })}>Limpar filtros</Button>}
          {!estreita && <div className="aj-filtros-botao"><EscolherColunas colunas={colunas} /></div>}
        </LinhaFiltros>

        <div aria-live="polite">
          {carregando && <Carregamento colunas={6} />}
          {erro && (
            <Flex direction="column" gap="3">
              <Callout.Root color="red" size="1">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{erro}</Callout.Text>
              </Callout.Root>
              <Button variant="soft" size="1" onClick={carregar} disabled={recarregando} style={{ alignSelf: 'flex-start' }}>Tentar novamente</Button>
            </Flex>
          )}
          {!carregando && casos && casos.length === 0 && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>Nenhum processo cadastrado ainda.</Callout.Text>
            </Callout.Root>
          )}
          {!carregando && casos && casos.length > 0 && ordenados.length === 0 && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>Nenhum processo nesta situação com estes filtros.</Callout.Text>
            </Callout.Root>
          )}
        </div>

        {!carregando && visiveis.length > 0 && (
          <section aria-label="Processos">
            {estreita ? (
              <ul className="casos-cartoes">
                {visiveis.map(c => (
                  <li key={c.id} className="casos-cartao">
                    <Flex align="start" gap="2">
                      <div style={{ flex: 1, minWidth: 0 }}>{titulo(c)}</div>
                      {estrela(c, true)}
                    </Flex>
                    <div>{numeros(c)}</div>
                    <div className="casos-cartao-linha">
                      {formatarNomeExibicao(nomeCliente(c.cliente_id)) || 'Sem cliente vinculado'}
                      {c.responsavel && <Text color="gray"> · {nomePessoa(c.responsavel)}</Text>}
                    </div>
                    <div className="casos-cartao-resumo">
                      <div><div className="casos-rotulo">Próximo</div>{compromisso(c)}</div>
                      <div><div className="casos-rotulo">Movimentação</div>{movimentacao(c)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <TabelaResponsiva principais={['Título', 'Nº do processo']} larguraCompacta={1000}>
                <table aria-label="Processos" className="casos-tabela-nova">
                  <thead>
                    <tr>
                      <th className="tabela-controle" aria-label="Favorito" />
                      <th aria-sort={ariaSort('titulo', ordem)}><BotaoOrdenar campo="titulo" ordem={ordem} onOrdenar={alternarOrdem}>Título</BotaoOrdenar></th>
                      <th className="casos-col-numero" aria-sort={ariaSort('numero', ordem)}><BotaoOrdenar campo="numero" ordem={ordem} onOrdenar={alternarOrdem}>Nº do processo</BotaoOrdenar></th>
                      {colunas.visivel('cliente') && <th className="casos-col-cliente" aria-sort={ariaSort('cliente', ordem)}><BotaoOrdenar campo="cliente" ordem={ordem} onOrdenar={alternarOrdem}>Cliente</BotaoOrdenar></th>}
                      {colunas.visivel('responsavel') && <th className="casos-col-resp" aria-sort={ariaSort('responsavel', ordem)}><BotaoOrdenar campo="responsavel" ordem={ordem} onOrdenar={alternarOrdem}>Responsável</BotaoOrdenar></th>}
                      {colunas.visivel('compromisso') && <th className="casos-col-comp" aria-sort={ariaSort('proximo', ordem)}><BotaoOrdenar campo="proximo" ordem={ordem} onOrdenar={alternarOrdem}>Compromisso</BotaoOrdenar></th>}
                      {colunas.visivel('movimentacao') && <th className="casos-col-mov" aria-sort={ariaSort('movimentacao', ordem)}><BotaoOrdenar campo="movimentacao" ordem={ordem} onOrdenar={alternarOrdem}>Movimentação</BotaoOrdenar></th>}
                      <th className="tabela-acoes casos-col-acoes">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(c => (
                      <tr key={c.id}>
                        <td className="tabela-controle">{estrela(c)}</td>
                        <td>{titulo(c, true)}</td>
                        <td>{numeros(c, true)}</td>
                        {colunas.visivel('cliente') && <td>{clienteCelula(c)}</td>}
                        {colunas.visivel('responsavel') && <td>
                          {c.responsavel ? (
                            <span>{nomePessoa(c.responsavel)}</span>
                          ) : <Text size="1" color="gray">Sem responsável</Text>}
                        </td>}
                        {colunas.visivel('compromisso') && <td>{compromisso(c)}</td>}
                        {colunas.visivel('movimentacao') && <td>{movimentacao(c)}{!colunas.visivel('compromisso') && c.proximo_compromisso && atrasado(c, hoje) && <div className="casos-secundario casos-alerta">Prazo {dataCurta(c.proximo_compromisso.data)} · atrasado</div>}</td>}
                        <td className="tabela-acoes">{menu(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabelaResponsiva>
            )}
          </section>
        )}

        {!carregando && ordenados.length > 0 && (
          <nav aria-label="Páginas de processos" className="aj-paginacao">
            <Text size="2" color="gray">
              Mostrando {(paginaAtual - 1) * POR_PAGINA + 1}–{Math.min(paginaAtual * POR_PAGINA, ordenados.length)} de {ordenados.length} processo(s)
            </Text>
            <span style={{ marginLeft: 'auto' }} />
            <Button variant="soft" color="gray" size="2" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)} aria-label="Página anterior">Anterior</Button>
            <Text size="2">Página {paginaAtual} de {totalPaginas}</Text>
            <Button variant="soft" color="gray" size="2" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)} aria-label="Próxima página">Próxima</Button>
          </nav>
        )}

        <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
          <AlertDialog.Content maxWidth="400px">
            <AlertDialog.Title>Excluir processo</AlertDialog.Title>
            <AlertDialog.Description>
              Excluir o processo "{paraExcluir?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.
            </AlertDialog.Description>
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
        <NovoProcessoModal
          open={modalNovoAberto}
          launcherButtonRef={botaoNovo}
          clientes={clientes.map((c) => ({ id: c.id, nome: c.nome ?? '' }))}
          onClose={() => setModalNovoAberto(false)}
          onCriado={(novoCaso) => {
            queryClient.setQueryData(['casos', cliente?.token], (atual: Caso[] | undefined) => [...(atual ?? []), novoCaso])
            setModalNovoAberto(false)
            setCasoCriado(novoCaso)
          }}
        />
      </Flex>
    </div>
  )
}
