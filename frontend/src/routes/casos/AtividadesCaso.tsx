import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertDialog, Box, Button, Callout, Card, Checkbox, Flex, Heading, Text } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
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

export default function AtividadesCaso({ casoId, atividadeInicialId }: { casoId: string; atividadeInicialId?: string | number }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atividades, setAtividades] = useState<Atividade[] | null>(null)
  const [agendaDisponivel, setAgendaDisponivel] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Atividade | null>(null)
  const [paraExcluir, setParaExcluir] = useState<Atividade | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const destinoConsumido = useRef(false)

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

  useEffect(() => {
    if (atividadeInicialId == null || !atividades || carregando || destinoConsumido.current) return
    destinoConsumido.current = true
    const atividade = atividades.find(item => String(item.id) === String(atividadeInicialId))
    if (!atividade) {
      setErro('A atividade desta notificação não está mais disponível. Atualize as notificações.')
      return
    }
    setEditando(atividade)
    setModalAberto(true)
  }, [atividadeInicialId, atividades, carregando])

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
    <Flex direction="column" gap="5">
      <div className="casos-titulo-linha">
        <Heading as="h3" size="3">Atividades</Heading>
        <Button size="2" onClick={() => { setEditando(null); setModalAberto(true) }}>
          Nova atividade
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <Carregamento tipo="cartoes" descricao="Carregando…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && atividades && atividades.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhuma atividade cadastrada.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && atividades && atividades.length > 0 && (
          <Flex direction="column" gap="4">
            {atividades.map((atv) => (
              <Card key={atv.id} variant="surface">
                <Flex justify="between" gap="4" wrap="wrap">
                  <Box>
                    <Text as="label" size="2">
                      <Flex gap="2" align="center">
                        <Checkbox
                          checked={atv.status === 'concluida'}
                          onCheckedChange={(checked) => alternarConcluida(atv, Boolean(checked))}
                        />
                        {formatarNomeExibicao(atv.titulo)}
                      </Flex>
                    </Text>
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
                  </Box>
                  <AcoesTabela rotulo={atv.titulo} acoes={[
                    { texto: 'Editar', executar: () => { setEditando(atv); setModalAberto(true) } },
                    { texto: 'Excluir', executar: () => setParaExcluir(atv), perigo: true },
                  ]} />
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </div>
      <AtividadeModal
        open={modalAberto}
        casoId={casoId}
        atividade={editando}
        onClose={() => setModalAberto(false)}
        onSalva={() => { setModalAberto(false); carregar() }}
      />
      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir atividade</AlertDialog.Title>
          <AlertDialog.Description>Excluir "{paraExcluir?.titulo}"?</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={excluindo} onClick={confirmarExclusao}>Excluir</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
