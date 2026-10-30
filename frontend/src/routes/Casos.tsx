import { ArrowLeft } from '@carbon/icons-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Grid, Column, Stack, Tab, TabList, TabPanel, TabPanels, Tabs } from '@carbon/react'
import { useNavegacao } from '../api/NavegacaoContext'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import ListaCasos, { type Caso } from './casos/ListaCasos'
import CadastroCaso from './casos/CadastroCaso'
import AtividadesCaso from './casos/AtividadesCaso'
import PublicacoesCaso from './casos/PublicacoesCaso'
import MovimentacoesCaso from './casos/MovimentacoesCaso'
import VinculosCaso from './casos/VinculosCaso'

export default function Casos() {
  const { consumirPayload, versaoNavegacao } = useNavegacao()
  const [casoId, setCasoId] = useState<string | null>(null)
  const [destinoAtividade, setDestinoAtividade] = useState<{ id?: string | number; versao: number }>({ versao: 0 })
  const [resumo, setResumo] = useState<Caso | null>(null)
  const [abaSelecionada, setAbaSelecionada] = useState(0)
  const [titulo, setTitulo] = useState('Carregando…')
  const faixaAbas = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const destino = consumirPayload<{ id: string; aba?: 'atividades' | 'publicacoes'; atividadeId?: string | number }>('casos')
    if (!destino) return
    setCasoId(destino.id)
    setResumo(null)
    setTitulo('Carregando…')
    setAbaSelecionada(destino.aba === 'atividades' ? 1 : destino.aba === 'publicacoes' ? 2 : 0)
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
    setAbaSelecionada(0)
    setResumo(null)
    setTitulo('Carregando…')
    setCasoId(id)
  }

  if (!casoId) {
    return <ListaCasos onAbrir={abrir} />
  }

  return (
    <Grid narrow fullWidth className="casos-detalhe"><Column sm={4} md={8} lg={16}><Stack gap={6}>
      <div className="casos-detalhe-cabecalho">
        <Button kind="ghost" size="sm" renderIcon={ArrowLeft} onClick={() => setCasoId(null)}>
          Voltar para processos
        </Button>
        <h1 tabIndex={-1}>{titulo}</h1>{resumo?.processos?.map((numero) => <p key={numero} className="casos-cnj">{formatarNumeroCNJ(numero)}</p>)}
      </div>
      <Tabs key={casoId} selectedIndex={abaSelecionada} onChange={({ selectedIndex }) => setAbaSelecionada(selectedIndex)}>
        <div ref={faixaAbas}>
        <TabList className="casos-abas" aria-label="Detalhes do processo">
          <Tab>Cadastro</Tab>
          <Tab>Atividades</Tab>
          <Tab>Publicações</Tab>
          <Tab>Movimentações</Tab>
          <Tab>Vínculos</Tab>
        </TabList>
        </div>
        <TabPanels>
          <TabPanel>
            <CadastroCaso
              casoId={casoId}
              onCarregado={(caso) => { setResumo(caso); setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)') }}
              onSalvo={(caso) => { setResumo(caso); setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)') }}
              onExcluido={() => setCasoId(null)}
              onMovimentacoes={() => setAbaSelecionada(3)}
            />
          </TabPanel>
          <TabPanel>
            <AtividadesCaso key={`${casoId}:${destinoAtividade.versao}`} casoId={casoId} atividadeInicialId={destinoAtividade.id} />
          </TabPanel>
          <TabPanel>
            <PublicacoesCaso casoId={casoId} />
          </TabPanel>
          <TabPanel>
            <MovimentacoesCaso casoId={casoId} />
          </TabPanel>
          <TabPanel>
            <VinculosCaso casoId={casoId} onAbrirCaso={abrir} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack></Column></Grid>
  )
}
