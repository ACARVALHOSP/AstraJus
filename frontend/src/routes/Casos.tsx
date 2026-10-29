import { useState } from 'react'
import { Button, Stack } from '@carbon/react'
import { formatarNomeExibicao } from '../utils/formatadores'
import ListaCasos from './casos/ListaCasos'
import CadastroCaso from './casos/CadastroCaso'

export default function Casos() {
  const [casoId, setCasoId] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('Carregando…')

  if (!casoId) {
    return <ListaCasos onAbrir={(id) => {
      setTitulo('Carregando…')
      setCasoId(id)
    }} />
  }

  return (
    <Stack gap={6}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Button kind="ghost" size="sm" onClick={() => setCasoId(null)}>
          ← Voltar
        </Button>
        <h2>{titulo}</h2>
      </div>
      <CadastroCaso
        casoId={casoId}
        onCarregado={(caso) => setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)')}
        onSalvo={(caso) => setTitulo(caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)')}
        onExcluido={() => setCasoId(null)}
      />
    </Stack>
  )
}
