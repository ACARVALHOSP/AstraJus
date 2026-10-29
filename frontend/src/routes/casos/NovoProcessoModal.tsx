import { useState } from 'react'
import { Column, ComboBox, Grid, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'

type ClienteOpcao = { id: string; nome: string }

export default function NovoProcessoModal({
  open,
  clientes,
  onClose,
  onCriado,
}: {
  open: boolean
  clientes: ClienteOpcao[]
  onClose: () => void
  onCriado: (caso: Caso) => void
}) {
  const { cliente } = useCliente()
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteOpcao | null>(null)
  const [titulo, setTitulo] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [acao, setAcao] = useState('')
  const [foro, setForo] = useState('')
  const [pasta, setPasta] = useState('')
  const [acesso, setAcesso] = useState('equipe')
  const [processos, setProcessos] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function limpar() {
    setClienteSelecionado(null)
    setTitulo('')
    setResponsavel('')
    setAcao('')
    setForo('')
    setPasta('')
    setAcesso('equipe')
    setProcessos('')
    setErro(null)
  }

  async function cadastrar() {
    if (!clienteSelecionado) {
      setErro('Selecione um cliente.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const numeros = processos.split(',').map((s) => s.trim()).filter(Boolean)
      const novoCaso = await enviarJson<Caso>(cliente, '/casos', {
        cliente_id: clienteSelecionado.id,
        titulo: titulo.trim(),
        responsavel: responsavel.trim(),
        acao: acao.trim(),
        foro: foro.trim(),
        pasta: pasta.trim(),
        acesso,
        numeros_processo: numeros,
      })
      limpar()
      onCriado(novoCaso)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao cadastrar processo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal closeButtonLabel="Fechar"
      open={open}
      modalHeading="Novo processo"
      primaryButtonText="Cadastrar processo"
      secondaryButtonText="Cancelar"
      primaryButtonDisabled={enviando}
      onRequestClose={() => {
        limpar()
        onClose()
      }}
      onRequestSubmit={cadastrar}
    >
      <Stack gap={5}>
        <ComboBox
          id="caso-cliente-busca"
          titleText="Cliente"
          placeholder="Digite para buscar..."
          items={clientes}
          itemToString={(c: ClienteOpcao | null) => (c ? formatarNomeExibicao(c.nome) : '')}
          selectedItem={clienteSelecionado}
          onChange={({ selectedItem }) => setClienteSelecionado(selectedItem ?? null)}
        />
        <TextInput id="caso-titulo" labelText="Título" placeholder="Ex.: Cobrança de honorários" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <Grid narrow fullWidth>
          <Column sm={4} md={4} lg={8}>
            <TextInput id="caso-responsavel" labelText="Responsável" placeholder="Ex.: Dra. Fernanda Reis" autoComplete="off" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
          </Column>
          <Column sm={4} md={4} lg={8}>
            <TextInput id="caso-acao" labelText="Ação" placeholder="Ex.: Cumprimento de sentença" autoComplete="off" value={acao} onChange={(e) => setAcao(e.target.value)} />
          </Column>
          <Column sm={4} md={4} lg={8}>
            <TextInput id="caso-foro" labelText="Foro" placeholder="Ex.: 3ª Vara Cível" autoComplete="off" value={foro} onChange={(e) => setForo(e.target.value)} />
          </Column>
          <Column sm={4} md={4} lg={8}>
            <TextInput
              id="caso-pasta"
              labelText="Pasta (opcional)"
              placeholder="Ex.: Trabalhista 2026"
              helperText="Só para organizar e facilitar a busca - não cria pastas de verdade no sistema."
              autoComplete="off"
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
            />
          </Column>
          <Column sm={4} md={2} lg={4}>
            <Select id="caso-acesso" labelText="Acesso" helperText="Só para organizar - o sistema ainda não restringe quem vê o processo pelo acesso escolhido." value={acesso} onChange={(e) => setAcesso(e.target.value)}>
              <SelectItem value="equipe" text="Equipe" />
              <SelectItem value="publico" text="Público" />
              <SelectItem value="privado" text="Privado" />
            </Select>
          </Column>
          <Column sm={4} md={6} lg={12}>
            <TextInput
              id="caso-processos"
              labelText="Número CNJ (opcional)"
              placeholder="1006314-27.2023.8.26.0005"
              helperText="Informe um único número ou deixe em branco se ainda não existir."
              autoComplete="off"
              value={processos}
              onChange={(e) => setProcessos(e.target.value)}
            />
          </Column>
        </Grid>
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </Stack>
    </Modal>
  )
}
