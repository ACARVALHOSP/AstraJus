import Carregamento from './Carregamento'
import { useEffect, useState } from 'react'
import { Button, Callout, Flex, Heading, Popover, Text } from '@radix-ui/themes'
import { AlertTriangle, User } from 'lucide-react'
import { useCliente } from './api/ClienteContext'
import type { ClienteMCP } from './api/mcpClient'
import { useNavegacao } from './api/NavegacaoContext'

type Perfil = { login: string; nome_completo: string; nivel_acesso: string }
const NIVEIS: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Consulta' }

export default function ContaUsuario() {
  const { cliente } = useCliente()
  return cliente ? <ContaConectada key={cliente.token} cliente={cliente} /> : null
}

function ContaConectada({ cliente }: { cliente: ClienteMCP }) {
  const { esquecer } = useCliente()
  const { irPara } = useNavegacao()
  const [aberto, setAberto] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [erro, setErro] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    const controlador = new AbortController()
    void fetch('/responsaveis/me', {
      headers: { Authorization: `Bearer ${cliente.token}` },
      cache: 'no-store', signal: controlador.signal,
    }).then(async resposta => {
      if (!resposta.ok) throw new Error('Perfil indisponível')
      const dados = await resposta.json() as { usuario: Perfil }
      if (!dados.usuario?.nome_completo) throw new Error('Perfil inválido')
      if (!controlador.signal.aborted) setPerfil(dados.usuario)
    }).catch(() => { if (!controlador.signal.aborted) setErro(true) })
    return () => controlador.abort()
  }, [cliente, tentativa])

  const nome = perfil?.nome_completo || 'Minha conta'
  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger>
        <button type="button" className="aj-ib aj-conta-acionador" aria-label={`Conta de ${nome}`} title={nome}>
          <User size={18} aria-hidden="true" />
          <span className="aj-conta-nome">{nome}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content width="260px" align="end">
        <Flex direction="column" gap="3" role="region" aria-label="Minha conta">
          <Heading size="3">{nome}</Heading>
          {perfil ? (
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">{perfil.login}</Text>
              <Text size="2" color="gray">Perfil de acesso: {NIVEIS[perfil.nivel_acesso] || 'Não informado'}</Text>
            </Flex>
          ) : erro ? (
            <Flex direction="column" gap="2">
              <Callout.Root color="red" size="1">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>Não foi possível carregar seus dados.</Callout.Text>
              </Callout.Root>
              <Button variant="ghost" size="1" style={{ alignSelf: 'flex-start' }} onClick={() => { setErro(false); setTentativa(t => t + 1) }}>Tentar novamente</Button>
            </Flex>
          ) : <Carregamento tipo="texto" descricao="Carregando seus dados…" />}
          <Button variant="ghost" size="1" style={{ alignSelf: 'flex-start' }} onClick={() => { setAberto(false); irPara('acesso') }}>Configurações de acesso</Button>
          <Button variant="ghost" color="red" size="1" style={{ alignSelf: 'flex-start' }} onClick={() => { setAberto(false); setPerfil(null); esquecer(); irPara('acesso') }}>Sair</Button>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  )
}
