import { useEffect, useState } from 'react'
import { Button, Callout, Dialog, Flex, Select, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import type { Atividade } from './AtividadesCaso'
import ChecklistAtividade from './ChecklistAtividade'

const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

export default function AtividadeModal({
  open, casoId, atividade, onClose, onSalva,
}: {
  open: boolean; casoId: string; atividade: Atividade | null; onClose: () => void; onSalva: () => void
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
      .catch(() => {})
  }, [open, atividade, cliente])

  const opcoesResponsavel = [...new Set([...responsaveis, atividade?.responsavel].filter((v): v is string => Boolean(v)))]

  async function salvar() {
    if (!titulo.trim()) { setErro('Informe o título.'); return }
    setSalvando(true)
    setErro(null)
    const corpo = {
      tipo, titulo: titulo.trim(), data: data || null, hora: hora || null,
      responsavel: responsavel || null, observacoes: observacoes.trim() || null,
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
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{atividade ? 'Editar atividade' : 'Nova atividade'}</Dialog.Title>
        <Flex direction="column" gap="3">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="atividade-titulo">Título</label>
            <TextField.Root id="atividade-titulo" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="casos-formulario-grade">
            <div className="form-campo">
              <label className="form-campo-label">Tipo</label>
              <Select.Root value={tipo} onValueChange={setTipo}>
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                    <Select.Item key={valor} value={valor}>{rotulo}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="atividade-data">Data</label>
              <TextField.Root id="atividade-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="atividade-hora">Hora</label>
              <TextField.Root id="atividade-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label">Responsável</label>
              <Select.Root value={responsavel || '__none__'} onValueChange={(v) => setResponsavel(v === '__none__' ? '' : v)}>
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__none__">Eu mesmo</Select.Item>
                  {opcoesResponsavel.map((nome) => (
                    <Select.Item key={nome} value={nome}>{nome}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="atividade-observacoes">Observações</label>
            <TextField.Root id="atividade-observacoes" autoComplete="off" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>
          {atividade && <ChecklistAtividade casoId={casoId} atividadeId={atividade.id} />}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>Salvar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
