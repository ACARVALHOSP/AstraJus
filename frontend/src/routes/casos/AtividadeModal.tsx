import CampoData from '../../CampoData'
import { useEffect, useState } from 'react'
import { Button, Callout, Dialog, Flex, Select, TextArea, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { useNomePessoa, useResponsaveis } from '../../api/consultas'
import { enviarJson } from '../../api/rest'
import type { Atividade } from './AtividadesCaso'
import ChecklistAtividade from './ChecklistAtividade'
import { confirmarSaida, useAlteracoesPendentes } from '../../AlteracoesPendentes'

const SEM_RESPONSAVEIS: string[] = []
const ROTULO_TIPO: Record<string, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião', outro: 'Outro' }

export default function AtividadeModal({
  open, casoId, atividade, onClose, onSalva, dataInicial,
}: {
  open: boolean; casoId: string; atividade: Atividade | null; onClose: () => void; onSalva: () => void
  /** Data sugerida ao criar uma atividade nova (ex.: o dia escolhido na Agenda). */
  dataInicial?: string
}) {
  const { cliente } = useCliente()
  const nomePessoa = useNomePessoa()
  const [tipo, setTipo] = useState('tarefa')
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState('')
  const [hora, setHora] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const { data: responsaveis = SEM_RESPONSAVEIS } = useResponsaveis()
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTipo(atividade?.tipo ?? 'tarefa')
    setTitulo(atividade?.titulo ?? '')
    setData(atividade?.data ?? dataInicial ?? '')
    setHora(atividade?.hora ?? '')
    setResponsavel(atividade?.responsavel ?? '')
    setObservacoes(atividade?.observacoes ?? '')
    setErro(null)
  }, [open, atividade, dataInicial])

  const pendente = open && (titulo !== (atividade?.titulo ?? '') || tipo !== (atividade?.tipo ?? 'tarefa') || data !== (atividade?.data ?? dataInicial ?? '')
    || hora !== (atividade?.hora ?? '') || responsavel !== (atividade?.responsavel ?? '') || observacoes !== (atividade?.observacoes ?? ''))
  useAlteracoesPendentes(pendente)
  const fechar = () => confirmarSaida(onClose)

  const opcoesResponsavel = [...new Set([...responsaveis, atividade?.responsavel].filter((v): v is string => Boolean(v)))]

  async function salvar() {
    if (!titulo.trim()) { setErro('Informe o título.'); document.getElementById('atividade-titulo')?.focus(); return }
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
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && fechar()}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{atividade ? 'Editar atividade' : 'Nova atividade'}</Dialog.Title>
        <Flex direction="column" gap="3">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="atividade-titulo">Título <span className="aj-obrigatorio" aria-hidden="true">*</span></label>
            <TextField.Root id="atividade-titulo" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="casos-formulario-grade">
            <div className="form-campo">
              <label className="form-campo-label" id="atividade-tipo-rotulo">Tipo</label>
              <Select.Root value={tipo} onValueChange={setTipo}>
                <Select.Trigger aria-labelledby="atividade-tipo-rotulo" style={{ width: '100%' }} />
                <Select.Content>
                  {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                    <Select.Item key={valor} value={valor}>{rotulo}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="atividade-data">Data</label>
              <CampoData id="atividade-data" value={data} onChange={v => setData(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="atividade-hora">Hora</label>
              <TextField.Root id="atividade-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" id="atividade-resp-rotulo">Responsável</label>
              <Select.Root value={responsavel || '__none__'} onValueChange={(v) => setResponsavel(v === '__none__' ? '' : v)}>
                <Select.Trigger aria-labelledby="atividade-resp-rotulo" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__none__">Eu mesmo</Select.Item>
                  {opcoesResponsavel.map((nome) => (
                    <Select.Item key={nome} value={nome}>{nomePessoa(nome)}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="atividade-observacoes">Observações</label>
            <TextArea id="atividade-observacoes" rows={3} resize="vertical" placeholder="Ex.: juntar procuração e comprovante de endereço" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
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
          <Button variant="soft" color="gray" onClick={fechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando}>Salvar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
