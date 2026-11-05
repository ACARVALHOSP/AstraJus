import Carregamento from '../../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { AlertDialog, Button, Callout, Card, Flex, Text } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'

type PublicacaoCaso = {
  hash: string
  numero_processo?: string
  nome_pesquisado?: string
  criado_em?: string
  dados?: { texto?: string; teor?: string; conteudo?: string }
}

export default function PublicacoesCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [publicacoes, setPublicacoes] = useState<PublicacaoCaso[] | null>(null)
  const [paraDesvincular, setParaDesvincular] = useState<PublicacaoCaso | null>(null)
  const [desvinculando, setDesvinculando] = useState(false)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro(null)
    buscarJson<{ publicacoes: PublicacaoCaso[] }>(cliente, `/casos/${casoId}/publicacoes`)
      .then((r) => setPublicacoes(r.publicacoes ?? []))
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }, [cliente, casoId])

  useEffect(carregar, [carregar])

  async function confirmarDesvincular() {
    if (!paraDesvincular) return
    setDesvinculando(true)
    try {
      await enviarJson(cliente, `/casos/${casoId}/publicacoes/${paraDesvincular.hash}`, {}, 'DELETE')
      setParaDesvincular(null)
      carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao desvincular.')
    } finally {
      setDesvinculando(false)
    }
  }

  return (
    <Flex direction="column" gap="4">
      <h3>Publicações vinculadas</h3>
      <div aria-live="polite">
        {carregando && <Carregamento tipo="cartoes" descricao="Carregando…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && publicacoes && publicacoes.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhuma publicação vinculada a este processo.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && publicacoes && publicacoes.length > 0 && (
          <Flex direction="column" gap="2">
            {publicacoes.map((pub) => {
              const texto = pub.dados?.texto || pub.dados?.teor || pub.dados?.conteudo || ''
              return (
                <Card key={pub.hash} size="1">
                  <div className="casos-publicacao-linha">
                    <div>
                      <Text size="2" weight="medium">{pub.numero_processo || pub.nome_pesquisado || 'Publicação'}</Text>{' '}
                      <Text size="2" color="gray">{(pub.criado_em ?? '').substring(0, 10)}</Text>
                    </div>
                    <Button variant="ghost" size="1" onClick={() => setParaDesvincular(pub)}>
                      Desvincular
                    </Button>
                  </div>
                  {texto && <Text as="p" size="2" mt="1">{texto.length > 300 ? `${texto.slice(0, 300)}…` : texto}</Text>}
                </Card>
              )
            })}
          </Flex>
        )}
      </div>
      <AlertDialog.Root open={paraDesvincular !== null} onOpenChange={(open) => !open && setParaDesvincular(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Desvincular publicação</AlertDialog.Title>
          <AlertDialog.Description>Desvincular esta publicação do processo?</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={desvinculando} onClick={confirmarDesvincular}>Desvincular</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
