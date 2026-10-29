import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, InlineNotification, Select, SelectItem, Stack } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarNomeExibicao } from '../utils/formatadores'

type Caso = { id: string; titulo?: string; responsavel?: string }
type Atividade = {
  id: string
  titulo: string
  tipo: string
  status: string
  responsavel?: string
  data?: string
  hora?: string
}
type ItemAtividade = { caso: Caso; atividade: Atividade }

const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

function valorFiltroExecutor(atividade: Atividade): string {
  return atividade.responsavel ? `responsavel:${atividade.responsavel}` : 'sem-responsavel'
}

export default function Atividades() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [carregando, setCarregando] = useState(true)
  const [statusTexto, setStatusTexto] = useState<{ tipo: 'erro' | 'aviso' | 'info'; texto: string } | null>(null)
  const [itens, setItens] = useState<ItemAtividade[]>([])
  const [opcoesResponsavel, setOpcoesResponsavel] = useState<string[]>([])
  const [opcoesExecutor, setOpcoesExecutor] = useState<Array<{ valor: string; nome: string }>>([])

  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroExecutor, setFiltroExecutor] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')

  const geracaoRef = useRef(0)

  const carregar = useCallback(async () => {
    if (!cliente) {
      setStatusTexto({ tipo: 'erro', texto: 'Informe o seu token na aba Acesso e clique em Conectar antes de consultar.' })
      return
    }
    const geracao = ++geracaoRef.current
    setCarregando(true)
    setItens([])
    setStatusTexto({ tipo: 'info', texto: 'Carregando atividades dos processos…' })
    try {
      const { casos } = await buscarJson<{ casos: Caso[] }>(cliente, '/casos')
      if (!Array.isArray(casos)) throw new Error('Resposta de processos inválida.')
      const resultados: ItemAtividade[] = []
      const falhas: string[] = []
      let indice = 0
      await Promise.all(
        Array.from({ length: Math.min(4, casos.length) }, async () => {
          while (indice < casos.length && geracao === geracaoRef.current) {
            const caso = casos[indice++]
            try {
              const dados = await buscarJson<{ atividades: Atividade[] }>(cliente, `/casos/${caso.id}/atividades`)
              if (!Array.isArray(dados.atividades)) throw new Error('Resposta de atividades inválida.')
              resultados.push(...dados.atividades.filter((a) => a.status !== 'concluida').map((atividade) => ({ caso, atividade })))
            } catch {
              falhas.push(caso.titulo || 'Processo sem título')
            }
          }
        }),
      )
      if (geracao !== geracaoRef.current) return
      setItens(resultados)
      setOpcoesResponsavel([...new Set(casos.map((c) => c.responsavel || 'Sem responsável'))].sort())
      const executores = new Map(resultados.map(({ atividade }) => [valorFiltroExecutor(atividade), atividade.responsavel || 'Sem responsável']))
      setOpcoesExecutor(
        [...executores]
          .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
          .map(([valor, nome]) => ({ valor, nome })),
      )
      if (falhas.length) {
        setStatusTexto({
          tipo: 'aviso',
          texto: `Não foi possível carregar ${falhas.length} processo(s): ${falhas.join(', ')}. Use Atualizar atividades para tentar novamente.`,
        })
      } else {
        setStatusTexto({ tipo: 'info', texto: `Revisados ${casos.length} processos. Atualizado às ${new Date().toLocaleTimeString('pt-BR')}.` })
      }
    } catch (e) {
      if (geracao === geracaoRef.current) {
        const mensagem = e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.'
        setStatusTexto({ tipo: 'erro', texto: `${mensagem} Use Atualizar atividades para tentar novamente.` })
      }
    } finally {
      if (geracao === geracaoRef.current) setCarregando(false)
    }
  }, [cliente])

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function concluir(item: ItemAtividade) {
    try {
      await enviarJson(cliente, `/casos/${item.caso.id}/atividades/${item.atividade.id}`, { status: 'concluida' }, 'PATCH')
      setItens((atual) => atual.filter((i) => !(i.caso.id === item.caso.id && i.atividade.id === item.atividade.id)))
    } catch (e) {
      setStatusTexto({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível concluir a atividade.' })
    }
  }

  const itensFiltrados = itens.filter(
    ({ caso, atividade }) =>
      (!filtroResponsavel || (caso.responsavel || 'Sem responsável') === filtroResponsavel) &&
      (!filtroExecutor || valorFiltroExecutor(atividade) === filtroExecutor) &&
      (!filtroTipo || atividade.tipo === filtroTipo),
  )

  return (
    <Stack gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Atividades abertas</h2>
        <Button kind="tertiary" size="sm" onClick={carregar} disabled={carregando}>
          Atualizar atividades
        </Button>
      </div>
      <p>
        Atividades pendentes de todos os processos. Filtre pelo responsável pela atividade ou pelo processo. As datas
        são as cadastradas, sem cálculo de prazo.
      </p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 'calc(14ch + 3.5rem)' }}>
          <Select id="atividades-executor" labelText="Responsável pela atividade" value={filtroExecutor} onChange={(e) => setFiltroExecutor(e.target.value)}>
            <SelectItem value="" text="Todos" />
            {opcoesExecutor.map((o) => (
              <SelectItem key={o.valor} value={o.valor} text={o.nome} />
            ))}
          </Select>
        </div>
        <div style={{ maxWidth: 'calc(16ch + 3.5rem)' }}>
          <Select id="atividades-responsavel" labelText="Responsável pelo processo" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}>
            <SelectItem value="" text="Todos" />
            {opcoesResponsavel.map((nome) => (
              <SelectItem key={nome} value={nome} text={nome === 'Sem responsável' ? nome : formatarNomeExibicao(nome)} />
            ))}
          </Select>
        </div>
        <div style={{ maxWidth: 'calc(9ch + 3.5rem)' }}>
          <Select id="atividades-tipo" labelText="Tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <SelectItem value="" text="Todos" />
            {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
              <SelectItem key={valor} value={valor} text={rotulo} />
            ))}
          </Select>
        </div>
      </div>
      <div aria-live="polite">
        {statusTexto && (
          <InlineNotification
            kind={statusTexto.tipo === 'erro' ? 'error' : statusTexto.tipo === 'aviso' ? 'warning' : 'info'}
            title={statusTexto.tipo === 'aviso' ? 'Lista incompleta' : statusTexto.tipo === 'erro' ? 'Erro' : 'Status'}
            subtitle={statusTexto.texto}
            lowContrast
            hideCloseButton
          />
        )}
      </div>
      <Stack gap={4}>
        {!carregando && itensFiltrados.length === 0 && (
          <InlineNotification kind="info" title="Nenhuma atividade aberta nos processos carregados com estes filtros" lowContrast hideCloseButton />
        )}
        {itensFiltrados.map(({ caso, atividade }) => (
          <div key={`${caso.id}-${atividade.id}`} className="cds--tile">
            <Stack gap={2}>
              <h3>{formatarNomeExibicao(atividade.titulo)}</h3>
              <p>
                {caso.titulo ? formatarNomeExibicao(caso.titulo) : 'Processo sem título'} · Responsável pelo processo:{' '}
                {caso.responsavel ? formatarNomeExibicao(caso.responsavel) : 'Não definido'}
              </p>
              <p>Responsável pela atividade: {atividade.responsavel || 'Sem responsável'}</p>
              <p>
                {ROTULO_TIPO[atividade.tipo] ?? atividade.tipo} · {atividade.data ? formatarDataSimples(atividade.data) : 'Sem data'}
                {atividade.hora ? ` · ${atividade.hora}` : ''}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button kind="ghost" size="sm" onClick={() => irPara('casos', { abrirCasoId: caso.id })}>
                  Abrir processo
                </Button>
                <Button kind="tertiary" size="sm" onClick={() => concluir({ caso, atividade })}>
                  Concluir atividade
                </Button>
              </div>
            </Stack>
          </div>
        ))}
      </Stack>
    </Stack>
  )
}
