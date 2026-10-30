import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { Button, Column, Grid, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNumeroCNJ } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'
import CapaProcesso from './CapaProcesso'

export default function CadastroCaso({
  casoId,
  onCarregado,
  onSalvo,
  onExcluido,
  onMovimentacoes,
}: {
  casoId: string
  onCarregado: (caso: Caso) => void
  onSalvo: (caso: Caso) => void
  onExcluido: () => void
  onMovimentacoes: () => void
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
    let atual = true
    setCarregando(true)
    setErroCarregar(null)
    buscarJson<Caso>(cliente, `/casos/${casoId}`)
      .then((dados) => {
        if (!atual) return
        setCaso(dados)
        setResponsavel(dados.responsavel ?? '')
        setPasta(dados.pasta ?? '')
        setAcesso(dados.acesso ?? 'equipe')
        onCarregado(dados)
      })
      .catch((e) => { if (atual) setErroCarregar(e instanceof ErroMCP ? e.message : 'Falha ao carregar processo.') })
      .finally(() => { if (atual) setCarregando(false) })
    buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis')
      .then((r) => { if (atual) setResponsaveis(r.responsaveis ?? []) })
      .catch(() => {
        // segue sem a lista; o responsável já salvo continua selecionável via opção extra abaixo
      })
    return () => { atual = false }
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

  if (carregando) return <Carregamento tipo="detalhe" />
  if (erroCarregar) return <InlineNotification kind="error" title="Erro ao carregar processo" subtitle={erroCarregar} lowContrast hideCloseButton />

  const opcoesResponsavel = [...new Set([...responsaveis, caso?.responsavel].filter((v): v is string => Boolean(v)))]

  return (
    <Stack gap={6}>
      <section className="casos-resumo" aria-label="Dados do processo">
        <h2>Identificação do processo</h2>
        <Grid narrow fullWidth className="casos-formulario-grade">
          <Column sm={4} md={4} lg={8}><dl><dt>Número CNJ</dt><dd>{caso?.processos?.length ? caso.processos.map(formatarNumeroCNJ).join(', ') : 'Ainda não informado'}</dd></dl></Column>
          <Column sm={4} md={4} lg={8}><dl><dt>Classe / ação</dt><dd>{caso?.acao || 'Não informada'}</dd></dl></Column>
          <Column sm={4} md={8} lg={16}><dl><dt>Foro</dt><dd>{caso?.foro || 'Não informado'}</dd></dl></Column>
        </Grid>
      </section>
      {caso?.processos?.length ? caso.processos.map(numero => <CapaProcesso
        key={`${casoId}-${numero}`} caso={caso} numero={numero} onMovimentacoes={onMovimentacoes}
        onAtualizado={atualizado => { setCaso(atualizado); onSalvo(atualizado) }}
      />) : <InlineNotification kind="info" title="Capa do processo" subtitle="Este processo ainda não tem número CNJ para consultar a capa." lowContrast hideCloseButton />}
      <h2>Organização do escritório</h2>
      <Grid narrow fullWidth className="casos-formulario-grade">
        <Column sm={4} md={4} lg={8} xlg={6}>
          <Select id="editar-caso-responsavel" labelText="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <SelectItem value="" text="Selecione um responsável" />
            {opcoesResponsavel.map((nome) => (
              <SelectItem key={nome} value={nome} text={nome} />
            ))}
          </Select>
        </Column>
        <Column sm={4} md={4} lg={8} xlg={6}>
          <TextInput id="editar-caso-pasta" labelText="Pasta" autoComplete="off" value={pasta} onChange={(e) => setPasta(e.target.value)} />
        </Column>
        <Column sm={4} md={4} lg={8} xlg={4}>
          <Select id="editar-caso-acesso" labelText="Acesso" helperText="Classificação interna; não altera as permissões do sistema." value={acesso} onChange={(e) => setAcesso(e.target.value)}>
            <SelectItem value="equipe" text="Equipe" />
            <SelectItem value="publico" text="Público" />
            <SelectItem value="privado" text="Privado" />
          </Select>
        </Column>
      </Grid>
        <div className="casos-acoes-cadastro">
          <Button size="sm" onClick={salvar} disabled={salvando}>
            Salvar alterações
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
      <Modal closeButtonLabel="Fechar"
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
