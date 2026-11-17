import { useCallback, useEffect, useState } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { useCliente } from './api/ClienteContext'
import { buscarJson, enviarJson } from './api/rest'

type Resposta = { erro?: string; url?: string; conectado?: boolean; desconectado?: boolean }

/** Conexão da agenda Google individual da pessoa conectada (eventos das atividades no calendário dela). */
export default function MinhaAgendaGoogle() {
  const { cliente } = useCliente()
  const [status, setStatus] = useState('Verificando a conexão…')
  const [ocupado, setOcupado] = useState(false)

  const acao = useCallback(async (a: 'conectar' | 'desconectar' | 'status') => {
    setOcupado(true)
    try {
      if (!cliente) throw new Error('Conecte-se na aba Acesso.')
      const bruto: unknown = a === 'status'
        ? await buscarJson<unknown>(cliente, '/integracoes/calendar/status')
        : await enviarJson<unknown>(cliente, '/integracoes/calendar/' + a, {})
      const dados: Resposta | null = bruto && typeof bruto === 'object' ? (bruto as Resposta) : null
      if (!dados) throw new Error('Resposta inesperada do servidor. Tente novamente.')
      if (dados.url) {
        if (new URL(dados.url).origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.')
        window.open(dados.url, '_blank', 'noopener')
        setStatus('Conclua o consentimento na aba Google e depois clique em "Verificar conexão".')
      } else if (a === 'desconectar') setStatus('Sua agenda foi desconectada.')
      else if (typeof dados.conectado === 'boolean') setStatus(dados.conectado ? 'Sua agenda está conectada.' : 'Sua agenda está desconectada.')
      else throw new Error('Resposta inesperada do servidor. Tente novamente.')
    } catch (e) {
      setStatus((e as Error).message)
    } finally { setOcupado(false) }
  }, [cliente])

  useEffect(() => { if (cliente) void acao('status') }, [cliente, acao])

  return (
    <Flex direction="column" gap="2">
      <Text as="p" size="2">Conecte sua conta individual para criar eventos no seu calendário.</Text>
      <Text as="p" size="2" color="gray" role="status">{status}</Text>
      <Flex gap="2" wrap="wrap">
        <Button type="button" variant="soft" size="1" disabled={ocupado} onClick={() => void acao('conectar')}>Conectar minha agenda</Button>
        <Button type="button" variant="ghost" size="1" disabled={ocupado} onClick={() => void acao('desconectar')}>Desconectar minha agenda</Button>
        <Button type="button" variant="ghost" size="1" disabled={ocupado} onClick={() => void acao('status')}>Verificar conexão</Button>
      </Flex>
    </Flex>
  )
}
