import { useState } from 'react'
import { Button, Stack, Tab, TabList, TabPanel, TabPanels, Tabs } from '@carbon/react'
import { formatarNomeExibicao } from '../utils/formatadores'
import ListaCasos from './casos/ListaCasos'
import CadastroCaso from './casos/CadastroCaso'
import AtividadesCaso from './casos/AtividadesCaso'
import VinculosCaso from './casos/VinculosCaso'

export default function Casos() {
  const [casoId, setCasoId] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('Carregando…')

  function abrir(id: string) {
    setTitulo('Carregando…')
    setCasoId(id)
  }

  if (!casoId) {
    return <ListaCasos onAbrir={abrir} />
  }

  return (
    <Stack gap={6}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Button kind="ghost" size="sm" onClick={() => setCasoId(null)}>
          ← Voltar
        </Button>
        <h2>{titulo}</h2>
      </div>
      <Tabs key={casoId}>
        <TabList aria-label="Detalhes do processo">
          <Tab>Cadastro</Tab>
          <Tab>Atividades</Tab>
          <Tab>Vínculos</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <CadastroCaso
              casoId={casoId}
              onCarregado={(caso) => setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)')}
              onSalvo={(caso) => setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)')}
              onExcluido={() => setCasoId(null)}
            />
          </TabPanel>
          <TabPanel>
            <AtividadesCaso casoId={casoId} />
          </TabPanel>
          <TabPanel>
            <VinculosCaso casoId={casoId} onAbrirCaso={abrir} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack>
  )
}
