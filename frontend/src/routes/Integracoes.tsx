import { useCallback, useEffect, useState } from 'react'
import { Button, InlineNotification, Link, Stack, Tag, Tile } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'

type StatusSelo = 'verificando' | 'configurado' | 'nao-configurado' | 'acesso-necessario' | 'falha'

const TOM_SELO: Record<StatusSelo, { texto: string; tom: 'blue' | 'green' | 'gray' | 'red' }> = {
  verificando: { texto: 'Verificando…', tom: 'gray' },
  configurado: { texto: 'Configurado', tom: 'green' },
  'nao-configurado': { texto: 'Não configurado', tom: 'gray' },
  'acesso-necessario': { texto: 'Acesso necessário', tom: 'gray' },
  falha: { texto: 'Falha na verificação', tom: 'gray' },
}

function Selo({ status }: { status: StatusSelo }) {
  const { texto, tom } = TOM_SELO[status]
  return <Tag type={tom}>{texto}</Tag>
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
    try {
      const resposta = await fetch('/integracoes/status', { headers: { Authorization: `Bearer ${cliente.token}` } })
      if (!resposta.ok) {
        throw new Error(
          resposta.status === 401
            ? 'Acesso expirado. Conecte-se novamente na aba Acesso.'
            : `Falha ao verificar os serviços (HTTP ${resposta.status}). Tente novamente.`,
        )
      }
      const dados = (await resposta.json()) as { google?: boolean; asaas?: boolean; zapsign?: boolean }
      if (typeof dados.google !== 'boolean' || typeof dados.asaas !== 'boolean') {
        throw new Error('Resposta de configuração inválida. Tente novamente.')
      }
      setGoogleStatus(dados.google ? 'configurado' : 'nao-configurado')
      setAsaasStatus(dados.asaas ? 'configurado' : 'nao-configurado')
      setZapsignStatus(dados.zapsign === true ? 'configurado' : 'nao-configurado')
    } catch (e) {
      const mensagem = e instanceof TypeError ? 'Não foi possível conectar. Confira sua conexão e tente novamente.' : (e as Error).message
      setErro(mensagem)
      setGoogleStatus('falha')
      setAsaasStatus('falha')
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
    <Stack gap={6}>
      <div>
        <h2>Integrações</h2>
        <p>Conexões com serviços externos usados pelo escritório.</p>
      </div>
      <div>
        <Button kind="tertiary" size="sm" onClick={carregar}>
          Verificar novamente
        </Button>
      </div>
      <p>
        A configuração é mantida pelo administrador. "Configurado" indica credenciais cadastradas; não confirma a
        disponibilidade do serviço externo.
      </p>
      <div>
        <Link href="/admin/integracoes" target="_blank" rel="noopener">
          Administrar integrações
        </Link>
      </div>
      <div aria-live="polite">
        {aviso && <InlineNotification kind="warning" title="Aviso" subtitle={aviso} lowContrast hideCloseButton />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Tile style={{ width: '16rem' }}>
          <Stack gap={3}>
            <img src="/static/icons/google.svg" alt="" width={40} height={40} />
            <h3>Google</h3>
            <p>Drive do escritório (conta institucional).</p>
            <Selo status={googleStatus} />
          </Stack>
        </Tile>
        <Tile style={{ width: '16rem' }}>
          <Stack gap={3}>
            <img src="/static/icons/asaas.png" alt="" width={40} height={40} />
            <h3>Asaas</h3>
            <p>Cobranças e boletos. Veja em Financeiro &gt; Pagamentos.</p>
            <Selo status={asaasStatus} />
          </Stack>
        </Tile>
        <Tile style={{ width: '16rem' }}>
          <Stack gap={3}>
            <img src="/static/icons/zapsign.svg" alt="" width={40} height={40} />
            <h3>ZapSign</h3>
            <p>Assinatura digital de documentos.</p>
            <Selo status={zapsignStatus} />
          </Stack>
        </Tile>
        <Tile style={{ width: '16rem' }}>
          <Stack gap={3}>
            <h3>Minha agenda Google</h3>
            <p>Conecte sua conta individual para criar eventos no seu calendário.</p>
            <p role="status">{agendaStatus}</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button kind="tertiary" size="sm" onClick={() => minhaAgendaGoogle('conectar')}>
                Conectar minha agenda
              </Button>
              <Button kind="ghost" size="sm" onClick={() => minhaAgendaGoogle('desconectar')}>
                Desconectar minha agenda
              </Button>
              <Button kind="ghost" size="sm" onClick={() => minhaAgendaGoogle('status')}>
                Verificar conexão
              </Button>
            </div>
          </Stack>
        </Tile>
      </div>
    </Stack>
  )
}
