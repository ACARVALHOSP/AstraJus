import { ArrowLeft } from '@carbon/icons-react'
import { useState } from 'react'
import { Button, Stack } from '@carbon/react'
import { useNavegacao } from '../api/NavegacaoContext'
import { formatarNomeExibicao } from '../utils/formatadores'
import ListaContatos from './contatos/ListaContatos'
import CadastroContato from './contatos/CadastroContato'

type Visao = { tipo: 'lista' } | { tipo: 'detalhe'; clienteId: string | null }

export default function Contatos() {
  const { consumirPayload } = useNavegacao()
  const [visao, setVisao] = useState<Visao>(() => {
    const payload = consumirPayload<{ id: string }>('contatos')
    return payload?.id ? { tipo: 'detalhe', clienteId: payload.id } : { tipo: 'lista' }
  })
  const [nomeDetalhe, setNomeDetalhe] = useState('Carregando…')

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
      <Button kind="ghost" size="sm" renderIcon={ArrowLeft} onClick={() => setVisao({ tipo: 'lista' })}>
        Voltar para clientes
      </Button>
      <h1>{nomeDetalhe}</h1>
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
