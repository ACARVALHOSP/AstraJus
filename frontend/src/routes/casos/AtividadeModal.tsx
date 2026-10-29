import { useEffect, useState } from 'react'
import { InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import type { Atividade } from './AtividadesCaso'

const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

export default function AtividadeModal({
  open,
  casoId,
  atividade,
  onClose,
  onSalva,
}: {
  open: boolean
  casoId: string
  atividade: Atividade | null
  onClose: () => void
  onSalva: () => void
}) {
  const { cliente } = useCliente()
  const [tipo, setTipo] = useState('tarefa')
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [responsaveis, setResponsaveis] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTipo(atividade?.tipo ?? 'tarefa')
    setTitulo(atividade?.titulo ?? '')
    setData(atividade?.data ?? '')
    setHora(atividade?.hora ?? '')
    setResponsavel(atividade?.responsavel ?? '')
    setObservacoes(atividade?.observacoes ?? '')
    setErro(null)
    buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis')
      .then((r) => setResponsaveis(r.responsaveis ?? []))
      .catch(() => {
        // segue com o responsável já salvo, se houver
      })
  }, [open, atividade, cliente])

  const opcoesResponsavel = [...new Set([...responsaveis, atividade?.responsavel].filter((v): v is string => Boolean(v)))]

  async function salvar() {
    if (!titulo.trim()) {
      setErro('Informe o título.')
      return
    }
    setSalvando(true)
    setErro(null)
    const corpo = {
      tipo,
      titulo: titulo.trim(),
      data: data || null,
      hora: hora || null,
      responsavel: responsavel || null,
      observacoes: observacoes.trim() || null,
    }
    try {
      if (atividade) await enviarJson(cliente, `/casos/${casoId}/atividades/${atividade.id}`, corpo, 'PATCH')
      else await enviarJson(cliente, `/casos/${casoId}/atividades`, corpo)
      onSalva()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={open}
      modalHeading={atividade ? 'Editar atividade' : 'Nova atividade'}
      primaryButtonText="Salvar"
      secondaryButtonText="Cancelar"
      primaryButtonDisabled={salvando}
      onRequestClose={onClose}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        <Select id="atividade-tipo" labelText="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
            <SelectItem key={valor} value={valor} text={rotulo} />
          ))}
        </Select>
        <TextInput id="atividade-titulo" labelText="Título" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <TextInput id="atividade-data" type="date" labelText="Data" value={data} onChange={(e) => setData(e.target.value)} />
        <TextInput id="atividade-hora" type="time" labelText="Hora" value={hora} onChange={(e) => setHora(e.target.value)} />
        <Select id="atividade-responsavel" labelText="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
          <SelectItem value="" text="Eu mesmo" />
          {opcoesResponsavel.map((nome) => (
            <SelectItem key={nome} value={nome} text={nome} />
          ))}
        </Select>
        <TextInput id="atividade-observacoes" labelText="Observações" autoComplete="off" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </Stack>
    </Modal>
  )
}
