import { useState } from 'react'
import { Badge, Flex, Select, Text } from '@radix-ui/themes'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { COR_POLO, ROTULO_POLO, type Polo, type PoloCliente } from '../../utils/polos'

/** Cabeçalho do processo: em que polo cada cliente está. O sistema deduz pela capa e pelas
 *  publicações; aqui dá para corrigir (ou voltar ao automático). */
export default function PoloClientes({ casoId, polos: iniciais, podeEditar }: { casoId: string; polos?: PoloCliente[]; podeEditar: boolean }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const [local, setPolos] = useState<PoloCliente[] | null>(null)
  const polos = local ?? iniciais ?? []
  const [salvando, setSalvando] = useState('')

  async function mudar(clienteId: string, valor: string) {
    setSalvando(clienteId)
    try {
      const r = await enviarJson<{ polos: PoloCliente[] }>(cliente, `/casos/${encodeURIComponent(casoId)}/polos`, { cliente_id: clienteId, polo: valor === 'auto' ? null : valor }, 'PUT')
      setPolos(r.polos)
      avisar({ texto: valor === 'auto' ? 'Polo voltou a ser deduzido automaticamente.' : 'Polo do cliente atualizado.' })
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível salvar o polo.' })
    } finally { setSalvando('') }
  }
  if (!polos.length) return null
  return (
    <Flex direction="column" gap="1" className="casos-polos" aria-label="Posição do cliente no processo">
      {polos.map(p => (
        <Flex key={p.cliente_id} align="center" gap="2" wrap="wrap">
          <Text size="2">Cliente: <strong>{formatarNomeExibicao(p.nome)}</strong></Text>
          {podeEditar ? (
            <Select.Root size="1" value={p.origem === 'manual' && p.polo ? p.polo : 'auto'} disabled={salvando === p.cliente_id} onValueChange={(v) => void mudar(p.cliente_id, v)}>
              <Select.Trigger aria-label={`Posição de ${p.nome} no processo`} />
              <Select.Content>
                <Select.Item value="auto">{p.origem === 'automatico' && p.polo ? `Automático: ${ROTULO_POLO[p.polo].toLowerCase()}` : 'Automático (sem informação)'}</Select.Item>
                {(Object.keys(ROTULO_POLO) as Polo[]).map(k => <Select.Item key={k} value={k}>{ROTULO_POLO[k]}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          ) : p.polo ? <Badge color={COR_POLO[p.polo]} variant="soft">{ROTULO_POLO[p.polo]}</Badge> : <Text size="2" color="gray">posição não informada</Text>}
        </Flex>
      ))}
    </Flex>
  )
}
