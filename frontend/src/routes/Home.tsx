import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Column, Grid, InlineNotification, Modal, Select, SelectItem } from '@carbon/react'
import { Add } from '@carbon/icons-react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { buscarJson, enviarJson } from '../api/rest'
import Carregamento from '../Carregamento'
import AtividadeModal from './casos/AtividadeModal'
import { formatarDataSimples, formatarNomeExibicao } from '../utils/formatadores'
import { COLUNAS, TIPOS, chaveItem, colunaAtividade, diaLocal, noPeriodo, ordenarItens, type AtividadeHome, type ItemHome, type Periodo, type ProcessoHome, type StatusAtividade } from './home/dados'
import './home/home.scss'

const SEM_RESPONSAVEL = '__sem_responsavel__'

// Remonta o painel ao trocar de conexão para não reaproveitar dados de outro usuário.
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
    // Publicações e atividades têm falhas independentes; um erro não esconde o outro painel.
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
        // Limita também as consultas de checklist a quatro requisições simultâneas.
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
    (!responsavel || (processo.responsavel || SEM_RESPONSAVEL) === responsavel) && (!tipo || atividade.tipo === tipo))
  const filtrados = base.filter(i => noPeriodo(i.atividade, periodo, agora)).sort(ordenarItens)
  const totais = (p: Periodo) => base.filter(i => noPeriodo(i.atividade, p, agora)).length
  const resumo = [
    { id: 'atrasadas' as const, titulo: 'Atrasadas', descricao: 'Requerem atenção' },
    { id: 'hoje' as const, titulo: 'Vencem hoje', descricao: 'Atividades para hoje' },
    { id: 'semana' as const, titulo: 'Próximos 7 dias', descricao: 'A partir de amanhã' },
  ]

  return <div className="home">
    <Grid narrow fullWidth className="home-grupo">
      <Column sm={4} md={8} lg={16}>
        <div className="home-cabecalho">
          <div><p className="home-data">{agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>Meu dia</h1><p className="home-subtitulo">Organize as atividades e acompanhe os próximos vencimentos.</p></div>
          <Button kind="primary" size="lg" renderIcon={Add} disabled={!cliente || carregando || salvando.size > 0} onClick={() => { setProcessoNovo(''); setEscolhendoProcesso(true) }}>Nova atividade</Button>
        </div>
      </Column>
    </Grid>
    {!cliente ? <Grid narrow fullWidth>
      <Column sm={4} md={8} lg={16}>
      <InlineNotification kind="info" title={status === 'verificando' ? 'Verificando acesso…' : 'Conecte-se para ver seu dia'} subtitle="As atividades e publicações do escritório aparecem aqui após a conexão." hideCloseButton lowContrast />
      <Button kind="tertiary" size="lg" onClick={() => irPara('acesso')}>Ir para Acesso</Button>
    </Column>
      </Grid> : <>
      <Grid narrow fullWidth className="home-grupo home-resumo">
        {resumo.map(r => <Column key={r.id} sm={2} md={4} lg={4}>
          <button className={`home-metrica home-metrica-${r.id}`} aria-pressed={periodo === r.id} disabled={carregando || Boolean(erro && !itens.length)} onClick={() => { setPeriodo(periodo === r.id ? '' : r.id); setColunaMobile('pendente') }}>
            <span>{r.titulo}</span><strong>{carregando || (erro && !itens.length) ? '—' : totais(r.id)}</strong><small>{r.descricao}</small>
          </button>
        </Column>)}
        <Column sm={2} md={4} lg={4}><button className="home-metrica home-metrica-publicacoes" onClick={() => irPara('publicacoes-oab', { status: 'nao_tratada' })}>
          <span>Publicações para revisar</span><strong>{publicacoes ?? '—'}</strong><small>{publicacoes === null && !carregando ? 'Contagem indisponível · acessar triagem' : 'Acessar triagem'}</small>
        </button></Column>
      </Grid>
      <Grid narrow fullWidth className="home-grupo">
        <Column sm={4} md={8} lg={16}>
        <div className="home-titulo-quadro"><h2>Quadro de atividades</h2><div><span>{filtrados.length} atividade(s) no quadro</span><Button kind="ghost" size="sm" disabled={carregando || salvando.size > 0} onClick={() => void carregar()}>Atualizar</Button></div></div>
        <p className="home-ajuda">Arraste os cartões ou use “Alterar status”. Datas conforme cadastro, sem cálculo de prazo.</p>
      </Column>
      </Grid>
      <Grid narrow fullWidth className="home-grupo home-filtros">
        <Column sm={4} md={4} lg={4}><Select id="home-executor" labelText="Executor" value={executor} onChange={e => setExecutor(e.target.value)} disabled={carregando}>
          <SelectItem value="" text="Todos os executores" />{opcoesExecutor.map(o => <SelectItem key={o} value={o} text={o === SEM_RESPONSAVEL ? 'Sem responsável' : formatarNomeExibicao(o)} />)}
        </Select></Column>
        <Column sm={4} md={4} lg={4}><Select id="home-responsavel" labelText="Responsável pelo processo" value={responsavel} onChange={e => setResponsavel(e.target.value)} disabled={carregando}>
          <SelectItem value="" text="Todos os responsáveis" />{opcoesResponsavel.map(o => <SelectItem key={o} value={o} text={o === SEM_RESPONSAVEL ? 'Sem responsável' : formatarNomeExibicao(o)} />)}
        </Select></Column>
        <Column sm={2} md={4} lg={3}><Select id="home-tipo" labelText="Tipo" value={tipo} onChange={e => setTipo(e.target.value)} disabled={carregando}>
          <SelectItem value="" text="Todos os tipos" />{Object.entries(TIPOS).map(([id, titulo]) => <SelectItem key={id} value={id} text={titulo} />)}
        </Select></Column>
        <Column sm={2} md={4} lg={3}><Select id="home-periodo" labelText="Período" value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)} disabled={carregando}>
          <SelectItem value="" text="Todos os períodos" />{resumo.map(r => <SelectItem key={r.id} value={r.id} text={r.titulo} />)}
        </Select></Column>
        <Column sm={4} md={8} lg={2}><Button kind="ghost" size="md" onClick={limparFiltros}>Limpar filtros</Button></Column>
      </Grid>
      <Grid narrow fullWidth className="home-grupo">
        <Column sm={4} md={8} lg={16}>
        {erro && <InlineNotification kind="error" title="Não foi possível concluir a operação" subtitle={`${erro} Use Atualizar para consultar novamente.`} hideCloseButton lowContrast />}
        {aviso && <InlineNotification kind="warning" title="Painel parcialmente carregado" subtitle={`${aviso} Os números consideram apenas os dados disponíveis. Use Atualizar para tentar novamente.`} hideCloseButton lowContrast />}
        <p role="status" className="home-status">{mensagem}</p>
        {carregando && <Carregamento tipo="cartoes" descricao="Carregando atividades e publicações…" />}
        <div className="home-seletor-mobile"><Select id="home-coluna" labelText="Coluna do quadro" value={colunaMobile} onChange={e => setColunaMobile(e.target.value as StatusAtividade)}>
          {COLUNAS.map(c => <SelectItem key={c.id} value={c.id} text={`${c.titulo} (${filtrados.filter(i => colunaAtividade(i.atividade.status) === c.id).length})`} />)}
        </Select></div>
      </Column>
      </Grid>
      {!carregando && <Grid narrow fullWidth className="home-quadro">
        {COLUNAS.map(coluna => {
          const todos = filtrados.filter(i => colunaAtividade(i.atividade.status) === coluna.id)
          const visiveis = coluna.id === 'concluida' && !todasConcluidas ? todos.slice(0, 10) : todos
          return <Column key={coluna.id} sm={4} md={4} lg={4} className={`home-coluna-container ${colunaMobile === coluna.id ? 'home-coluna-ativa' : ''}`}>
            <section aria-labelledby={`home-coluna-${coluna.id}`} className={`home-coluna home-coluna-${coluna.id}${destinoArraste === coluna.id ? ' home-destino' : ''}`}
              onDragOver={e => { if (itemArrastado.current) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDestinoArraste(coluna.id) } }}
              onDrop={e => { e.preventDefault(); const item = itens.find(i => chaveItem(i) === itemArrastado.current); encerrarArraste(); if (item) void mover(item, coluna.id) }}>
              <div className="home-coluna-titulo"><h3 id={`home-coluna-${coluna.id}`}>{coluna.titulo}</h3><span>{todos.length}</span></div>
              {visiveis.map(item => {
                const { atividade, processo, checklist } = item, chave = chaveItem(item)
                const atrasada = noPeriodo(atividade, 'atrasadas', agora)
                const id = `home-status-${processo.id}-${atividade.id}`
                return <article key={chave} className={`home-cartao${arrastando === chave ? ' home-arrastando' : ''}`} aria-busy={salvando.has(chave)}
                  draggable={!salvando.has(chave)} onDragStart={e => {
                    if (salvando.has(chave) || (e.target instanceof HTMLElement && e.target.closest('button, select, a'))) { e.preventDefault(); return }
                    itemArrastado.current = chave; setArrastando(chave); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', chave)
                  }} onDragEnd={encerrarArraste}>
                  <p className="home-tipo">{TIPOS[atividade.tipo] || atividade.tipo}</p>
                  <h4><button className="home-abrir-atividade" onClick={() => irPara('casos', { id: processo.id, aba: 'atividades', atividadeId: atividade.id })}>{atividade.titulo}</button></h4>
                  <button className="home-processo" onClick={() => irPara('casos', { id: processo.id })}>{processo.titulo || 'Processo sem título'}</button>
                  <p className="home-executor">{atividade.responsavel ? formatarNomeExibicao(atividade.responsavel) : 'Sem responsável'}</p>
                  <div className="home-cartao-meta"><span className={atrasada ? 'home-atrasada' : ''}>
                    {atrasada ? 'Atrasada · ' : atividade.data === diaLocal(agora) ? 'Hoje · ' : ''}{atividade.data ? formatarDataSimples(atividade.data) : 'Sem data'}{atividade.hora ? ` · ${atividade.hora}` : ''}
                  </span><span>{checklist ? `Checklist ${checklist.concluidos} de ${checklist.total}` : 'Checklist indisponível'}</span></div>
                  <Select id={id} size="sm" labelText={`Alterar status: ${atividade.titulo}`} hideLabel value={atividade.status} disabled={salvando.has(chave)} onChange={e => void mover(item, e.target.value as StatusAtividade)}>
                    {!COLUNAS.some(c => c.id === atividade.status) && <SelectItem value={atividade.status} text={`Status atual: ${atividade.status}`} />}
                    {COLUNAS.map(c => <SelectItem key={c.id} value={c.id} text={c.titulo} />)}
                  </Select>
                  {salvando.has(chave) && <p role="status" className="home-executor">Salvando status…</p>}
                </article>
              })}
              {!todos.length && <p className="home-coluna-vazia">{erro ? 'Dados indisponíveis ou nenhum item carregado.' : 'Nenhuma atividade nesta coluna com os filtros atuais.'}</p>}
              {coluna.id === 'concluida' && todos.length > 10 && <Button kind="ghost" size="sm" onClick={() => setTodasConcluidas(!todasConcluidas)}>{todasConcluidas ? 'Exibir até 10' : `Ver todas (${todos.length})`}</Button>}
            </section>
          </Column>
        })}
      </Grid>}
      <Grid narrow fullWidth className="home-grupo">
        <Column sm={4} md={8} lg={16}>
        <div className="home-publicacoes"><p>{publicacoes === null ? 'Consulte as publicações para revisar na triagem.' : `${publicacoes} publicação(ões) aguardam revisão.`} A vinculação ao processo não conclui a triagem.</p>
          <Button kind="ghost" size="sm" onClick={() => irPara('publicacoes-oab', { status: 'nao_tratada' })}>Revisar publicações</Button></div>
      </Column>
      </Grid>
    </>}
    <Modal open={escolhendoProcesso} modalHeading="Nova atividade: selecionar processo" primaryButtonText="Continuar" secondaryButtonText="Cancelar" primaryButtonDisabled={!processoNovo} onRequestClose={() => setEscolhendoProcesso(false)} onRequestSubmit={() => { if (processoNovo) { setEscolhendoProcesso(false); setCriando(true) } }}>
      {processos.length ? <Select id="home-nova-processo" labelText="Processo" value={processoNovo} onChange={e => setProcessoNovo(e.target.value)}>
        <SelectItem value="" text="Selecione um processo" />{processos.map(p => <SelectItem key={p.id} value={p.id} text={p.titulo || 'Processo sem título'} />)}
      </Select> : <><p>Cadastre um processo para associar a nova atividade.</p><Button kind="ghost" size="md" onClick={() => { setEscolhendoProcesso(false); irPara('casos') }}>Ir para processos</Button></>}
    </Modal>
    {criando && processoNovo && <AtividadeModal open casoId={processoNovo} atividade={null} onClose={() => setCriando(false)} onSalva={() => { setCriando(false); void carregar() }} />}
  </div>
}
