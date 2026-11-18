import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertDialog, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes'
import { Inbox } from 'lucide-react'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { useNomePessoa, useRascunhos, type Rascunho } from '../../api/consultas'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'

/** Processos que o sistema criou sozinho a partir de publicações (autocadastro) e que esperam confirmação. Some quando não há nenhum. */
export default function ProcessosAConfirmar({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const nomePessoa = useNomePessoa()
  const queryClient = useQueryClient()
  const consulta = useRascunhos()
  const [ocupado, setOcupado] = useState(false)
  const [descartar, setDescartar] = useState<Rascunho | null>(null)
  const lista = consulta.data ?? []
  if (!lista.length) return null

  async function decidir(r: Rascunho, acao: 'confirmar' | 'descartar') {
    if (ocupado) return
    setOcupado(true)
    try {
      await enviarJson(cliente, `/rascunhos/${encodeURIComponent(r.id)}/${acao}`, {}, 'POST')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['rascunhos'] }), queryClient.invalidateQueries({ queryKey: ['casos'] })])
      avisar({ texto: acao === 'confirmar' ? 'Processo confirmado.' : 'Rascunho descartado; a publicação voltou à fila.' })
    } catch (e) {
      avisar({ tipo: 'erro', texto: (e as Error).message })
      await queryClient.invalidateQueries({ queryKey: ['rascunhos'] })
    } finally { setOcupado(false) }
  }

  return (
    <Card variant="surface" role="region" aria-label="Processos a confirmar">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2"><Inbox size={16} aria-hidden="true" /><Heading as="h2" size="3">Processos a confirmar ({lista.length})</Heading></Flex>
        <Text as="p" size="2" color="gray">Criados automaticamente a partir de publicações em que um cliente do escritório foi reconhecido. Ficam fora das listas e dos alertas até você confirmar.</Text>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lista.map(r => (
            <li key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--gray-5)' }}>
              <Flex justify="between" align="center" gap="3" wrap="wrap">
                <div>
                  <Text as="div" size="2" weight="bold">{formatarNomeExibicao(r.titulo) || 'Processo sem título'}</Text>
                  <Text as="div" size="1" color="gray">
                    {r.processos.map(formatarNumeroCNJ).join(', ')} · Cliente: {r.cliente}{r.motivo ? ` (${r.motivo})` : ''}
                    {r.responsavel ? ` · Responsável: ${nomePessoa(r.responsavel)}` : ' · Sem responsável'}
                  </Text>
                </div>
                <Flex gap="2">
                  <Button size="1" variant="soft" color="gray" disabled={ocupado} onClick={() => onAbrir(r.id)}>Abrir</Button>
                  <Button size="1" disabled={ocupado} onClick={() => void decidir(r, 'confirmar')}>Confirmar</Button>
                  <Button size="1" variant="soft" color="red" disabled={ocupado} onClick={() => setDescartar(r)}>Descartar</Button>
                </Flex>
              </Flex>
            </li>
          ))}
        </ul>
        {consulta.error && <Callout.Root color="red" size="1"><Callout.Text>Não foi possível atualizar a lista.</Callout.Text></Callout.Root>}
      </Flex>
      <AlertDialog.Root open={descartar !== null} onOpenChange={o => { if (!o && !ocupado) setDescartar(null) }}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Descartar este rascunho?</AlertDialog.Title>
          <AlertDialog.Description>O processo criado é apagado e a publicação volta à fila para tratamento manual. O sistema não cria este processo de novo sozinho.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
            <Button color="red" disabled={ocupado} onClick={() => { const r = descartar; setDescartar(null); if (r) void decidir(r, 'descartar') }}>Descartar</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Card>
  )
}
