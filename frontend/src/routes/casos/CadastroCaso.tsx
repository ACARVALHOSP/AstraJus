import { useEffect, useState } from 'react'
import { Button, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNumeroCNJ } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'

export default function CadastroCaso({
  casoId,
  onCarregado,
  onSalvo,
  onExcluido,
}: {
  casoId: string
  onCarregado: (caso: Caso) => void
  onSalvo: (caso: Caso) => void
  onExcluido: () => void
}) {
  const { cliente } = useCliente()
  const [caso, setCaso] = useState<Caso | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [responsaveis, setResponsaveis] = useState<string[]>([])

  const [responsavel, setResponsavel] = useState('')
  const [pasta, setPasta] = useState('')
  const [acesso, setAcesso] = useState('equipe')

  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null)
  const [paraExcluir, setParaExcluir] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  useEffect(() => {
    setCarregando(true)
    setErroCarregar(null)
    buscarJson<Caso>(cliente, `/casos/${casoId}`)
      .then((dados) => {
        setCaso(dados)
        setResponsavel(dados.responsavel ?? '')
        setPasta(dados.pasta ?? '')
        setAcesso(dados.acesso ?? 'equipe')
        onCarregado(dados)
      })
      .catch((e) => setErroCarregar(e instanceof ErroMCP ? e.message : 'Falha ao carregar processo.'))
      .finally(() => setCarregando(false))
    buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis')
      .then((r) => setResponsaveis(r.responsaveis ?? []))
      .catch(() => {
        // segue sem a lista; o responsável já salvo continua selecionável via opção extra abaixo
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, casoId])

  async function salvar() {
    setSalvando(true)
    setMensagem(null)
    try {
      const atualizado = await enviarJson<Caso>(cliente, `/casos/${casoId}`, { responsavel: responsavel.trim(), pasta: pasta.trim(), acesso }, 'PATCH')
      setCaso(atualizado)
      setMensagem({ tipo: 'sucesso', texto: 'Processo atualizado' })
      onSalvo(atualizado)
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao salvar.' })
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarExclusao() {
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${casoId}`, {}, 'DELETE')
      onExcluido()
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao excluir.' })
      setParaExcluir(false)
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <p>Carregando…</p>
  if (erroCarregar) return <InlineNotification kind="error" title="Erro ao carregar processo" subtitle={erroCarregar} lowContrast hideCloseButton />

  const opcoesResponsavel = [...new Set([...responsaveis, caso?.responsavel].filter((v): v is string => Boolean(v)))]

  return (
    <Stack gap={6}>
      <div>
        <h3>Capa do processo</h3>
        {(caso?.processos ?? []).length === 0 && <p>Nenhum número de processo vinculado.</p>}
        {(caso?.processos ?? []).map((numero) => (
          <p key={numero}>{formatarNumeroCNJ(numero)}</p>
        ))}
      </div>
      <Stack gap={5}>
        <div style={{ maxWidth: 'calc(25ch + 3.5rem)' }}>
          <Select id="editar-caso-responsavel" labelText="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <SelectItem value="" text="Selecione um responsável" />
            {opcoesResponsavel.map((nome) => (
              <SelectItem key={nome} value={nome} text={nome} />
            ))}
          </Select>
        </div>
        <TextInput id="editar-caso-pasta" labelText="Pasta" autoComplete="off" value={pasta} onChange={(e) => setPasta(e.target.value)} />
        <div style={{ maxWidth: 'calc(7ch + 3.5rem)' }}>
          <Select id="editar-caso-acesso" labelText="Acesso" value={acesso} onChange={(e) => setAcesso(e.target.value)}>
            <SelectItem value="equipe" text="Equipe" />
            <SelectItem value="publico" text="Público" />
            <SelectItem value="privado" text="Privado" />
          </Select>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button size="sm" onClick={salvar} disabled={salvando}>
            Salvar
          </Button>
          <Button kind="danger--ghost" size="sm" onClick={() => setParaExcluir(true)}>
            Excluir processo
          </Button>
        </div>
        <div aria-live="polite">
          {mensagem && (
            <InlineNotification
              kind={mensagem.tipo === 'erro' ? 'error' : 'success'}
              title={mensagem.tipo === 'erro' ? 'Erro' : 'Sucesso'}
              subtitle={mensagem.texto}
              lowContrast
              hideCloseButton
            />
          )}
        </div>
      </Stack>
      <Modal
        open={paraExcluir}
        danger
        modalHeading="Excluir processo"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(false)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir o processo "{caso?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.</p>
      </Modal>
    </Stack>
  )
}
