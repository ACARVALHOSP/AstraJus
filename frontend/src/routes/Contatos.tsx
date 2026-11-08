import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { Button, Flex, Heading, Skeleton, Tabs } from '@radix-ui/themes'
import { useNavegacao } from '../api/NavegacaoContext'
import { formatarNomeExibicao } from '../utils/formatadores'
import ListaContatos from './contatos/ListaContatos'
import { confirmarSaida } from '../AlteracoesPendentes'
import CadastroContato from './contatos/CadastroContato'
import VinculosContato from './contatos/VinculosContato'
import './contatos/contatos-radix.css'

type Visao = { tipo: 'lista' } | { tipo: 'detalhe'; clienteId: string | null }

export default function Contatos() {
  const { consumirPayload } = useNavegacao()
  const [visao, setVisao] = useState<Visao>(() => {
    const payload = consumirPayload<{ id: string }>('contatos')
    return payload?.id ? { tipo: 'detalhe', clienteId: payload.id } : { tipo: 'lista' }
  })
  const [nomeDetalhe, setNomeDetalhe] = useState<string | null>(null)
  const [aba, setAba] = useState('cadastro')

  if (visao.tipo === 'lista') {
    return (
      <ListaContatos
        onAbrir={(id) => {
          setNomeDetalhe(null)
          setAba('cadastro')
          setVisao({ tipo: 'detalhe', clienteId: id })
        }}
        onNovo={() => {
          setNomeDetalhe('Novo contato')
          setAba('cadastro')
          setVisao({ tipo: 'detalhe', clienteId: null })
        }}
      />
    )
  }

  return (
    <Flex direction="column" gap="6">
      <Button variant="ghost" size="1" style={{ alignSelf: 'flex-start' }} onClick={() => confirmarSaida(() => setVisao({ tipo: 'lista' }))}>
        <ChevronLeft size={16} />
        Voltar para contatos
      </Button>
      <Heading as="h1" size="6">{nomeDetalhe ?? <Skeleton width="16rem" height="1.75rem" aria-label="Carregando…" />}</Heading>
      <Tabs.Root key={visao.clienteId ?? 'novo'} value={aba} onValueChange={(v) => confirmarSaida(() => setAba(v))}>
        <Tabs.List aria-label="Detalhes do contato">
          <Tabs.Trigger value="cadastro">Cadastro</Tabs.Trigger>
          {visao.clienteId && <Tabs.Trigger value="processos">Processos vinculados</Tabs.Trigger>}
          {visao.clienteId && <Tabs.Trigger value="financeiro">Financeiro</Tabs.Trigger>}
        </Tabs.List>
        <Tabs.Content value="cadastro">
          <CadastroContato
            clienteId={visao.clienteId}
            onCarregado={(cli) => setNomeDetalhe(cli.nome ? formatarNomeExibicao(cli.nome) : '(sem nome)')}
            onSalvo={(cli) => {
              setNomeDetalhe(cli.nome ? formatarNomeExibicao(cli.nome) : '(sem nome)')
              setVisao({ tipo: 'detalhe', clienteId: cli.id ?? null })
            }}
            onExcluido={() => setVisao({ tipo: 'lista' })}
            onAbrirExistente={(id) => confirmarSaida(() => { setNomeDetalhe(null); setAba('cadastro'); setVisao({ tipo: 'detalhe', clienteId: id }) })}
          />
        </Tabs.Content>
        {visao.clienteId && (
          <Tabs.Content value="processos">
            <VinculosContato clienteId={visao.clienteId} tipo="processos" />
          </Tabs.Content>
        )}
        {visao.clienteId && (
          <Tabs.Content value="financeiro">
            <VinculosContato clienteId={visao.clienteId} tipo="financeiro" />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </Flex>
  )
}
