import { useAvisos } from '../../Avisos'
import CabecalhoPagina from '../../CabecalhoPagina'
import CampoData from '../../CampoData'
import TabelaResponsiva from '../../TabelaResponsiva'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { Fragment, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { Archive, Check, ChevronDown, ChevronRight, Info, Unlink } from 'lucide-react'
import { Badge, Button, Callout, Checkbox, Dialog, Flex, IconButton, Popover, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { useNavegacao } from '../../api/NavegacaoContext'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import {
  advogadosPublicacao, CHAVE_COLUNAS, COLUNAS_OPCIONAIS, COR_STATUS, corTipo, dataCaptura, dataCapturaCurta, dataDivulgacao, lerPreferencias,
  nomePublicacao, numeroPublicacao, orgaoPublicacao, ROTULO_STATUS, urlPublicacao, type ContagemStatus, type PublicacaoOab,
} from './dados'
import ProcessoPublicacao from './ProcessoPublicacao'
import AtividadePublicacao from './AtividadePublicacao'
import './publicacoes.scss'

type Status = PublicacaoOab['status']
type RespostaLista = {
  publicacoes: PublicacaoOab[]; total: number; pagina: number
  hashes_disponiveis?: string[]; contagem_status?: ContagemStatus; tipos_disponiveis?: string[]
}
type ResultadoStatus = { hashes_atualizados: string[]; hashes_falharam: string[] }
type Periodo = '' | 'hoje' | '7' | '30' | 'personalizado'

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
export default function PainelPublicacoes({ Captura }: { Captura: ComponentType<{ onCapturado: () => void }> }) {
  const { cliente } = useCliente(), { irPara, consumirPayload, versaoNavegacao } = useNavegacao()
  const estreita = useEstreita()
  const [status, setStatus] = useState<Status | ''>('nao_tratada')
  const [tipo, setTipo] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('')
  const [desde, setDesde] = useState(''), [ate, setAte] = useState('')
  const [textoBusca, setTextoBusca] = useState(''), [busca, setBusca] = useState('')
  const [ordemAsc, setOrdemAsc] = useState(false)
  const [pagina, setPagina] = useState(1), [tamanho, setTamanho] = useState(20)
  useEffect(() => {
    const destino = consumirPayload<{ status?: string }>('publicacoes-oab')
    if (destino?.status === 'nao_tratada') { setStatus('nao_tratada'); setPagina(1) }
  }, [consumirPayload, versaoNavegacao])
  useEffect(() => {
    const espera = window.setTimeout(() => { setBusca(textoBusca.trim()); setPagina(1) }, 400)
    return () => window.clearTimeout(espera)
  }, [textoBusca])

  const [publicacoes, setPublicacoes] = useState<PublicacaoOab[]>([]), [total, setTotal] = useState(0)
  const [contagem, setContagem] = useState<ContagemStatus | null>(null), [tipos, setTipos] = useState<string[]>([])
  const [preferencias, setPreferencias] = useState(lerPreferencias)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set()), [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true), [operacao, setOperacao] = useState(false)
  const [erro, setErro] = useState('')
  const { avisar } = useAvisos()
  const [modal, setModal] = useState<{ tipo: 'processo' | 'atividade'; p: PublicacaoOab } | null>(null)
  const [capturaAberta, setCapturaAberta] = useState(false)
  const trava = useRef(false), sequencia = useRef(0)
  const opcionais = COLUNAS_OPCIONAIS.filter(c => preferencias.includes(c.key))
  const { desde: filtroDesde, ate: filtroAte } = intervalo(periodo, desde, ate)

  const carregar = useCallback(async () => {
    const pedido = ++sequencia.current
    if (!cliente) { setCarregando(false); return }
    setCarregando(true); setErro('')
    try {
      const query = new URLSearchParams({
        pagina: String(pagina), tamanho: String(tamanho), ordem: ordemAsc ? 'divulgado_asc' : 'divulgado_desc',
        ...(status ? { status } : {}), ...(tipo ? { tipo } : {}), ...(busca ? { busca } : {}),
        ...(filtroDesde ? { desde: filtroDesde } : {}), ...(filtroAte ? { ate: filtroAte } : {}),
      })
      const dados = await buscarJson<RespostaLista>(cliente, `/publicacoes-oab?${query}`)
      if (pedido !== sequencia.current) return
      setPublicacoes(dados.publicacoes ?? []); setTotal(dados.total ?? 0)
      if (dados.contagem_status) setContagem(dados.contagem_status)
      if (dados.tipos_disponiveis) setTipos(dados.tipos_disponiveis)
      if (dados.pagina && dados.pagina !== pagina) setPagina(dados.pagina)
      if (dados.hashes_disponiveis) {
        const disponiveis = new Set(dados.hashes_disponiveis)
        setSelecionadas(s => new Set([...s].filter(id => disponiveis.has(id))))
        setExpandidas(s => new Set([...s].filter(id => disponiveis.has(id))))
      }
    } catch (e) { if (pedido === sequencia.current) setErro((e as Error).message) }
    finally { if (pedido === sequencia.current) setCarregando(false) }
  }, [cliente, pagina, tamanho, status, tipo, busca, filtroDesde, filtroAte, ordemAsc])
  useEffect(() => {
    // The request synchronizes the list with the server; invalidate it on cleanup.
    const controle = sequencia
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
    return () => { controle.current++ }
  }, [carregar])

  const ocupada = carregando || operacao || modal !== null
  const lote = selecionadas.size > 0
  const todasPagina = publicacoes.length > 0 && publicacoes.every(p => selecionadas.has(p.hash))
  const algumasPagina = publicacoes.some(p => selecionadas.has(p.hash)) && !todasPagina
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho))
  const primeira = total ? (pagina - 1) * tamanho + 1 : 0, ultima = Math.min(total, pagina * tamanho)
  const filtrosAtivos = Boolean(tipo || periodo || busca)

  function filtrar(acao: () => void) {
    if (ocupada) return
    acao(); setPagina(1); setSelecionadas(new Set())
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

  /** Próxima ação provável da publicação, exibida como botão visível. */
  function acaoPrincipal(p: PublicacaoOab, largura = false) {
    const bloqueada = ocupada || lote
    const estilo = largura ? { flex: 1 } : undefined
    if (p.status !== 'nao_tratada') {
      return <Button size={largura ? '3' : '1'} variant="soft" color="gray" style={estilo} disabled={bloqueada} onClick={() => mudarStatus([p.hash], 'nao_tratada')}>Reabrir</Button>
    }
    if (!p.caso_id) {
      return <Button size={largura ? '3' : '1'} style={estilo} disabled={bloqueada || numeroPublicacao(p).length !== 20} onClick={() => abrirAcao('processo', p)}>Vincular processo</Button>
    }
    return <Button size={largura ? '3' : '1'} style={estilo} disabled={bloqueada} onClick={() => abrirAcao('atividade', p)}>Criar atividade</Button>
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
  const seloStatus = (p: PublicacaoOab) => <Badge color={COR_STATUS[p.status]} variant="soft" radius="full">{ROTULO_STATUS[p.status]}</Badge>

  return (
    <Flex direction="column" gap="5" className="oab-painel">
      <CabecalhoPagina
        titulo="Publicações recebidas"
        descricao="Revise as publicações capturadas pelos monitoramentos por OAB."
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
          <Button variant="soft" size="2" disabled={ocupada || lote} onClick={() => setCapturaAberta(true)}>Capturar por OAB</Button>
          <Button variant="soft" color="gray" size="2" disabled={ocupada} onClick={carregar}>Atualizar</Button>
        </>}
      />

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
      </div>

      <div className="aj-filtros-linha">
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
      </div>

      {lote && (
        <div className="oab-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">{selecionadas.size} selecionada(s)</Text>
          <Button size="1" disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'tratada', true)}><Check size={14} /> Marcar como tratadas</Button>
          <Button size="1" variant="soft" color="gray" disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'arquivada', true)}><Archive size={14} /> Arquivar</Button>
          <Button size="1" variant="ghost" disabled={operacao} onClick={() => setSelecionadas(new Set())}>Cancelar</Button>
        </div>
      )}

      <section aria-label="Lista de publicações" aria-busy={carregando || operacao}>
        {estreita ? (
          <ul className="oab-cartoes">
            {publicacoes.map(p => {
              const aberta = expandidas.has(p.hash)
              return (
                <li key={p.hash} className="oab-cartao">
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
          <TabelaResponsiva principais={['Processo', 'Situação']}>
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
                  <th className="oab-col-situacao">Situação</th>
                  <th className="tabela-acoes oab-col-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {publicacoes.map(p => {
                  const aberta = expandidas.has(p.hash)
                  return (
                    <Fragment key={p.hash}>
                      <tr className={selecionadas.has(p.hash) ? 'oab-linha-selecionada' : undefined}>
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
                        <td>{nomePublicacao(p)}</td>
                        {opcionais.map(c => <td key={c.key}>{c.valor(p)}</td>)}
                        <td>{seloTipo(p)}</td>
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
                          <td colSpan={8 + opcionais.length} className="oab-detalhes-celula">{detalhes(p)}</td>
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
    </Flex>
  )
}
