import React, { useEffect, useState } from 'react'
import { Button, Callout, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'

type ClienteOpcao = { id: string; nome: string }

export default function NovoProcessoModal({
  open, clientes, onClose, onCriado,
}: {
  open: boolean; clientes: ClienteOpcao[]; onClose: () => void; onCriado: (caso: Caso) => void
  launcherButtonRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const { cliente } = useCliente()
  const [textoBusca, setTextoBusca] = useState('')
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

  useEffect(() => {
    if (!open) return
    let quadro: number
    const focarCliente = () => {
      const campo = document.getElementById('caso-cliente-busca')
      if (campo && getComputedStyle(campo).visibility === 'visible') {
        campo.focus()
        return
      }
      quadro = requestAnimationFrame(focarCliente)
    }
    quadro = requestAnimationFrame(focarCliente)
    return () => cancelAnimationFrame(quadro)
  }, [open])

  function limpar() {
    setClienteSelecionado(null)
    setTextoBusca('')
    setTitulo('')
    setResponsavel('')
    setAcao('')
    setForo('')
    setPasta('')
    setAcesso('equipe')
    setProcessos('')
    setErro(null)
  }

  function aoDigitarCliente(valor: string) {
    setTextoBusca(valor)
    const encontrado = clientes.find((c) => formatarNomeExibicao(c.nome).toLowerCase() === valor.toLowerCase())
    setClienteSelecionado(encontrado ?? null)
  }

  async function cadastrar() {
    if (!clienteSelecionado) { setErro('Selecione um cliente.'); return }
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
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) { limpar(); onClose() } }}>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>Novo processo</Dialog.Title>
        <Flex direction="column" gap="3">
          <Text size="2" color="gray">Cadastre o processo e vincule um cliente. O número CNJ pode ser informado depois.</Text>
          <Text size="3" weight="medium">Identificação</Text>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="caso-cliente-busca">Cliente *</label>
            <TextField.Root
              id="caso-cliente-busca"
              list="caso-clientes-lista"
              placeholder="Digite para buscar..."
              autoComplete="off"
              value={textoBusca}
              onChange={(e) => aoDigitarCliente(e.target.value)}
            />
            <datalist id="caso-clientes-lista">
              {clientes.map((c) => <option key={c.id} value={formatarNomeExibicao(c.nome)} />)}
            </datalist>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="caso-titulo">Título</label>
            <TextField.Root id="caso-titulo" placeholder="Ex.: Cobrança de honorários" autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="casos-formulario-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="caso-responsavel">Responsável</label>
              <TextField.Root id="caso-responsavel" placeholder="Ex.: Dra. Fernanda Reis" autoComplete="off" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="caso-acao">Ação</label>
              <TextField.Root id="caso-acao" placeholder="Ex.: Cumprimento de sentença" autoComplete="off" value={acao} onChange={(e) => setAcao(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="caso-foro">Foro</label>
              <TextField.Root id="caso-foro" placeholder="Ex.: 3ª Vara Cível" autoComplete="off" value={foro} onChange={(e) => setForo(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="caso-pasta">Pasta (opcional)</label>
              <TextField.Root id="caso-pasta" placeholder="Ex.: Trabalhista 2026" autoComplete="off" value={pasta} onChange={(e) => setPasta(e.target.value)} />
              <Text size="1" color="gray">Só para organizar e facilitar a busca.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label">Acesso</label>
              <Select.Root value={acesso} onValueChange={setAcesso}>
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="equipe">Equipe</Select.Item>
                  <Select.Item value="publico">Público</Select.Item>
                  <Select.Item value="privado">Privado</Select.Item>
                </Select.Content>
              </Select.Root>
              <Text size="1" color="gray">Classificação interna; não restringe permissões ainda.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="caso-processos">Número CNJ (opcional)</label>
              <TextField.Root id="caso-processos" placeholder="1006314-27.2023.8.26.0005" autoComplete="off" value={processos} onChange={(e) => setProcessos(e.target.value)} />
              <Text size="1" color="gray">Informe um único número ou deixe em branco.</Text>
            </div>
          </div>
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={() => { limpar(); onClose() }}>Cancelar</Button>
          <Button onClick={cadastrar} disabled={enviando}>Cadastrar processo</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
