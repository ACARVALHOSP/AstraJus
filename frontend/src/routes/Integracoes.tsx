import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'

type StatusSelo = 'verificando' | 'configurado' | 'nao-configurado' | 'acesso-necessario' | 'falha'

const TOM_SELO: Record<StatusSelo, { texto: string; tom: 'blue' | 'green' | 'gray' | 'red' }> = {
  verificando: { texto: 'Verificando…', tom: 'gray' },
  configurado: { texto: 'Configurado', tom: 'green' },
  'nao-configurado': { texto: 'Não configurado', tom: 'gray' },
  'acesso-necessario': { texto: 'Acesso necessário', tom: 'gray' },
  falha: { texto: 'Não verificado', tom: 'gray' },
}

function Selo({ status }: { status: StatusSelo }) {
  if (status === 'verificando') return <Carregamento tipo="texto" descricao="Verificando integração…" />
  const { texto, tom } = TOM_SELO[status]
  return <Badge color={tom}>{texto}</Badge>
}

export default function Integracoes() {
  const { cliente } = useCliente()
  const [googleStatus, setGoogleStatus] = useState<StatusSelo>('acesso-necessario')
  const [asaasStatus, setAsaasStatus] = useState<StatusSelo>('acesso-necessario')
  const [zapsignStatus, setZapsignStatus] = useState<StatusSelo>('acesso-necessario')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const [agendaStatus, setAgendaStatus] = useState('Verifique a conexão antes de usar.')

  const carregar = useCallback(async () => {
    setAviso(null)
    setErro(null)
    if (!cliente) {
      setGoogleStatus('acesso-necessario')
      setAsaasStatus('acesso-necessario')
      setZapsignStatus('acesso-necessario')
      setAviso('Conecte-se na aba Acesso para verificar a configuração dos serviços.')
      return
    }
    setGoogleStatus('verificando')
    setAsaasStatus('verificando')
    setZapsignStatus('verificando')
    try {
      const resposta = await fetch('/integracoes/status', { headers: { Authorization: `Bearer ${cliente.token}` } })
      if (!resposta.ok) {
        throw new Error(
          resposta.status === 401
            ? 'Seu acesso expirou. Entre de novo em Configurações › Acesso.'
            : 'Não conseguimos verificar os serviços agora. As integrações continuam funcionando como antes; tente de novo em alguns minutos.',
        )
      }
      const dados = (await resposta.json()) as { google?: boolean; asaas?: boolean; zapsign?: boolean }
      if (typeof dados.google !== 'boolean' || typeof dados.asaas !== 'boolean') {
        throw new Error('Não conseguimos ler a situação dos serviços. Tente de novo em alguns minutos.')
      }
      setGoogleStatus(dados.google ? 'configurado' : 'nao-configurado')
      setAsaasStatus(dados.asaas ? 'configurado' : 'nao-configurado')
      setZapsignStatus(dados.zapsign === true ? 'configurado' : 'nao-configurado')
    } catch (e) {
      const mensagem = e instanceof TypeError ? 'Não foi possível conectar. Confira sua conexão e tente novamente.' : (e as Error).message
      setErro(mensagem)
      setGoogleStatus('falha')
      setAsaasStatus('falha')
      setZapsignStatus('falha')
    }
  }, [cliente])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function minhaAgendaGoogle(acao: 'conectar' | 'desconectar' | 'status') {
    try {
      if (!cliente) throw new Error('Conecte-se na aba Acesso.')
      const r = await fetch('/integracoes/calendar/' + acao, {
        method: acao === 'status' ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + cliente.token },
      })
      const dados = (await r.json()) as { erro?: string; url?: string; conectado?: boolean }
      if (!r.ok) throw new Error(dados.erro || 'Não foi possível atualizar a agenda.')
      if (dados.url) {
        if (new URL(dados.url).origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.')
        window.open(dados.url, '_blank', 'noopener')
        setAgendaStatus('Conclua o consentimento na aba Google e verifique a conexão ao retornar.')
      } else {
        setAgendaStatus(dados.conectado ? 'Sua agenda está conectada.' : 'Sua agenda está desconectada.')
      }
    } catch (e) {
      setAgendaStatus((e as Error).message)
    }
  }

  return (
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Integrações"
        descricao="Conexões com serviços externos usados pelo escritório."
        acoes={<Button variant="soft" color="gray" size="2" onClick={carregar}>Verificar novamente</Button>}
      />
      <Text as="p" size="2" color="gray">
        Quem configura as integrações é o administrador do escritório. "Configurado" quer dizer que os dados de
        acesso foram cadastrados.
      </Text>
      <div>
        <a href="/admin/integracoes" target="_blank" rel="noopener">
          Administrar integrações
        </a>
      </div>
      <div aria-live="polite">
        {aviso && (
          <Callout.Root color="yellow" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{aviso}</Callout.Text>
          </Callout.Root>
        )}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
      </div>
      <div className="aj-form-grade">
        <Card variant="surface">
          <Flex direction="column" gap="3">
            <img src="/static/icons/google.svg" alt="" width={40} height={40} className="integracao-logo" onError={(e) => { e.currentTarget.hidden = true }} />
            <Heading as="h3" size="3">Google</Heading>
            <Text as="p" size="2">Drive do escritório (conta institucional).</Text>
            <Selo status={googleStatus} />
          </Flex>
        </Card>
        <Card variant="surface">
          <Flex direction="column" gap="3">
            <img src="/static/icons/asaas.png" alt="" width={40} height={40} className="integracao-logo" onError={(e) => { e.currentTarget.hidden = true }} />
            <Heading as="h3" size="3">Asaas</Heading>
            <Text as="p" size="2">Cobranças e boletos. Veja em Financeiro &gt; Pagamentos.</Text>
            <Selo status={asaasStatus} />
          </Flex>
        </Card>
        <Card variant="surface">
          <Flex direction="column" gap="3">
            <img src="/static/icons/zapsign.svg" alt="" width={40} height={40} className="integracao-logo" onError={(e) => { e.currentTarget.hidden = true }} />
            <Heading as="h3" size="3">ZapSign</Heading>
            <Text as="p" size="2">Assinatura digital de documentos.</Text>
            <Selo status={zapsignStatus} />
          </Flex>
        </Card>
        <Card variant="surface">
          <Flex direction="column" gap="3">
            <Heading as="h3" size="3">Minha agenda Google</Heading>
            <Text as="p" size="2">Conecte sua conta individual para criar eventos no seu calendário.</Text>
            <Text as="p" size="2" role="status">{agendaStatus}</Text>
            <Flex gap="2" wrap="wrap">
              <Button variant="soft" size="1" onClick={() => minhaAgendaGoogle('conectar')}>
                Conectar minha agenda
              </Button>
              <Button variant="ghost" size="1" onClick={() => minhaAgendaGoogle('desconectar')}>
                Desconectar minha agenda
              </Button>
              <Button variant="ghost" size="1" onClick={() => minhaAgendaGoogle('status')}>
                Verificar conexão
              </Button>
            </Flex>
          </Flex>
        </Card>
      </div>
    </Flex>
  )
}
