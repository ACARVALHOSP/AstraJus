import LinhaFiltros from '../LinhaFiltros'
import CabecalhoPagina from '../CabecalhoPagina'
import Paginacao, { paginaPara, POR_PAGINA } from '../Paginacao'
import { ariaSort, BotaoOrdenar, EscolherColunas, ordenarLista, useColunas, useOrdenacao } from '../OrdenacaoColunas'
import TabelaResponsiva from '../TabelaResponsiva'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Checkbox, Flex, IconButton, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import { useAvisos } from '../Avisos'
import NovoLancamentoModal from './financeiro/NovoLancamentoModal'
import './financeiro/financeiro.scss'

type Lancamento = {
  id: string
  vencimento?: string
  valor?: number
  descricao: string
  recorrente?: boolean
  cliente_id?: string
  caso_id?: string
  responsavel?: string
  direcao: 'DESPESA' | 'RECEITA'
  pago: boolean
  asaas_cobranca_id?: string
}
type Cliente = { id: string; nome?: string }
type Caso = { id: string; titulo?: string }
type Situacao = 'aberto' | 'vencido' | 'quitado'
type Atalho = '' | Situacao

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const RE_PARCELA = /\s*\(parcela (\d+)\/(\d+)\)\s*$/i

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function diasEntre(deIso: string, ateIso: string) {
  const [a, b] = [deIso, ateIso].map(v => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / 86_400_000)
}
function mesSomado(mes: string, delta: number) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function rotuloMes(mes: string) {
  const [y, m] = mes.split('-').map(Number)
  const nome = MESES[m - 1]
  return `${nome[0].toUpperCase()}${nome.slice(1)} de ${y}`
}
function situacaoDe(l: Lancamento, hoje: string): Situacao {
  if (l.pago) return 'quitado'
  return l.vencimento && l.vencimento.slice(0, 10) < hoje ? 'vencido' : 'aberto'
}
function relativo(l: Lancamento, hoje: string) {
  if (!l.vencimento) return ''
  const dias = diasEntre(hoje, l.vencimento.slice(0, 10))
  if (l.pago) return dias === -1 ? 'ontem' : dias < 0 ? `há ${-dias} dias` : dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`
  if (dias < -1) return `vencido há ${-dias} dias`
  if (dias === -1) return 'venceu ontem'
  if (dias === 0) return 'vence hoje'
  if (dias === 1) return 'vence amanhã'
  return `vence em ${dias} dias`
}
function dataCurta(iso?: string) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function partesDescricao(descricao: string) {
  const m = RE_PARCELA.exec(descricao)
  return m ? { texto: descricao.replace(RE_PARCELA, ''), parcela: `${m[1]}/${m[2]}` } : { texto: descricao, parcela: '' }
}

export default function Financeiro() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const estreita = useEstreita()
  const [hoje] = useState(() => isoLocal(new Date()))
  const [mes, setMes] = useState(() => hoje.slice(0, 7))
  const [todosMeses, setTodosMeses] = useState(false)
  const [atalho, setAtalho] = useState<Atalho>('')
  const [direcao, setDirecao] = useState<'' | 'RECEITA' | 'DESPESA'>('')
  const [clienteFiltro, setClienteFiltro] = useState('')
  const [responsavelFiltro, setResponsavelFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [operando, setOperando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { avisar } = useAvisos()
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [casos, setCasos] = useState<Caso[]>([])
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [paraExcluir, setParaExcluir] = useState<Lancamento | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [respLancamentos, respClientes, respCasos] = await Promise.all([
        buscarJson<{ lancamentos: Lancamento[] }>(cliente, '/lancamentos'),
        buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes'),
        buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      ])
      setLancamentos(respLancamentos.lancamentos ?? [])
      setClientes(respClientes.clientes ?? [])
      setCasos(respCasos.casos ?? [])
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar os dados. Tente de novo.')
    } finally {
      setCarregando(false)
    }
  }, [cliente])
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
  }, [carregar])

  const nomeCliente = useCallback((id?: string) => formatarNomeExibicao(clientes.find(c => c.id === id)?.nome ?? '') || '—', [clientes])
  const tituloCaso = useCallback((id?: string) => formatarNomeExibicao(casos.find(c => c.id === id)?.titulo ?? ''), [casos])

  // Mês escolhido + vencidos em aberto de meses anteriores, que continuam pendentes.
  const doPeriodo = useMemo(() => (lancamentos ?? []).filter(l => {
    if (todosMeses) return true
    const venc = (l.vencimento ?? '').slice(0, 7)
    return venc === mes || (!l.pago && venc < mes && mes <= hoje.slice(0, 7))
  }), [lancamentos, mes, todosMeses, hoje])
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return doPeriodo.filter(l =>
      (!direcao || l.direcao === direcao) &&
      (!clienteFiltro || l.cliente_id === clienteFiltro) &&
      (!responsavelFiltro || l.responsavel === responsavelFiltro) &&
      (!termo || `${l.descricao} ${nomeCliente(l.cliente_id)} ${tituloCaso(l.caso_id)}`.toLocaleLowerCase('pt-BR').includes(termo)))
  }, [doPeriodo, direcao, clienteFiltro, responsavelFiltro, busca, nomeCliente, tituloCaso])
  const { ordem, alternar: alternarOrdem } = useOrdenacao('lancamentos', { campo: 'vencimento', direcao: 'asc' })
  const colunas = useColunas('lancamentos', [{ chave: 'cliente', rotulo: 'Cliente' }, { chave: 'situacao', rotulo: 'Situação' }])
  const ORDEM_SITUACAO: Record<Situacao, number> = { vencido: 0, aberto: 1, quitado: 2 }
  const visiveis = ordenarLista(atalho ? filtrados.filter(l => situacaoDe(l, hoje) === atalho) : filtrados, ordem, {
    vencimento: l => l.vencimento?.slice(0, 10),
    descricao: l => partesDescricao(l.descricao).texto,
    cliente: l => nomeCliente(l.cliente_id),
    valor: l => (l.direcao === 'DESPESA' ? -1 : 1) * (l.valor ?? 0),
    situacao: l => ORDEM_SITUACAO[situacaoDe(l, hoje)],
  })
  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { aberto: 0, vencido: 0, quitado: 0 }
    for (const l of filtrados) c[situacaoDe(l, hoje)]++
    return c
  }, [filtrados, hoje])

  const soma = (lista: Lancamento[]) => lista.reduce((t, l) => t + (l.valor ?? 0), 0)
  const kpis = useMemo(() => {
    const base = filtrados
    const noMes = (l: Lancamento) => todosMeses || (l.vencimento ?? '').slice(0, 7) === mes
    const receber = base.filter(l => l.direcao === 'RECEITA' && situacaoDe(l, hoje) === 'aberto' && noMes(l))
    const pagar = base.filter(l => l.direcao === 'DESPESA' && !l.pago && noMes(l))
    const vencidos = base.filter(l => l.direcao === 'RECEITA' && situacaoDe(l, hoje) === 'vencido')
    const recebido = base.filter(l => l.direcao === 'RECEITA' && l.pago && noMes(l))
    return { receber, pagar, vencidos, recebido }
  }, [filtrados, mes, todosMeses, hoje])
  const totais = useMemo(() => {
    const receitas = soma(visiveis.filter(l => l.direcao === 'RECEITA'))
    const despesas = soma(visiveis.filter(l => l.direcao === 'DESPESA'))
    return { receitas, despesas, saldo: receitas - despesas }
  }, [visiveis])

  const responsaveis = useMemo(() => [...new Set((lancamentos ?? []).map(l => l.responsavel).filter((r): r is string => Boolean(r)))].sort(), [lancamentos])
  const clientesComLancamento = useMemo(() => {
    const ids = new Set((lancamentos ?? []).map(l => l.cliente_id))
    return clientes.filter(c => ids.has(c.id)).sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'))
  }, [lancamentos, clientes])
  const filtrosAtivos = Boolean(direcao || clienteFiltro || responsavelFiltro || busca)
  const lote = selecionados.size > 0
  // 20 por página; volta para a 1ª quando mês, atalho ou filtros mudam. Os totais somam a lista toda.
  const chavePagina = [mes, todosMeses, atalho, direcao, clienteFiltro, responsavelFiltro, busca, ordem.campo, ordem.direcao].join('|')
  const [estadoPagina, setEstadoPagina] = useState({ chave: chavePagina, pagina: 1 })
  const pagina = paginaPara(estadoPagina, chavePagina)
  const naPagina = useMemo(() => visiveis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA), [visiveis, pagina])
  const todosSelecionados = naPagina.length > 0 && naPagina.every(l => selecionados.has(l.id))

  async function definirPago(alvos: Lancamento[], pago: boolean, desfazendo = false) {
    if (!alvos.length || (operando && !desfazendo)) return
    setOperando(true)
    const feitos = new Set<string>()
    let falha = ''
    for (const l of alvos) {
      try {
        await enviarJson(cliente, `/lancamentos/${l.id}`, { pago }, 'PATCH')
        feitos.add(l.id)
      } catch (e) { falha = e instanceof ErroMCP ? e.message : 'Falha ao atualizar.' }
    }
    setLancamentos(atual => atual?.map(l => (feitos.has(l.id) ? { ...l, pago } : l)) ?? null)
    setSelecionados(s => new Set([...s].filter(id => !feitos.has(id))))
    setOperando(false)
    if (falha) avisar({ tipo: 'erro', texto: falha })
    if (desfazendo || !feitos.size) return
    const feitosLista = alvos.filter(l => feitos.has(l.id))
    const unico = feitosLista.length === 1 ? feitosLista[0] : null
    const texto = unico
      ? `${partesDescricao(unico.descricao).texto}: ${pago ? (unico.direcao === 'RECEITA' ? 'marcado como recebido' : 'marcado como pago') : 'voltou para em aberto'}.`
      : `${feitosLista.length} lançamentos ${pago ? 'marcados como pagos/recebidos' : 'voltaram para em aberto'}.`
    avisar({ texto, desfazer: () => definirPago(feitosLista, !pago, true) })
  }
  async function gerarCobranca(l: Lancamento) {
    try {
      await enviarJson(cliente, `/lancamentos/${l.id}/cobranca`, {})
      avisar({ texto: 'Cobrança gerada no Asaas.' })
      await carregar()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao gerar cobrança.' })
    }
  }
  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/lancamentos/${paraExcluir.id}`, {}, 'DELETE')
      avisar({ texto: `Lançamento "${partesDescricao(paraExcluir.descricao).texto}" excluído.` })
      setParaExcluir(null)
      await carregar()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao excluir.' })
    } finally {
      setExcluindo(false)
    }
  }

  function acaoPrincipal(l: Lancamento, grande = false) {
    const tamanho = grande ? '3' : '1'
    const estilo = grande ? { flex: 1 } : undefined
    if (l.pago) return <Button size={tamanho} variant="soft" color="gray" style={estilo} disabled={operando || lote} onClick={() => definirPago([l], false)}>Desfazer</Button>
    return <Button size={tamanho} variant="soft" style={estilo} disabled={operando || lote} onClick={() => definirPago([l], true)}>{l.direcao === 'RECEITA' ? 'Marcar recebido' : 'Marcar pago'}</Button>
  }
  function menu(l: Lancamento) {
    return <AcoesTabela rotulo={l.descricao} acoes={[
      ...(l.direcao === 'RECEITA' && !l.asaas_cobranca_id && !l.pago ? [{ texto: 'Gerar cobrança (boleto/Pix)', desabilitada: operando, executar: () => gerarCobranca(l) }] : []),
      ...(l.asaas_cobranca_id ? [{ texto: 'Ver cobrança em Pagamentos', executar: () => irPara('pagamentos') }] : []),
      ...(l.caso_id ? [{ texto: 'Abrir processo', executar: () => irPara('casos', { id: l.caso_id }) }] : []),
      { texto: 'Excluir', executar: () => setParaExcluir(l), perigo: true },
    ]} />
  }
  function seloSituacao(l: Lancamento) {
    const s = situacaoDe(l, hoje)
    if (s === 'quitado') return <Badge color="green" variant="soft" radius="full">{l.direcao === 'RECEITA' ? 'Recebido' : 'Pago'}</Badge>
    if (s === 'vencido') return <Badge color="red" variant="soft" radius="full">Vencido</Badge>
    return <Badge color="gray" variant="soft" radius="full">Em aberto</Badge>
  }
  function valor(l: Lancamento) {
    const receita = l.direcao === 'RECEITA'
    return (
      <>
        <span className={receita ? 'fin-valor fin-receita' : 'fin-valor fin-despesa'}>{receita ? '+' : '−'} {formatarMoeda(l.valor)}</span>
        <div className="fin-secundario">{receita ? 'receita' : 'despesa'}</div>
      </>
    )
  }
  function descricao(l: Lancamento) {
    const { texto, parcela } = partesDescricao(l.descricao)
    const processo = tituloCaso(l.caso_id)
    return (
      <>
        <Flex gap="2" align="center" wrap="wrap">
          <span className="fin-descricao">{texto}</span>
          {parcela && <Badge color="gray" variant="soft">Parcela {parcela}</Badge>}
          {l.recorrente && <Badge color="gray" variant="soft">Mensal</Badge>}
        </Flex>
        {processo
          ? <button type="button" className="fin-link" onClick={() => irPara('casos', { id: l.caso_id })}>{processo}</button>
          : <div className="fin-secundario">Sem processo vinculado</div>}
      </>
    )
  }
  const relativoClasse = (l: Lancamento) => situacaoDe(l, hoje) === 'vencido' ? 'fin-secundario fin-alerta' : 'fin-secundario'
  const sufixoMes = todosMeses ? '' : ' no mês'

  const atalhos: Array<{ valor: Atalho; rotulo: string; qtd: number; alerta?: boolean }> = [
    { valor: 'aberto', rotulo: 'Em aberto', qtd: contagem.aberto },
    { valor: 'vencido', rotulo: 'Vencidos', qtd: contagem.vencido, alerta: true },
    { valor: 'quitado', rotulo: 'Pagos e recebidos', qtd: contagem.quitado },
    { valor: '', rotulo: 'Todos', qtd: filtrados.length },
  ]

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Lançamentos"
        descricao="Receitas e despesas do escritório vinculadas a clientes e processos."
        acoes={<>
          <Flex align="center" className="fin-mes" role="group" aria-label="Mês">
            <IconButton variant="ghost" color="gray" aria-label="Mês anterior" disabled={todosMeses} onClick={() => { setMes(m => mesSomado(m, -1)); setSelecionados(new Set()) }}><ChevronLeft size={16} /></IconButton>
            <Text size="2" weight="medium" className="fin-mes-rotulo" aria-live="polite">{todosMeses ? 'Todos os meses' : rotuloMes(mes)}</Text>
            <IconButton variant="ghost" color="gray" aria-label="Próximo mês" disabled={todosMeses} onClick={() => { setMes(m => mesSomado(m, 1)); setSelecionados(new Set()) }}><ChevronRight size={16} /></IconButton>
          </Flex>
          <Button size="2" variant={todosMeses ? 'soft' : 'outline'} color="gray" aria-pressed={todosMeses} onClick={() => { setTodosMeses(v => !v); setSelecionados(new Set()) }}>Todos os meses</Button>
          {!todosMeses && mes !== hoje.slice(0, 7) && <Button size="2" variant="soft" color="gray" onClick={() => setMes(hoje.slice(0, 7))}>Mês atual</Button>}
          <Button size="2" onClick={() => setModalNovoAberto(true)}>Novo lançamento</Button>
        </>}
      />

      <dl className="fin-resumo">
        <div><dt>A receber{sufixoMes}</dt><dd className={kpis.receber.length ? 'fin-receita' : undefined}>{formatarMoeda(soma(kpis.receber))}</dd><p>{kpis.receber.length} em aberto</p></div>
        <div><dt>A pagar{sufixoMes}</dt><dd>{formatarMoeda(soma(kpis.pagar))}</dd><p>{kpis.pagar.length} em aberto</p></div>
        <div><dt>Vencidos a receber</dt><dd className={kpis.vencidos.length ? 'fin-despesa' : undefined}>{formatarMoeda(soma(kpis.vencidos))}</dd><p>{kpis.vencidos.length} lançamento(s), de qualquer mês</p></div>
        <div><dt>Recebido{sufixoMes}</dt><dd>{formatarMoeda(soma(kpis.recebido))}</dd><p>{kpis.recebido.length} quitado(s)</p></div>
      </dl>

      <div className="fin-atalhos" role="group" aria-label="Situação">
        {atalhos.map(a => {
          const ativo = atalho === a.valor
          return (
            <Button key={a.valor || 'todos'} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
              aria-pressed={ativo} onClick={() => { setAtalho(a.valor); setSelecionados(new Set()) }}>
              {a.rotulo}
              {a.alerta && a.qtd > 0 ? <Badge color="red" variant="solid" radius="full">{a.qtd}</Badge> : <Text size="1" color="gray">{a.qtd}</Text>}
            </Button>
          )
        })}
      </div>

      <LinhaFiltros ativos={[direcao, clienteFiltro, responsavelFiltro].filter(Boolean).length}>
        <div className="form-campo aj-filtros-busca">
          <label className="form-campo-label" htmlFor="fin-busca">Buscar</label>
          <TextField.Root id="fin-busca" type="search" placeholder="Descrição, cliente ou processo" autoComplete="off" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="fin-direcao-rotulo">Tipo</label>
          <Select.Root value={direcao || '__todos__'} onValueChange={v => setDirecao(v === '__todos__' ? '' : v as 'RECEITA' | 'DESPESA')}>
            <Select.Trigger aria-labelledby="fin-direcao-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Receitas e despesas</Select.Item>
              <Select.Item value="RECEITA">Só receitas</Select.Item>
              <Select.Item value="DESPESA">Só despesas</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="fin-cliente-rotulo">Cliente</label>
          <Select.Root value={clienteFiltro || '__todos__'} onValueChange={v => setClienteFiltro(v === '__todos__' ? '' : v)}>
            <Select.Trigger aria-labelledby="fin-cliente-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os clientes</Select.Item>
              {clientesComLancamento.map(c => <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.nome) || c.id}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="fin-resp-rotulo">Responsável</label>
          <Select.Root value={responsavelFiltro || '__todos__'} onValueChange={v => setResponsavelFiltro(v === '__todos__' ? '' : v)}>
            <Select.Trigger aria-labelledby="fin-resp-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Todos os responsáveis</Select.Item>
              {responsaveis.map(r => <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        {filtrosAtivos && <Button size="2" variant="soft" color="gray" onClick={() => { setDirecao(''); setClienteFiltro(''); setResponsavelFiltro(''); setBusca('') }}>Limpar filtros</Button>}
      </LinhaFiltros>
      {!estreita && <Flex justify="end" mt="-3"><EscolherColunas colunas={colunas} /></Flex>}

      {lote && (
        <div className="fin-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">{selecionados.size} selecionado(s)</Text>
          <Button size="1" disabled={operando} onClick={() => definirPago(visiveis.filter(l => selecionados.has(l.id) && !l.pago), true)}>Marcar como pagos/recebidos</Button>
          <Button size="1" variant="soft" color="gray" disabled={operando} onClick={() => definirPago(visiveis.filter(l => selecionados.has(l.id) && l.pago), false)}>Desfazer</Button>
          <Button size="1" variant="ghost" disabled={operando} onClick={() => setSelecionados(new Set())}>Cancelar</Button>
        </div>
      )}

      {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
      {!carregando && lancamentos && !visiveis.length && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>{lancamentos.length ? 'Nenhum lançamento neste período com estes filtros.' : 'Nenhum lançamento cadastrado.'}</Callout.Text>
        </Callout.Root>
      )}

      {!carregando && visiveis.length > 0 && (estreita ? (
        <ul className="fin-cartoes">
          {naPagina.map(l => (
            <li key={l.id} className="fin-cartao">
              <Flex align="center" gap="2" wrap="wrap">
                <Checkbox aria-label={`Selecionar ${l.descricao}`} checked={selecionados.has(l.id)} disabled={operando}
                  onCheckedChange={() => setSelecionados(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })} />
                <Text size="2" weight="bold">{dataCurta(l.vencimento)}</Text>
                <span className={relativoClasse(l)}>{relativo(l, hoje)}</span>
                <span style={{ marginLeft: 'auto' }}>{seloSituacao(l)}</span>
              </Flex>
              <div>{descricao(l)}</div>
              <Flex justify="between" align="end" gap="3">
                <Text size="2">{nomeCliente(l.cliente_id)}</Text>
                <div style={{ textAlign: 'right' }}>{valor(l)}</div>
              </Flex>
              <Flex gap="2" className="fin-cartao-acoes">{acaoPrincipal(l, true)}{menu(l)}</Flex>
            </li>
          ))}
        </ul>
      ) : (
        <TabelaResponsiva principais={['Descrição', 'Valor']}>
          <table aria-label={todosMeses ? 'Lançamentos de todos os meses' : `Lançamentos de ${rotuloMes(mes)}`} className="fin-tabela">
            <thead>
              <tr>
                <th className="tabela-controle">
                  <Checkbox aria-label="Selecionar todos os lançamentos visíveis" checked={todosSelecionados ? true : lote ? 'indeterminate' : false}
                    onCheckedChange={() => setSelecionados(todosSelecionados ? new Set() : new Set(naPagina.map(l => l.id)))} />
                </th>
                <th className="fin-col-venc" aria-sort={ariaSort('vencimento', ordem)}><BotaoOrdenar campo="vencimento" ordem={ordem} onOrdenar={alternarOrdem}>Vencimento</BotaoOrdenar></th>
                <th aria-sort={ariaSort('descricao', ordem)}><BotaoOrdenar campo="descricao" ordem={ordem} onOrdenar={alternarOrdem}>Descrição</BotaoOrdenar></th>
                {colunas.visivel('cliente') && <th className="fin-col-cliente" aria-sort={ariaSort('cliente', ordem)}><BotaoOrdenar campo="cliente" ordem={ordem} onOrdenar={alternarOrdem}>Cliente</BotaoOrdenar></th>}
                <th className="fin-col-valor" aria-sort={ariaSort('valor', ordem)}><BotaoOrdenar campo="valor" ordem={ordem} onOrdenar={alternarOrdem}>Valor</BotaoOrdenar></th>
                {colunas.visivel('situacao') && <th className="fin-col-situacao" aria-sort={ariaSort('situacao', ordem)}><BotaoOrdenar campo="situacao" ordem={ordem} onOrdenar={alternarOrdem}>Situação</BotaoOrdenar></th>}
                <th className="tabela-acoes fin-col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {naPagina.map(l => (
                <tr key={l.id} className={selecionados.has(l.id) ? 'fin-selecionado' : undefined}>
                  <td className="tabela-controle">
                    <Checkbox aria-label={`Selecionar ${l.descricao}`} checked={selecionados.has(l.id)} disabled={operando}
                      onCheckedChange={() => setSelecionados(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })} />
                  </td>
                  <td>
                    <div className="fin-data">{dataCurta(l.vencimento)}</div>
                    <div className={relativoClasse(l)}>{relativo(l, hoje)}</div>
                  </td>
                  <td>{descricao(l)}</td>
                  {colunas.visivel('cliente') && <td>{nomeCliente(l.cliente_id)}</td>}
                  <td className="fin-col-valor">{valor(l)}</td>
                  {colunas.visivel('situacao') && <td>
                    {seloSituacao(l)}
                    {l.asaas_cobranca_id && <div className="fin-secundario fin-cobranca">Cobrança gerada</div>}
                  </td>}
                  <td className="tabela-acoes"><Flex gap="1" justify="end" align="center">{acaoPrincipal(l)}{menu(l)}</Flex></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabelaResponsiva>
      ))}

      {!carregando && (
        <Paginacao pagina={pagina} total={visiveis.length} nome="lançamentos"
          onPagina={n => { setEstadoPagina({ chave: chavePagina, pagina: n }); document.getElementById('main-content')?.scrollTo({ top: 0 }) }} />
      )}

      {!carregando && visiveis.length > 0 && (
        <dl className="fin-totais" aria-label="Totais da lista">
          <div><dt>{visiveis.length} lançamento(s)</dt></div>
          <div><dt>Receitas</dt><dd className="fin-receita">+ {formatarMoeda(totais.receitas)}</dd></div>
          <div><dt>Despesas</dt><dd className="fin-despesa">− {formatarMoeda(totais.despesas)}</dd></div>
          <div><dt>Saldo previsto</dt><dd>{formatarMoeda(totais.saldo)}</dd></div>
        </dl>
      )}

      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir lançamento</AlertDialog.Title>
          <AlertDialog.Description>
            Excluir o lançamento "{paraExcluir?.descricao}"? Essa ação não pode ser desfeita.
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
      <NovoLancamentoModal
        open={modalNovoAberto}
        onClose={() => setModalNovoAberto(false)}
        onSalvo={() => {
          setModalNovoAberto(false)
          avisar({ texto: 'Lançamento criado.' })
          void carregar()
        }}
      />
    </Flex>
  )
}
