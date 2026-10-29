import { useState } from 'react'
import { Button, Stack } from '@carbon/react'
import { formatarNomeExibicao } from '../utils/formatadores'
import ListaContatos from './contatos/ListaContatos'
import CadastroContato from './contatos/CadastroContato'

type Visao = { tipo: 'lista' } | { tipo: 'detalhe'; clienteId: string | null }

export default function Contatos() {
  const [visao, setVisao] = useState<Visao>({ tipo: 'lista' })
  const [nomeDetalhe, setNomeDetalhe] = useState('Novo cliente')

  if (visao.tipo === 'lista') {
    return (
      <ListaContatos
        onAbrir={(id) => {
          setNomeDetalhe('Carregando…')
          setVisao({ tipo: 'detalhe', clienteId: id })
        }}
        onNovo={() => {
          setNomeDetalhe('Novo cliente')
          setVisao({ tipo: 'detalhe', clienteId: null })
        }}
      />
    )
  }

  return (
    <Stack gap={6}>
      <Button kind="ghost" size="sm" onClick={() => setVisao({ tipo: 'lista' })}>
        « Voltar para clientes
      </Button>
      <h2>{nomeDetalhe}</h2>
      <CadastroContato
        clienteId={visao.clienteId}
        onCarregado={(cliente) => setNomeDetalhe(cliente.nome ? formatarNomeExibicao(cliente.nome) : '(sem nome)')}
        onSalvo={(cliente) => {
          setNomeDetalhe(cliente.nome ? formatarNomeExibicao(cliente.nome) : '(sem nome)')
          setVisao({ tipo: 'detalhe', clienteId: cliente.id ?? null })
        }}
        onExcluido={() => setVisao({ tipo: 'lista' })}
      />
    </Stack>
  )
}
