import CabecalhoPagina from '../CabecalhoPagina'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [mensagem, setMensagem] = useState('')
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
  const itemArrastado = useRef<string | null>(null)

  const carregar = useCallback(async () => {
    if (!cliente || trava.current.size) return
    requisicao.current?.abort()
    const controle = new AbortController()
    requisicao.current = controle
    const { signal } = controle
    setCarregando(true); setErro(''); setAviso(''); setMensagem('')
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
      try {
        const dados = await buscarJson<{ casos: ProcessoHome[] }>(cliente, '/casos', signal)
        if (!Array.isArray(dados.casos)) throw new Error('Resposta de processos inválida.')
        if (signal.aborted) return
        setProcessos(dados.casos)
        const resultados: ItemHome[] = []
        const falhas: string[] = []
        let indice = 0, falhasChecklist = 0
        await Promise.all(Array.from({ length: Math.min(4, dados.casos.length) }, async () => {
          while (indice < dados.casos.length && !signal.aborted) {
            const processo = dados.casos[indice++]
            try {
              const resposta = await buscarJson<{ atividades: AtividadeHome[] }>(cliente, `/casos/${processo.id}/atividades`, signal)
              if (!Array.isArray(resposta.atividades)) throw new Error('Resposta de atividades inválida.')
              for (const atividade of resposta.atividades) {
                if (signal.aborted) return
                let checklist: ItemHome['checklist'] = null
                try {
                  const respostaChecklist = await buscarJson<{ itens: { concluido: boolean }[] }>(cliente, `/casos/${processo.id}/atividades/${atividade.id}/checklist`, signal)
                  if (!Array.isArray(respostaChecklist.itens)) throw new Error('Checklist inválido')
                  checklist = { total: respostaChecklist.itens.length, concluidos: respostaChecklist.itens.filter(i => i.concluido).length }
                } catch { if (!signal.aborted) falhasChecklist++ }
                resultados.push({ processo, atividade, checklist })
              }
            } catch { if (!signal.aborted) falhas.push(processo.titulo || 'Processo sem título') }
          }
        }))
        if (signal.aborted) return
        setItens(resultados)
        if (falhas.length) avisos.push(`Atividades indisponíveis em ${falhas.length} processo(s): ${falhas.join(', ')}.`)
        if (falhasChecklist) avisos.push(`${falhasChecklist} checklist(s) indisponível(is).`)
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

  async function mover(item: ItemHome, novoStatus: StatusAtividade) {
    const chave = chaveItem(item)
    if (carregando || trava.current.has(chave) || item.atividade.status === novoStatus) return
    trava.current.add(chave); setSalvando(new Set(trava.current)); setErro(''); setMensagem('')
    try {
      const atualizada = await enviarJson<AtividadeHome>(cliente, `/casos/${item.processo.id}/atividades/${item.atividade.id}`, { status: novoStatus }, 'PATCH')
      if (!montado.current) return
      setItens(atuais => atuais.map(i => chaveItem(i) === chave ? { ...i, atividade: atualizada } : i))
      setMensagem(`${item.atividade.titulo}: movida para ${COLUNAS.find(c => c.id === novoStatus)?.titulo}.`)
    } catch (e) {
      if (montado.current) setErro(e instanceof Error ? e.message : 'Não foi possível alterar o status. Tente novamente.')
    } finally {
      trava.current.delete(chave)
      if (montado.current) setSalvando(new Set(trava.current))
    }
  }

  function encerrarArraste() {
    itemArrastado.current = null; setArrastando(null); setDestinoArraste(null)
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
    { id: 'atrasadas' as const, titulo: 'Atrasadas', descricao: 'Requerem atenção' },
    { id: 'hoje' as const, titulo: 'Vencem hoje', descricao: 'Atividades para hoje' },
    { id: 'semana' as const, titulo: 'Próximos 7 dias', descricao: 'A partir de amanhã' },
  ]

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
                className={`home-metrica home-metrica-${r.id}`}
                aria-pressed={periodo === r.id}
                disabled={carregando || Boolean(erro && !itens.length)}
                onClick={() => { setPeriodo(periodo === r.id ? '' : r.id); setColunaMobile('pendente') }}
              >
                <span className="home-metrica-titulo">{r.titulo}</span>
                <strong className="home-metrica-num">
                  {carregando || (erro && !itens.length) ? '—' : totais(r.id)}
                </strong>
                <small className="home-metrica-desc">{r.descricao}</small>
              </button>
            ))}
            <button
              className="home-metrica home-metrica-publicacoes"
              onClick={() => irPara('publicacoes-oab', { status: 'nao_tratada' })}
            >
              <span className="home-metrica-titulo">Publicações para revisar</span>
              <strong className="home-metrica-num">{publicacoes ?? '—'}</strong>
              <small className="home-metrica-desc">
                {publicacoes === null && !carregando ? 'Contagem indisponível · acessar triagem' : 'Acessar triagem'}
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
            <Flex align="end">
              <Button variant="soft" color="gray" size="2" onClick={limparFiltros}>Limpar filtros</Button>
            </Flex>
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
          <Text as="p" size="2" role="status" className="home-status">{mensagem}</Text>

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
                    onDragOver={e => {
                      if (itemArrastado.current) {
                        e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDestinoArraste(coluna.id)
                      }
                    }}
                    onDrop={e => {
                      e.preventDefault()
                      const item = itens.find(i => chaveItem(i) === itemArrastado.current)
                      encerrarArraste()
                      if (item) void mover(item, coluna.id)
                    }}
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
                          draggable={!salvando.has(chave)}
                          onDragStart={e => {
                            if (salvando.has(chave) || (e.target instanceof HTMLElement && e.target.closest('button, [role="combobox"], a'))) {
                              e.preventDefault(); return
                            }
                            itemArrastado.current = chave
                            // Só vira espaço reservado depois que o navegador captura a imagem do card.
                            requestAnimationFrame(() => { if (itemArrastado.current === chave) setArrastando(chave) })
                            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', chave)
                          }}
                          onDragEnd={encerrarArraste}
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
                            <span>
                              {checklist
                                ? `Checklist ${checklist.concluidos}/${checklist.total}`
                                : 'Checklist indisponível'}
                            </span>
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
                      <p className="home-coluna-vazia">
                        {erro
                          ? 'Dados indisponíveis ou nenhum item carregado.'
                          : 'Nenhuma atividade com os filtros atuais.'}
                      </p>
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
