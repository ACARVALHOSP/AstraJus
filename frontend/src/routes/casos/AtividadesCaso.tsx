import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, InlineLoading, InlineNotification, Modal, Stack } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'
import AtividadeModal from './AtividadeModal'
import AgendaAtividade, { type VinculoAgenda } from './AgendaAtividade'

export type Atividade = {
  id: string
  tipo: string
  titulo: string
  status: string
  data?: string | null
  hora?: string | null
  responsavel?: string | null
  observacoes?: string | null
  agenda?: VinculoAgenda | null
  agenda_institucional_anterior?: boolean
}

const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

export default function AtividadesCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atividades, setAtividades] = useState<Atividade[] | null>(null)
  const [agendaDisponivel, setAgendaDisponivel] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Atividade | null>(null)
  const [paraExcluir, setParaExcluir] = useState<Atividade | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro(null)
    buscarJson<{ atividades: Atividade[]; agenda_disponivel?: boolean }>(cliente, `/casos/${casoId}/atividades`)
      .then((r) => {
        setAtividades(r.atividades ?? [])
        setAgendaDisponivel(Boolean(r.agenda_disponivel))
      })
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }, [cliente, casoId])

  useEffect(carregar, [carregar])

  async function alternarConcluida(atv: Atividade, concluida: boolean) {
    const novoStatus = concluida ? 'concluida' : 'pendente'
    setAtividades((atual) => atual?.map((a) => (a.id === atv.id ? { ...a, status: novoStatus } : a)) ?? null)
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${atv.id}`, { status: novoStatus }, 'PATCH')
    } catch (e) {
      setAtividades((atual) => atual?.map((a) => (a.id === atv.id ? { ...a, status: atv.status } : a)) ?? null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar.')
    }
  }

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${paraExcluir.id}`, {}, 'DELETE')
      setParaExcluir(null)
      carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <Stack gap={5}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Atividades</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditando(null)
            setModalAberto(true)
          }}
        >
          Nova atividade
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <InlineLoading description="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && atividades && atividades.length === 0 && <InlineNotification kind="info" title="Nenhuma atividade cadastrada" lowContrast hideCloseButton />}
        {!carregando && atividades && atividades.length > 0 && (
          <Stack gap={4}>
            {atividades.map((atv) => (
              <div key={atv.id} className="cds--tile" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <Checkbox
                    id={`atividade-concluida-${atv.id}`}
                    labelText={formatarNomeExibicao(atv.titulo)}
                    checked={atv.status === 'concluida'}
                    onChange={(_e, { checked }) => alternarConcluida(atv, checked)}
                  />
                  <p>
                    {ROTULO_TIPO[atv.tipo] ?? atv.tipo}
                    {atv.data ? ` · ${formatarDataSimples(atv.data)}` : ''}
                    {atv.hora ? ` · ${atv.hora}` : ''}
                  </p>
                  {atv.responsavel && <p>Responsável: {formatarNomeExibicao(atv.responsavel)}</p>}
                  {atv.observacoes && <p>{atv.observacoes}</p>}
                  {(atv.agenda || agendaDisponivel) && (
                    <AgendaAtividade
                      casoId={casoId}
                      atividadeId={atv.id}
                      titulo={atv.titulo}
                      data={atv.data}
                      hora={atv.hora}
                      agenda={atv.agenda}
                      agendaInstitucionalAnterior={atv.agenda_institucional_anterior}
                      agendaDisponivel={agendaDisponivel}
                      onAtualizado={carregar}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      setEditando(atv)
                      setModalAberto(true)
                    }}
                  >
                    Editar
                  </Button>
                  <Button kind="ghost" size="sm" hasIconOnly iconDescription="Excluir atividade" onClick={() => setParaExcluir(atv)}>
                    ✕
                  </Button>
                </div>
              </div>
            ))}
          </Stack>
        )}
      </div>
      <AtividadeModal
        open={modalAberto}
        casoId={casoId}
        atividade={editando}
        onClose={() => setModalAberto(false)}
        onSalva={() => {
          setModalAberto(false)
          carregar()
        }}
      />
      <Modal
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir atividade"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir "{paraExcluir?.titulo}"?</p>
      </Modal>
    </Stack>
  )
}
