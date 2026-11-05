import Carregamento from '../Carregamento'
import { useCallback, useEffect, useRef, useState } from 'react'
import './casos/processos-radix.css'
import { Button, Callout, Card, Flex, Select, Text } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
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
      setCarregando(false)
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
    <Flex direction="column" gap="6">
      <div className="aj-layout-14">
        <h1>Atividades abertas</h1>
        <Button variant="outline" size="1" onClick={carregar} disabled={carregando}>
          Atualizar atividades
        </Button>
      </div>
      <p>
        Atividades pendentes de todos os processos. Filtre pelo responsável pela atividade ou pelo processo. As datas
        são as cadastradas, sem cálculo de prazo.
      </p>
      <div className="casos-formulario-grade">
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="atividades-executor">Responsável pela atividade</label>
          <Select.Root value={filtroExecutor || '__all__'} onValueChange={(v) => setFiltroExecutor(v === '__all__' ? '' : v)}>
            <Select.Trigger id="atividades-executor" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__all__">Todos</Select.Item>
              {opcoesExecutor.map((o) => (
                <Select.Item key={o.valor} value={o.valor}>{o.nome}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="atividades-responsavel">Responsável pelo processo</label>
          <Select.Root value={filtroResponsavel || '__all__'} onValueChange={(v) => setFiltroResponsavel(v === '__all__' ? '' : v)}>
            <Select.Trigger id="atividades-responsavel" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__all__">Todos</Select.Item>
              {opcoesResponsavel.map((nome) => (
                <Select.Item key={nome} value={nome}>{nome === 'Sem responsável' ? nome : formatarNomeExibicao(nome)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="atividades-tipo">Tipo</label>
          <Select.Root value={filtroTipo || '__all__'} onValueChange={(v) => setFiltroTipo(v === '__all__' ? '' : v)}>
            <Select.Trigger id="atividades-tipo" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__all__">Todos</Select.Item>
              {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                <Select.Item key={valor} value={valor}>{rotulo}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div aria-live="polite">
        {statusTexto && (
          <Callout.Root color={statusTexto.tipo === 'erro' ? 'red' : statusTexto.tipo === 'aviso' ? 'yellow' : 'blue'} size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{statusTexto.texto}</Callout.Text>
          </Callout.Root>
        )}
      </div>
      <Flex direction="column" gap="4">
        {carregando && <Carregamento tipo="cartoes" descricao="Carregando atividades…" />}
        {!carregando && itensFiltrados.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhuma atividade aberta nos processos carregados com estes filtros.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && itensFiltrados.map(({ caso, atividade }) => (
          <Card key={`${caso.id}-${atividade.id}`} size="1">
            <Flex direction="column" gap="2">
              <Text size="2" weight="bold">{formatarNomeExibicao(atividade.titulo)}</Text>
              <Text as="p" size="2">
                {caso.titulo ? formatarNomeExibicao(caso.titulo) : 'Processo sem título'} · Responsável pelo processo:{' '}
                {caso.responsavel ? formatarNomeExibicao(caso.responsavel) : 'Não definido'}
              </Text>
              <Text as="p" size="2">Responsável pela atividade: {atividade.responsavel || 'Sem responsável'}</Text>
              <Text as="p" size="2">
                {ROTULO_TIPO[atividade.tipo] ?? atividade.tipo} · {atividade.data ? formatarDataSimples(atividade.data) : 'Sem data'}
                {atividade.hora ? ` · ${atividade.hora}` : ''}
              </Text>
              <div className="aj-layout-15">
                <Button variant="ghost" size="1" onClick={() => irPara('casos', { abrirCasoId: caso.id })}>
                  Abrir processo
                </Button>
                <Button variant="outline" size="1" onClick={() => concluir({ caso, atividade })}>
                  Concluir atividade
                </Button>
              </div>
            </Flex>
          </Card>
        ))}
      </Flex>
    </Flex>
  )
}
