import { useState } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { useCliente } from './api/ClienteContext'

/** Conexão da agenda Google individual da pessoa conectada (eventos das atividades no calendário dela). */
export default function MinhaAgendaGoogle() {
  const { cliente } = useCliente()
  const [status, setStatus] = useState('Verifique a conexão antes de usar.')
  const [ocupado, setOcupado] = useState(false)

  async function acao(a: 'conectar' | 'desconectar' | 'status') {
    setOcupado(true)
    try {
      if (!cliente) throw new Error('Conecte-se na aba Acesso.')
      const r = await fetch('/integracoes/calendar/' + a, { method: a === 'status' ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + cliente.token } })
      const dados = (await r.json()) as { erro?: string; url?: string; conectado?: boolean }
      if (!r.ok) throw new Error(dados.erro || 'Não foi possível atualizar a agenda.')
      if (dados.url) {
        if (new URL(dados.url).origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.')
        window.open(dados.url, '_blank', 'noopener')
        setStatus('Conclua o consentimento na aba Google e verifique a conexão ao retornar.')
      } else setStatus(dados.conectado ? 'Sua agenda está conectada.' : 'Sua agenda está desconectada.')
    } catch (e) {
      setStatus((e as Error).message)
    } finally { setOcupado(false) }
  }

  return (
    <Flex direction="column" gap="2">
      <Text as="p" size="2">Conecte sua conta individual para criar eventos no seu calendário.</Text>
      <Text as="p" size="2" color="gray" role="status">{status}</Text>
      <Flex gap="2" wrap="wrap">
        <Button variant="soft" size="1" disabled={ocupado} onClick={() => void acao('conectar')}>Conectar minha agenda</Button>
        <Button variant="ghost" size="1" disabled={ocupado} onClick={() => void acao('desconectar')}>Desconectar minha agenda</Button>
        <Button variant="ghost" size="1" disabled={ocupado} onClick={() => void acao('status')}>Verificar conexão</Button>
      </Flex>
    </Flex>
  )
}
