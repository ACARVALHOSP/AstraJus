import { confirmarSaida, useAlteracoesPendentes } from '../../AlteracoesPendentes'
import React, { useEffect, useState } from 'react'
import { Button, Callout, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'

type ClienteOpcao = { id: string; nome: string; cpf_cnpj?: string }

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

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

  const pendente = open && Boolean(clienteSelecionado || textoBusca.trim() || titulo.trim() || responsavel || acao.trim() || foro.trim() || pasta.trim() || processos.trim())
  useAlteracoesPendentes(pendente)
  const fechar = () => confirmarSaida(() => { limpar(); onClose() })

  function aoDigitarCliente(valor: string) {
    setTextoBusca(valor)
    setClienteSelecionado(null)
  }
  const termoCliente = semAcento(textoBusca.trim())
  const digitosCliente = textoBusca.replace(/\D/g, '')
  const resultadosCliente = !clienteSelecionado && termoCliente
    ? clientes.filter(c => semAcento(c.nome ?? '').includes(termoCliente)
        || (digitosCliente.length >= 3 && (c.cpf_cnpj ?? '').replace(/\D/g, '').includes(digitosCliente))).slice(0, 8)
    : []

  async function cadastrar() {
    if (!clienteSelecionado) { setErro('Escolha o cliente na lista: busque pelo nome ou CPF/CNPJ.'); return }
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
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !enviando) fechar() }}>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>Novo processo</Dialog.Title>
        <Flex direction="column" gap="3">
          <Text size="2" color="gray">Cadastre o processo e vincule um cliente. O número CNJ pode ser informado depois.</Text>
          <Text size="3" weight="medium">Identificação</Text>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="caso-cliente-busca">Cliente *</label>
            <TextField.Root
              id="caso-cliente-busca"
              placeholder="Busque por nome ou CPF/CNPJ"
              autoComplete="off"
              value={clienteSelecionado ? formatarNomeExibicao(clienteSelecionado.nome) : textoBusca}
              onChange={(e) => aoDigitarCliente(e.target.value)}
            />
            {resultadosCliente.length > 0 && (
              <Flex direction="column" gap="1" className="busca-resultados" role="listbox" aria-label="Clientes encontrados">
                {resultadosCliente.map(c => (
                  <button key={c.id} type="button" role="option" aria-selected={false} className="aj-busca-item"
                    onClick={() => { setClienteSelecionado(c); setTextoBusca('') }}>
                    {formatarNomeExibicao(c.nome)}{c.cpf_cnpj ? ` — ${c.cpf_cnpj}` : ''}
                  </button>
                ))}
              </Flex>
            )}
            {textoBusca.trim() && !clienteSelecionado && !resultadosCliente.length && <Text size="1" color="gray">Nenhum cliente encontrado. Cadastre-o antes em Contatos.</Text>}
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
          {enviando && (
            <Text size="2" color="gray" role="status" style={{ marginRight: 'auto', alignSelf: 'center' }}>
              Criando o processo e a pasta no Google Drive…
            </Text>
          )}
          <Button variant="soft" color="gray" onClick={fechar} disabled={enviando}>Cancelar</Button>
          <Button onClick={cadastrar} loading={enviando}>Cadastrar processo</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
