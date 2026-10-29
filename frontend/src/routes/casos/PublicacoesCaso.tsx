import { useCallback, useEffect, useState } from 'react'
import { Button, InlineLoading, InlineNotification, Modal, Stack, Tile } from '@carbon/react'
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
    <Stack gap={5}>
      <h3>Publicações vinculadas</h3>
      <div aria-live="polite">
        {carregando && <InlineLoading description="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && publicacoes && publicacoes.length === 0 && (
          <InlineNotification kind="info" title="Nenhuma publicação vinculada a este processo." lowContrast hideCloseButton />
        )}
        {!carregando && publicacoes && publicacoes.length > 0 && (
          <Stack gap={3}>
            {publicacoes.map((pub) => {
              const texto = pub.dados?.texto || pub.dados?.teor || pub.dados?.conteudo || ''
              return (
                <Tile key={pub.hash}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                    <div>
                      <strong>{pub.numero_processo || pub.nome_pesquisado || 'Publicação'}</strong>{' '}
                      <span>{(pub.criado_em ?? '').substring(0, 10)}</span>
                    </div>
                    <Button kind="ghost" size="sm" onClick={() => setParaDesvincular(pub)}>
                      Desvincular
                    </Button>
                  </div>
                  {texto && <p>{texto.length > 300 ? `${texto.slice(0, 300)}…` : texto}</p>}
                </Tile>
              )
            })}
          </Stack>
        )}
      </div>
      <Modal
        open={paraDesvincular !== null}
        danger
        modalHeading="Desvincular publicação"
        primaryButtonText="Desvincular"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={desvinculando}
        onRequestClose={() => setParaDesvincular(null)}
        onRequestSubmit={confirmarDesvincular}
      >
        <p>Desvincular esta publicação do processo?</p>
      </Modal>
    </Stack>
  )
}
