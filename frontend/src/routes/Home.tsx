import { useAvisos } from '../Avisos'
import CabecalhoPagina from '../CabecalhoPagina'
import { useCallback, useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from 'react'
import {
  Box, Button, Callout, Dialog, Flex, Heading,
  Select, Skeleton, Text,
} from '@radix-ui/themes'
import { AlertTriangle, Info, Plus, RefreshCw } from 'lucide-react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { buscarJson, enviarJson } from '../api/rest'
import AtividadeModal from './casos/AtividadeModal'
import { formatarDataSimples, formatarNomeExibicao } from '../utils/formatadores'
import {
  COLUNAS, TIPOS, chaveItem, colunaAtividade, diaLocal, noPeriodo, ordenarItens,
  type AtividadeHome, type ItemHome, type Periodo, type ProcessoHome, type StatusAtividade,
} from './home/dados'
import './home/home-radix.css'

const SEM_RESPONSAVEL = '__sem_responsavel__'

export default function Home() {
  const { cliente } = useCliente()
  return <PainelHome key={cliente?.token ?? 'sem-conexao'} />
}

function PainelHome() {
  const { cliente, status } = useCliente()
  const { irPara } = useNavegacao()
  const [itens, setItens] = useState<ItemHome[]>([])
  const [processos, setProcessos] = useState<ProcessoHome[]>([])
  const [publicacoes, setPublicacoes] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(Boolean(cliente))
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const { avisar } = useAvisos()
  const [executor, setExecutor] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [tipo, setTipo] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('')
  const [colunaMobile, setColunaMobile] = useState<StatusAtividade>('pendente')
  const [todasConcluidas, setTodasConcluidas] = useState(false)
  const [salvando, setSalvando] = useState<Set<string>>(new Set())
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [destinoArraste, setDestinoArraste] = useState<StatusAtividade | null>(null)
  const [escolhendoProcesso, setEscolhendoProcesso] = useState(false)
  const [processoNovo, setProcessoNovo] = useState('')
  const [criando, setCriando] = useState(false)
  const [agora, setAgora] = useState(() => new Date())
  const requisicao = useRef<AbortController | null>(null)
  const montado = useRef(true)
  const trava = useRef(new Set<string>())

  const carregar = useCallback(async () => {
    if (!cliente || trava.current.size) return
    requisicao.current?.abort()
    const controle = new AbortController()
    requisicao.current = controle
    const { signal } = controle
    setCarregando(true); setErro(''); setAviso('')
    setItens([]); setProcessos([]); setPublicacoes(null)
    const avisos: string[] = []
    const carregarPublicacoes = async () => {
      try {
        const dados = await buscarJson<{ total: number }>(cliente, '/publicacoes-oab?status=nao_tratada&pagina=1&tamanho=5', signal)
        if (!Number.isInteger(dados.total) || dados.total < 0) throw new Error('Total inválido')
        if (!signal.aborted) setPublicacoes(dados.total)
      } catch {
        if (!signal.aborted) avisos.push('Não foi possível consultar as publicações para revisar.')
      }
    }
    const carregarAtividades = async () => {
      // Duas chamadas fixas, independentes da quantidade de processos: a lista de processos
      // (para criar atividade e filtrar) e todas as atividades, já com o resumo do checklist.
      try {
        const [respProcessos, respAtividades] = await Promise.all([
          buscarJson<{ casos: ProcessoHome[] }>(cliente, '/casos', signal),
          buscarJson<{ atividades: (AtividadeHome & { caso: ProcessoHome; checklist?: ItemHome['checklist'] })[] }>(cliente, '/atividades?situacao=todas', signal),
        ])
        if (!Array.isArray(respProcessos.casos) || !Array.isArray(respAtividades.atividades)) throw new Error('Resposta inválida do servidor.')
        if (signal.aborted) return
        setProcessos(respProcessos.casos)
        const porId = new Map(respProcessos.casos.map(c => [c.id, c]))
        setItens(respAtividades.atividades.map(({ caso, checklist, ...atividade }) => ({
          processo: porId.get(caso.id) ?? caso,
          atividade,
          checklist: checklist ?? null,
        })))
      } catch (e) {
        if (!signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível carregar as atividades.')
      }
    }
    await Promise.all([carregarPublicacoes(), carregarAtividades()])
    if (!signal.aborted) { setAviso(avisos.join(' ')); setCarregando(false); setAgora(new Date()) }
  }, [cliente])

  useEffect(() => {
    montado.current = true
    void carregar()
    const relogio = window.setInterval(() => setAgora(new Date()), 60_000)
    return () => { montado.current = false; requisicao.current?.abort(); window.clearInterval(relogio) }
  }, [carregar])

  async function mover(item: ItemHome, novoStatus: StatusAtividade, desfazendo = false) {
    const chave = chaveItem(item)
    if (carregando || trava.current.has(chave) || item.atividade.status === novoStatus) return
    const anterior = colunaAtividade(item.atividade.status)
    trava.current.add(chave); setSalvando(new Set(trava.current))
    try {
      const atualizada = await enviarJson<AtividadeHome>(cliente, `/casos/${item.processo.id}/atividades/${item.atividade.id}`, { status: novoStatus }, 'PATCH')
      if (!montado.current) return
      setItens(atuais => atuais.map(i => chaveItem(i) === chave ? { ...i, atividade: atualizada } : i))
      if (!desfazendo) {
        avisar({
          texto: `“${item.atividade.titulo}” movida para ${COLUNAS.find(c => c.id === novoStatus)?.titulo}.`,
          desfazer: () => mover({ ...item, atividade: atualizada }, anterior, true),
        })
      }
    } catch (e) {
      if (montado.current) avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível alterar o status. Tente novamente.' })
    } finally {
      trava.current.delete(chave)
      if (montado.current) setSalvando(new Set(trava.current))
    }
  }

  function encerrarArraste() {
    setArrastando(null); setDestinoArraste(null)
  }

  // Arraste próprio (mouse e caneta): o card segue o cursor opaco — a imagem do arraste nativo do
  // navegador é sempre translúcida. No lugar do card fica um espaço reservado (.home-arrastando).
  function colunaSob(x: number, y: number) {
    const alvo = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-coluna]')
    return (alvo?.dataset.coluna as StatusAtividade | undefined) ?? null
  }
  function iniciarArraste(e: EventoPonteiro<HTMLElement>, item: ItemHome) {
    const chave = chaveItem(item)
    if (e.button !== 0 || e.pointerType === 'touch' || salvando.has(chave)) return
    if (e.target instanceof HTMLElement && e.target.closest('button, a, input, select, textarea, [role="combobox"]')) return
    e.preventDefault()
    const cartao = e.currentTarget
    const caixa = cartao.getBoundingClientRect()
    const inicio = { x: e.clientX, y: e.clientY, dx: e.clientX - caixa.left, dy: e.clientY - caixa.top }
    let flutuante: HTMLElement | null = null

    const mover_ = (ev: PointerEvent) => {
      if (!flutuante) {
        if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 5) return
        flutuante = cartao.cloneNode(true) as HTMLElement
        flutuante.classList.add('home-cartao-flutuante')
        flutuante.setAttribute('aria-hidden', 'true')
        flutuante.style.width = `${cartao.offsetWidth}px`
        ;(cartao.closest('.radix-themes') ?? document.body).appendChild(flutuante)
        document.body.classList.add('home-arrastando-cursor')
        setArrastando(chave)
      }
      flutuante.style.transform = `translate(${ev.clientX - inicio.dx}px, ${ev.clientY - inicio.dy}px)`
      setDestinoArraste(colunaSob(ev.clientX, ev.clientY))
    }
    const terminar = (destino: StatusAtividade | null) => {
      window.removeEventListener('pointermove', mover_)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', cancelar)
      window.removeEventListener('keydown', tecla)
      document.body.classList.remove('home-arrastando-cursor')
      const arrastou = flutuante !== null
      flutuante?.remove()
      encerrarArraste()
      if (arrastou && destino) void mover(item, destino)
    }
    const soltar = (ev: PointerEvent) => terminar(flutuante ? colunaSob(ev.clientX, ev.clientY) : null)
    const cancelar = () => terminar(null)
    const tecla = (ev: KeyboardEvent) => { if (ev.key === 'Escape') terminar(null) }
    window.addEventListener('pointermove', mover_)
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', cancelar)
    window.addEventListener('keydown', tecla)
  }
  function limparFiltros() { setExecutor(''); setResponsavel(''); setTipo(''); setPeriodo('') }

  const opcoesExecutor = [...new Set(itens.map(i => i.atividade.responsavel || SEM_RESPONSAVEL))].sort()
  const opcoesResponsavel = [...new Set(processos.map(p => p.responsavel || SEM_RESPONSAVEL))].sort()
  const base = itens.filter(({ processo, atividade }) =>
    (!executor || (atividade.responsavel || SEM_RESPONSAVEL) === executor) &&
    (!responsavel || (processo.responsavel || SEM_RESPONSAVEL) === responsavel) &&
    (!tipo || atividade.tipo === tipo)
  )
  const filtrados = base.filter(i => noPeriodo(i.atividade, periodo, agora)).sort(ordenarItens)
  const totais = (p: Periodo) => base.filter(i => noPeriodo(i.atividade, p, agora)).length
  const resumo = [
    { id: 'atrasadas' as const, titulo: 'Atrasadas', descricao: 'Requerem atenção', vazio: 'Nada atrasado' },
    { id: 'hoje' as const, titulo: 'Vencem hoje', descricao: 'Atividades para hoje', vazio: 'Nada para hoje' },
    { id: 'semana' as const, titulo: 'Próximos 7 dias', descricao: 'A partir de amanhã', vazio: 'Nada nos próximos dias' },
  ]
  const filtrosAtivos = Boolean(executor || responsavel || tipo || periodo)
  const semDados = carregando || Boolean(erro && !itens.length)

  return (
    <div className="home">
      {/* Cabeçalho */}
      <CabecalhoPagina
        sobretitulo={agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        titulo="Meu dia"
        descricao="Organize as atividades e acompanhe os próximos vencimentos."
        acoes={<Button
          size="2"
          disabled={!cliente || carregando || salvando.size > 0}
          onClick={() => { setProcessoNovo(''); setEscolhendoProcesso(true) }}
        >
          <Plus size={16} />
          Nova atividade
        </Button>}
      />

      {!cliente ? (
        <Box>
          <Callout.Root color={status === 'verificando' ? 'blue' : 'gray'} mb="3">
            <Callout.Icon><Info size={16} /></Callout.Icon>
            <Callout.Text>
              {status === 'verificando' ? 'Verificando acesso…' : 'Conecte-se para ver seu dia'}{' '}
              As atividades e publicações do escritório aparecem aqui após a conexão.
            </Callout.Text>
          </Callout.Root>
          <Button variant="soft" size="2" onClick={() => irPara('acesso')}>Ir para Acesso</Button>
        </Box>
      ) : (
        <>
          {/* Métricas */}
          <div className="home-resumo">
            {resumo.map(r => (
              <button
                key={r.id}
                // Zero em cor neutra: o vermelho de "Atrasadas" só aparece quando há atraso.
                className={`home-metrica home-metrica-${r.id}${!semDados && totais(r.id) === 0 ? ' home-metrica--zero' : ''}`}
                aria-pressed={periodo === r.id}
                disabled={semDados}
                onClick={() => { setPeriodo(periodo === r.id ? '' : r.id); setColunaMobile('pendente') }}
              >
                <span className="home-metrica-titulo">{r.titulo}</span>
                <strong className="home-metrica-num">
                  {semDados ? '—' : totais(r.id)}
                </strong>
                <small className="home-metrica-desc">{!semDados && totais(r.id) === 0 ? r.vazio : r.descricao}</small>
              </button>
            ))}
            <button
              className={`home-metrica home-metrica-publicacoes${publicacoes === 0 ? ' home-metrica--zero' : ''}`}
              onClick={() => irPara('publicacoes-oab', { status: 'nao_tratada' })}
            >
              <span className="home-metrica-titulo">Publicações para revisar</span>
              <strong className="home-metrica-num">{publicacoes ?? '—'}</strong>
              <small className="home-metrica-desc">
                {publicacoes === null && !carregando ? 'Contagem indisponível · acessar triagem' : publicacoes === 0 ? 'Nenhuma para revisar' : 'Acessar triagem'}
              </small>
            </button>
          </div>

          {/* Título do quadro + Atualizar */}
          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Heading size="4" as="h2">Quadro de atividades</Heading>
            <Flex align="center" gap="3">
              <Text size="1" color="gray">{filtrados.length} atividade(s) no quadro</Text>
              <Button
                variant="soft"
                color="gray"
                size="2"
                disabled={carregando || salvando.size > 0}
                onClick={() => void carregar()}
              >
                <RefreshCw size={14} />
                Atualizar
              </Button>
            </Flex>
          </Flex>
          <Text as="p" size="1" color="gray" mt="-3">
            Arraste os cartões ou use "Alterar status". Datas conforme cadastro, sem cálculo de prazo.
          </Text>

          {/* Filtros */}
          <div className="home-filtros">
            <FiltroSelect
              label="Executor"
              value={executor}
              onValueChange={setExecutor}
              disabled={carregando}
              placeholder="Todos os executores"
              opcoes={opcoesExecutor.map(o => ({
                value: o,
                label: o === SEM_RESPONSAVEL ? 'Sem responsável' : formatarNomeExibicao(o),
              }))}
            />
            <FiltroSelect
              label="Responsável pelo processo"
              value={responsavel}
              onValueChange={setResponsavel}
              disabled={carregando}
              placeholder="Todos os responsáveis"
              opcoes={opcoesResponsavel.map(o => ({
                value: o,
                label: o === SEM_RESPONSAVEL ? 'Sem responsável' : formatarNomeExibicao(o),
              }))}
            />
            <FiltroSelect
              label="Tipo"
              value={tipo}
              onValueChange={setTipo}
              disabled={carregando}
              placeholder="Todos os tipos"
              opcoes={Object.entries(TIPOS).map(([id, titulo]) => ({ value: id, label: titulo }))}
            />
            <FiltroSelect
              label="Período"
              value={periodo}
              onValueChange={v => setPeriodo(v as Periodo)}
              disabled={carregando}
              placeholder="Todos os períodos"
              opcoes={resumo.map(r => ({ value: r.id, label: r.titulo }))}
            />
            {filtrosAtivos && (
              <Flex align="end">
                <Button variant="soft" color="gray" size="2" onClick={limparFiltros}>Limpar filtros</Button>
              </Flex>
            )}
          </div>

          {/* Notificações */}
          {erro && (
            <Callout.Root color="red">
              <Callout.Icon><AlertTriangle size={16} /></Callout.Icon>
              <Callout.Text>
                <strong>Não foi possível concluir a operação.</strong>{' '}
                {erro} Use Atualizar para consultar novamente.
              </Callout.Text>
            </Callout.Root>
          )}
          {aviso && (
            <Callout.Root color="yellow">
              <Callout.Icon><AlertTriangle size={16} /></Callout.Icon>
              <Callout.Text>
                <strong>Painel parcialmente carregado.</strong>{' '}
                {aviso} Os números consideram apenas os dados disponíveis. Use Atualizar para tentar novamente.
              </Callout.Text>
            </Callout.Root>
          )}

          {/* Seletor de coluna (mobile) */}
          <Box className="home-seletor-mobile">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" weight="medium" color="gray">Coluna do quadro</Text>
              <Select.Root value={colunaMobile} onValueChange={v => setColunaMobile(v as StatusAtividade)}>
                <Select.Trigger />
                <Select.Content>
                  {COLUNAS.map(c => (
                    <Select.Item key={c.id} value={c.id}>
                      {`${c.titulo} (${filtrados.filter(i => colunaAtividade(i.atividade.status) === c.id).length})`}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          </Box>

          {/* Skeleton */}
          {carregando && (
            <div className="home-skeleton-grid">
              {COLUNAS.map(c => (
                <div key={c.id} className="home-skeleton-col">
                  <Skeleton height="12px" width="60%" mb="2" />
                  {[0, 1, 2].map(i => <Skeleton key={i} height="90px" mb="2" />)}
                </div>
              ))}
            </div>
          )}

          {/* Quadro kanban */}
          {!carregando && (
            <div className="home-quadro">
              {COLUNAS.map(coluna => {
                const todos = filtrados.filter(i => colunaAtividade(i.atividade.status) === coluna.id)
                const visiveis = coluna.id === 'concluida' && !todasConcluidas ? todos.slice(0, 10) : todos
                return (
                  <section
                    key={coluna.id}
                    aria-labelledby={`home-coluna-${coluna.id}`}
                    className={[
                      'home-coluna',
                      `home-coluna-${coluna.id}`,
                      destinoArraste === coluna.id ? 'home-destino' : '',
                      colunaMobile === coluna.id ? 'home-coluna-ativa' : '',
                    ].filter(Boolean).join(' ')}
                    data-coluna={coluna.id}
                  >
                    <div className="home-coluna-titulo">
                      <Heading as="h3" size="2" id={`home-coluna-${coluna.id}`}>{coluna.titulo}</Heading>
                      <span className="home-coluna-titulo-count">{todos.length}</span>
                    </div>

                    {visiveis.map(item => {
                      const { atividade, processo, checklist } = item
                      const chave = chaveItem(item)
                      const atrasada = noPeriodo(atividade, 'atrasadas', agora)
                      return (
                        <article
                          key={chave}
                          className={`home-cartao${arrastando === chave ? ' home-arrastando' : ''}`}
                          aria-busy={salvando.has(chave)}
                          onPointerDown={e => iniciarArraste(e, item)}
                        >
                          <p className="home-tipo">{TIPOS[atividade.tipo] || atividade.tipo}</p>
                          <h4>
                            <button
                              className="home-abrir-atividade"
                              onClick={() => irPara('casos', { id: processo.id, aba: 'atividades', atividadeId: atividade.id })}
                            >
                              {atividade.titulo}
                            </button>
                          </h4>
                          <button
                            className="home-processo-btn"
                            onClick={() => irPara('casos', { id: processo.id })}
                          >
                            {processo.titulo || 'Processo sem título'}
                          </button>
                          <p className="home-executor-text">
                            {atividade.responsavel ? formatarNomeExibicao(atividade.responsavel) : 'Sem responsável'}
                          </p>
                          <div className="home-cartao-meta">
                            <span className={atrasada ? 'home-atrasada' : ''}>
                              {atrasada ? 'Atrasada · ' : atividade.data === diaLocal(agora) ? 'Hoje · ' : ''}
                              {atividade.data ? formatarDataSimples(atividade.data) : 'Sem data'}
                              {atividade.hora ? ` · ${atividade.hora}` : ''}
                            </span>
                            {checklist && <span>Checklist {checklist.concluidos}/{checklist.total}</span>}
                          </div>
                          <Select.Root
                            size="1"
                            value={COLUNAS.some(c => c.id === atividade.status) ? atividade.status : COLUNAS[0].id}
                            disabled={salvando.has(chave)}
                            onValueChange={v => void mover(item, v as StatusAtividade)}
                          >
                            <Select.Trigger aria-label={`Alterar status: ${atividade.titulo}`} />
                            <Select.Content>
                              {COLUNAS.map(c => (
                                <Select.Item key={c.id} value={c.id}>{c.titulo}</Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                          {salvando.has(chave) && (
                            <Text as="p" size="1" color="gray" role="status">Salvando…</Text>
                          )}
                        </article>
                      )
                    })}

                    {!todos.length && (
                      <div className="home-coluna-vazia">
                        {erro && !itens.length ? (
                          <p>Não foi possível carregar as atividades.</p>
                        ) : filtrosAtivos ? (
                          <>
                            <p>Nenhuma atividade com estes filtros.</p>
                            <Button variant="ghost" size="1" onClick={limparFiltros}>Limpar filtros</Button>
                          </>
                        ) : coluna.id === 'pendente' ? (
                          <>
                            <p>Nenhuma atividade a fazer.</p>
                            <Button variant="ghost" size="1" disabled={!cliente || salvando.size > 0}
                              onClick={() => { setProcessoNovo(''); setEscolhendoProcesso(true) }}>Nova atividade</Button>
                          </>
                        ) : (
                          <p>Nenhuma atividade aqui.</p>
                        )}
                      </div>
                    )}
                    {coluna.id === 'concluida' && todos.length > 10 && (
                      <Button variant="ghost" size="1" onClick={() => setTodasConcluidas(!todasConcluidas)}>
                        {todasConcluidas ? 'Exibir até 10' : `Ver todas (${todos.length})`}
                      </Button>
                    )}
                  </section>
                )
              })}
            </div>
          )}

          {/* Rodapé publicações */}
          <div className="home-publicacoes">
            <Text size="2">
              {publicacoes === null
                ? 'Consulte as publicações para revisar na triagem.'
                : `${publicacoes} publicação(ões) aguardam revisão.`}{' '}
              A vinculação ao processo não conclui a triagem.
            </Text>
            <Button variant="ghost" size="2" onClick={() => irPara('publicacoes-oab', { status: 'nao_tratada' })}>
              Revisar publicações
            </Button>
          </div>
        </>
      )}

      {/* Dialog: selecionar processo para nova atividade */}
      <Dialog.Root open={escolhendoProcesso} onOpenChange={v => { if (!v) setEscolhendoProcesso(false) }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Nova atividade: selecionar processo</Dialog.Title>
          {processos.length ? (
            <Box mt="3">
              <FiltroSelect
                label="Processo"
                value={processoNovo}
                onValueChange={setProcessoNovo}
                disabled={false}
                placeholder="Selecione um processo"
                opcoes={processos.map(p => ({ value: p.id, label: p.titulo || 'Processo sem título' }))}
              />
            </Box>
          ) : (
            <Box mt="3">
              <Text as="p" size="2" color="gray" mb="3">
                Cadastre um processo para associar a nova atividade.
              </Text>
              <Button variant="soft" size="2" onClick={() => { setEscolhendoProcesso(false); irPara('casos') }}>
                Ir para processos
              </Button>
            </Box>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">Cancelar</Button>
            </Dialog.Close>
            <Button
              disabled={!processoNovo}
              onClick={() => { if (processoNovo) { setEscolhendoProcesso(false); setCriando(true) } }}
            >
              Continuar
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {criando && processoNovo && (
        <AtividadeModal
          open
          casoId={processoNovo}
          atividade={null}
          onClose={() => setCriando(false)}
          onSalva={() => { setCriando(false); void carregar() }}
        />
      )}
    </div>
  )
}

function FiltroSelect({
  label,
  value,
  onValueChange,
  disabled,
  placeholder,
  opcoes,
}: {
  label: string
  value: string
  onValueChange: (v: string) => void
  disabled: boolean
  placeholder: string
  opcoes: { value: string; label: string }[]
}) {
  const ALL = '__all__'
  return (
    <Flex direction="column" gap="1">
      <Text as="label" size="1" weight="medium" color="gray">{label}</Text>
      <Select.Root
        value={value || ALL}
        onValueChange={v => onValueChange(v === ALL ? '' : v)}
        disabled={disabled}
      >
        <Select.Trigger />
        <Select.Content>
          <Select.Item value={ALL}>{placeholder}</Select.Item>
          {opcoes.map(o => (
            <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  )
}
