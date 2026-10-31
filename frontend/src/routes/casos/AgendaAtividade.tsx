import { useRef, useState } from 'react'
import { Button, Link, Modal } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { formatarDataSimples } from '../../utils/formatadores'

export type VinculoAgenda = {
  id: string
  versao: number
  estado: 'pendente' | 'sincronizado' | 'divergente' | 'cancelamento_pendente' | 'cancelado' | 'falha'
  erro?: string
  titulo_remoto?: string
  data_remota?: string
  link?: string
}

const ROTULO_ESTADO: Record<string, string> = {
  pendente: 'Sincronização pendente',
  sincronizado: 'Sincronizado',
  divergente: 'Dados diferentes na agenda',
  cancelamento_pendente: 'Cancelamento pendente',
  cancelado: 'Evento cancelado; atividade preservada',
  falha: 'Não foi possível confirmar a operação',
}

export default function AgendaAtividade({
  casoId,
  atividadeId,
  titulo,
  data,
  hora,
  agenda,
  agendaInstitucionalAnterior,
  agendaDisponivel,
  onAtualizado,
}: {
  casoId: string
  atividadeId: string
  titulo: string
  data?: string | null
  hora?: string | null
  agenda?: VinculoAgenda | null
  agendaInstitucionalAnterior?: boolean
  agendaDisponivel: boolean
  onAtualizado: () => void
}) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(false)
  const [confirmacao, setConfirmacao] = useState<{ metodo: 'POST' | 'PATCH' | 'DELETE'; comando?: string; texto: string } | null>(null)
  const chaveIdempotencia = useRef<string | null>(null)

  const ativo = agenda && agenda.estado !== 'cancelado'

  async function executar(metodo: 'POST' | 'PATCH' | 'DELETE', comando?: string, confirmado = false) {
    const texto = metodo === 'DELETE' ? 'Cancelar o evento na agenda? A atividade será preservada.' : metodo === 'PATCH' ? (comando === 'aceitar_data_da_agenda' ? 'Usar a data e o título da agenda nesta atividade?' : 'Substituir a data e o título do evento pelos dados desta atividade?') : comando === 'reconciliar_institucional' ? 'Associar o vínculo institucional à sua agenda individual? A conta Google precisa ser a mesma; o evento será preservado.' : ''
    if (texto && !confirmado) { setConfirmacao({ metodo, comando, texto }); return }
    setCarregando(true)
    try {
      let corpo: Record<string, unknown> = {}
      const cabecalhos: Record<string, string> = {}
      if (metodo === 'POST') {
        if (comando === 'reconciliar_institucional') corpo = { reconciliar_institucional: true }
        if (!chaveIdempotencia.current) chaveIdempotencia.current = crypto.randomUUID()
        cabecalhos['Idempotency-Key'] = chaveIdempotencia.current
      } else {
        corpo = { vinculo_id: agenda?.id, versao: agenda?.versao, ...(comando ? { comando } : {}) }
      }
      if (!cliente) return
      await fetch(`/casos/${casoId}/atividades/${atividadeId}/agenda`, {
        method: metodo,
        headers: { Authorization: `Bearer ${cliente.token}`, 'Content-Type': 'application/json', ...cabecalhos },
        body: JSON.stringify(corpo),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.mensagem || `HTTP ${r.status}`)
      })
      onAtualizado()
    } catch {
      // erro mostrado via recarregamento; o estado "falha" vem refletido no próximo GET
      onAtualizado()
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div data-agenda-atividade={atividadeId}>
      <Modal closeButtonLabel="Fechar" open={confirmacao !== null} modalHeading="Confirmar alteração na agenda" primaryButtonText={confirmacao?.metodo === 'DELETE' ? 'Cancelar evento' : 'Confirmar'} secondaryButtonText="Voltar" danger={confirmacao?.metodo === 'DELETE'} onRequestClose={() => setConfirmacao(null)} onRequestSubmit={() => { if (!confirmacao) return; const { metodo, comando } = confirmacao; setConfirmacao(null); void executar(metodo, comando, true) }}>
        <p>{confirmacao?.texto}</p>
      </Modal>
      {agenda && <p>Agenda: {ROTULO_ESTADO[agenda.estado] ?? agenda.estado}</p>}
      {agenda?.erro && <p>{agenda.erro}</p>}
      {agenda?.estado === 'divergente' && (
        <p>
          Na agenda: {agenda.titulo_remoto || 'Sem título'} · {agenda.data_remota ? formatarDataSimples(agenda.data_remota) : 'Evento sem data de dia inteiro'}
        </p>
      )}
      {!agendaDisponivel && <p>Conecte sua agenda individual em Integrações e atualize as atividades.</p>}
      <div className="aj-layout-16">
        {agendaInstitucionalAnterior ? (
          <>
            <p>Vínculo institucional anterior preservado. Reconcilie usando a conta Google original.</p>
            {agendaDisponivel && (
              <Button kind="ghost" size="sm" disabled={carregando} onClick={() => executar('POST', 'reconciliar_institucional')}>
                Reconciliar vínculo institucional
              </Button>
            )}
          </>
        ) : ativo ? (
          <>
            <Button kind="ghost" size="sm" disabled={carregando} aria-label={`Atualizar agenda: ${titulo}`} onClick={() => executar('POST')}>
              Atualizar agenda
            </Button>
            {agenda?.estado === 'divergente' && (
              <>
                <Button kind="ghost" size="sm" disabled={carregando} onClick={() => executar('PATCH', 'usar_data_da_atividade')}>
                  Manter dados da atividade
                </Button>
                <Button kind="ghost" size="sm" disabled={carregando} onClick={() => executar('PATCH', 'aceitar_data_da_agenda')}>
                  Usar data e título da agenda
                </Button>
              </>
            )}
            <Button kind="ghost" size="sm" disabled={carregando} onClick={() => executar('DELETE')}>
              Cancelar evento
            </Button>
          </>
        ) : agendaDisponivel && data && !hora ? (
          <Button kind="ghost" size="sm" disabled={carregando} onClick={() => executar('POST')}>
            Vincular à agenda
          </Button>
        ) : agendaDisponivel ? (
          <p>Para vincular à agenda, informe uma data e deixe a hora vazia.</p>
        ) : null}
        {agenda?.link && (
          <Link href={agenda.link} target="_blank" rel="noopener">
            Abrir no Google Calendar
          </Link>
        )}
      </div>
    </div>
  )
}
