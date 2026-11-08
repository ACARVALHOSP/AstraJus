import { useState } from 'react'
import { Button, Flex, Text } from '@radix-ui/themes'
import { ExternalLink, FolderPlus } from 'lucide-react'
import { useCliente } from './api/ClienteContext'
import { ErroMCP } from './api/mcpClient'
import { enviarJson } from './api/rest'
import { useAvisos } from './Avisos'

/** Pasta do Google Drive de um processo ou de um contato: abre a pasta ou cria quando falta.
 *  A estrutura é CLIENTES / <cliente> / <processo>. */
export default function PastaDrive({ tipo, id, pastaId, onCriada }: {
  tipo: 'casos' | 'clientes'; id: string; pastaId?: string | null; onCriada: (pastaId: string) => void
}) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const [criando, setCriando] = useState(false)
  const rotulo = tipo === 'casos' ? 'do processo' : 'do cliente'

  async function criar() {
    setCriando(true)
    try {
      const r = await enviarJson<{ drive_pasta_id: string }>(cliente, `/${tipo}/${encodeURIComponent(id)}/pasta-drive`, {})
      onCriada(r.drive_pasta_id)
      avisar({ texto: `Pasta ${rotulo} criada no Google Drive.` })
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível criar a pasta no Google Drive.' })
    } finally {
      setCriando(false)
    }
  }

  return (
    <Flex align="center" gap="3" wrap="wrap">
      <Text size="2" weight="medium">Pasta {rotulo} no Drive</Text>
      {pastaId
        ? <Button asChild variant="soft" size="1"><a href={`https://drive.google.com/drive/folders/${encodeURIComponent(pastaId)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />Abrir pasta<Text className="aj-sr-only"> (abre em nova aba)</Text></a></Button>
        : <Button type="button" variant="soft" size="1" loading={criando} onClick={() => void criar()}><FolderPlus size={13} aria-hidden="true" />Criar pasta no Drive</Button>}
    </Flex>
  )
}
