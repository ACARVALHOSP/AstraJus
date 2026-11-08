import { confirmarSaida } from '../AlteracoesPendentes'
import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Flex, Heading, Skeleton, Tabs, Text } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { buscarJson } from '../api/rest'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import ListaCasos, { type Caso } from './casos/ListaCasos'
import CadastroCaso from './casos/CadastroCaso'
import AtividadesCaso from './casos/AtividadesCaso'
import PublicacoesCaso from './casos/PublicacoesCaso'
import MovimentacoesCaso from './casos/MovimentacoesCaso'
import VinculosCaso from './casos/VinculosCaso'
import './casos/processos-radix.css'

const ABAS = ['cadastro', 'atividades', 'publicacoes', 'movimentacoes', 'vinculos'] as const
type AbaId = typeof ABAS[number]

export default function Casos() {
  const { consumirPayload, versaoNavegacao } = useNavegacao()
  const { cliente } = useCliente()
  const [casoId, setCasoId] = useState<string | null>(null)
  const [contagensDe, setContagensDe] = useState<{ casoId: string; atividades_abertas: number; publicacoes_a_revisar: number } | null>(null)

  // Números das abas; recarregados quando uma aba altera atividades ou publicações.
  // Guardados com o id do processo para não mostrar os números de outro durante a troca.
  const atualizarContagens = useCallback(() => {
    if (!casoId) return
    buscarJson<{ contagens?: { atividades_abertas: number; publicacoes_a_revisar: number } }>(cliente, `/casos/${casoId}`)
      .then(r => setContagensDe(r.contagens ? { casoId, ...r.contagens } : null))
      .catch(() => setContagensDe(null))
  }, [cliente, casoId])
  useEffect(atualizarContagens, [atualizarContagens])
  const contagens = contagensDe && contagensDe.casoId === casoId ? contagensDe : null
  const [destinoAtividade, setDestinoAtividade] = useState<{ id?: string | number; versao: number }>({ versao: 0 })
  const [resumo, setResumo] = useState<Caso | null>(null)
  const [abaSelecionada, setAbaSelecionada] = useState<AbaId>('cadastro')
  const [titulo, setTitulo] = useState<string | null>(null)
  const faixaAbas = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const destino = consumirPayload<{ id: string; aba?: 'atividades' | 'publicacoes'; atividadeId?: string | number }>('casos')
    if (!destino) return
    setCasoId(destino.id)
    setResumo(null)
    setTitulo(null)
    setAbaSelecionada(destino.aba === 'atividades' ? 'atividades' : destino.aba === 'publicacoes' ? 'publicacoes' : 'cadastro')
    setDestinoAtividade({ id: destino.atividadeId, versao: versaoNavegacao })
  }, [consumirPayload, versaoNavegacao])

  useEffect(() => {
    const faixa = faixaAbas.current
    if (!faixa) return
    let largura = -1
    let quadro = 0
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada.contentRect.width === largura) return
      largura = entrada.contentRect.width
      cancelAnimationFrame(quadro)
      quadro = requestAnimationFrame(() => {
        faixa.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    })
    observador.observe(faixa)
    return () => { observador.disconnect(); cancelAnimationFrame(quadro) }
  }, [casoId])

  useEffect(() => {
    const cabecalho = document.querySelector<HTMLHeadingElement>('.casos-lista h1, .casos-detalhe h1')
    cabecalho?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [casoId])

  function abrir(id: string) {
    setDestinoAtividade({ versao: versaoNavegacao })
    setAbaSelecionada('cadastro')
    setResumo(null)
    setTitulo(null)
    setCasoId(id)
  }

  if (!casoId) {
    return <ListaCasos onAbrir={abrir} />
  }

  return (
    <div className="casos-detalhe">
      <Flex direction="column" gap="6">
        <div className="casos-detalhe-cabecalho">
          <Button variant="ghost" size="1" onClick={() => confirmarSaida(() => setCasoId(null))}>
            <ChevronLeft size={16} />
            Voltar para processos
          </Button>
          <Heading as="h1" size="6" tabIndex={-1}>{titulo ?? <Skeleton width="16rem" height="1.75rem" aria-label="Carregando…" />}</Heading>
          {resumo?.processos?.map((numero, i) => (
            <p key={numero} className="casos-cnj">
              {formatarNumeroCNJ(numero)}{i === 0 && resumo.foro ? ` · ${resumo.foro}` : ''}
            </p>
          ))}
        </div>
        <Tabs.Root key={casoId} value={abaSelecionada} onValueChange={(v) => confirmarSaida(() => setAbaSelecionada(v as AbaId))}>
          <div ref={faixaAbas}>
            <Tabs.List className="casos-abas" aria-label="Detalhes do processo">
              <Tabs.Trigger value="cadastro">Cadastro</Tabs.Trigger>
              <Tabs.Trigger value="atividades">
                Atividades{contagens ? <Text size="1" color="gray" ml="1">{contagens.atividades_abertas}</Text> : null}
              </Tabs.Trigger>
              <Tabs.Trigger value="publicacoes">
                Publicações{contagens?.publicacoes_a_revisar
                  ? <Badge color="red" variant="solid" radius="full" ml="1" aria-label={`${contagens.publicacoes_a_revisar} a revisar`}>{contagens.publicacoes_a_revisar}</Badge>
                  : null}
              </Tabs.Trigger>
              <Tabs.Trigger value="movimentacoes">Movimentações</Tabs.Trigger>
              <Tabs.Trigger value="vinculos">Vínculos</Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="cadastro">
            <CadastroCaso
              casoId={casoId}
              onCarregado={(caso) => { setResumo(caso); setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)') }}
              onSalvo={(caso) => { setResumo(caso); setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)') }}
              onExcluido={() => setCasoId(null)}
              onMovimentacoes={() => setAbaSelecionada('movimentacoes')}
            />
          </Tabs.Content>
          <Tabs.Content value="atividades">
            <AtividadesCaso key={`${casoId}:${destinoAtividade.versao}`} casoId={casoId} atividadeInicialId={destinoAtividade.id} onAlterado={atualizarContagens} />
          </Tabs.Content>
          <Tabs.Content value="publicacoes">
            <PublicacoesCaso casoId={casoId} onAlterado={atualizarContagens} />
          </Tabs.Content>
          <Tabs.Content value="movimentacoes">
            <MovimentacoesCaso casoId={casoId} />
          </Tabs.Content>
          <Tabs.Content value="vinculos">
            <VinculosCaso casoId={casoId} onAbrirCaso={abrir} />
          </Tabs.Content>
        </Tabs.Root>
      </Flex>
    </div>
  )
}
