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
  const { consumirPayload } = useNavegacao()
  const [casoId, setCasoId] = useState<string | null>(() => consumirPayload<{ id: string }>('casos')?.id ?? null)
  const [resumo, setResumo] = useState<Caso | null>(null)
  const [titulo, setTitulo] = useState('Carregando…')
  const faixaAbas = useRef<HTMLDivElement>(null)

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
      <Tabs key={casoId}>
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
            />
          </TabPanel>
          <TabPanel>
            <AtividadesCaso casoId={casoId} />
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
