import Carregamento from '../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { Button, InlineNotification, Modal, Stack, Tile } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarNumeroCNJ } from '../utils/formatadores'
import { formatarData } from '../utils/listasRapidas'

type CriterioMonitoramento = {
  numero_processo?: string
  numero_oab?: string
  uf_oab?: string
}

type Monitoramento = {
  id: string
  criterio?: CriterioMonitoramento
  criado_em?: string
  expira_em?: string
}

type RespostaMonitoramentos = {
  erro?: boolean
  mensagem?: string
  monitoramentos?: Monitoramento[]
}

function descreverCriterio(criterio: CriterioMonitoramento): string {
  if (criterio.numero_processo) return `Processo ${formatarNumeroCNJ(criterio.numero_processo)}`
  return `OAB ${criterio.numero_oab}/${criterio.uf_oab ?? '?'}`
}

export default function Monitoramentos() {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [lista, setLista] = useState<Monitoramento[] | null>(null)
  const [carregadoEm, setCarregadoEm] = useState<string | null>(null)
  const [paraRemover, setParaRemover] = useState<Monitoramento | null>(null)
  const [removendo, setRemovendo] = useState(false)

  const carregar = useCallback(async () => {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      const dados = (await cliente.chamarFerramenta('listar_monitoramentos', {})) as RespostaMonitoramentos
      if (dados.erro) {
        setErro(dados.mensagem ?? 'Não foi possível carregar.')
        setLista(null)
        return
      }
      setLista(dados.monitoramentos ?? [])
      setCarregadoEm(new Date().toLocaleString('pt-BR'))
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
      setLista(null)
    } finally {
      setCarregando(false)
    }
  }, [cliente])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function confirmarRemocao() {
    if (!cliente || !paraRemover) return
    setRemovendo(true)
    try {
      await cliente.chamarFerramenta('remover_monitoramento', { id: paraRemover.id })
      setParaRemover(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao remover.')
    } finally {
      setRemovendo(false)
    }
  }

  return (
    <Stack gap={6}>
      <div>
        <h1>Monitoramentos</h1>
        <p>
          Os avisos por e-mail são verificados a cada 6 horas, quando o envio de e-mail está configurado no servidor. A
          captura de publicações por OAB para o painel "Publicações monitoradas" ocorre separadamente, a cada 24 horas.
          Falhas de conexão podem adiar as verificações.
        </p>
      </div>
      <div>
        <Button kind="ghost" size="sm" onClick={carregar} disabled={carregando}>
          Atualizar lista
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <Carregamento tipo="cartoes" descricao="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && !erro && lista && (
          <Stack gap={5}>
            <p>Lista carregada em {carregadoEm}. Atualizar esta lista não dispara uma verificação no DJEN.</p>
            {lista.length === 0 && (
              <InlineNotification
                kind="info"
                title="Nenhum monitoramento ativo"
                subtitle="Use a ação de monitoramento em Consultar processo ou Consultar publicações para criar um."
                lowContrast
                hideCloseButton
              />
            )}
            {lista.map((m) => (
              <Tile key={m.id}>
                <Stack gap={3}>
                  <h3>{descreverCriterio(m.criterio ?? {})}</h3>
                  <p>Criado em {formatarData(m.criado_em)}</p>
                  <p>Expira em {formatarData(m.expira_em)} se não houver publicação nova antes</p>
                  <div>
                    <Button kind="danger--tertiary" size="sm" onClick={() => setParaRemover(m)}>
                      Remover
                    </Button>
                  </div>
                </Stack>
              </Tile>
            ))}
          </Stack>
        )}
      </div>
      <Modal closeButtonLabel="Fechar"
        open={paraRemover !== null}
        danger
        modalHeading="Remover monitoramento"
        primaryButtonText="Remover"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={removendo}
        onRequestClose={() => setParaRemover(null)}
        onRequestSubmit={confirmarRemocao}
      >
        <p>
          O escritório deixará de receber alertas por e-mail para este processo. Esta ação não pode ser desfeita.
        </p>
      </Modal>
    </Stack>
  )
}
