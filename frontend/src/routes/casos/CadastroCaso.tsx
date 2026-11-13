import PastaDrive from '../../PastaDrive'
import { useAvisos } from '../../Avisos'
import { useAlteracoesPendentes } from '../../AlteracoesPendentes'
import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { AlertDialog, Button, Callout, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { useResponsaveis } from '../../api/consultas'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNumeroCNJ } from '../../utils/formatadores'
import type { Caso } from './ListaCasos'
import CapaProcesso from './CapaProcesso'

const SEM_RESPONSAVEIS: string[] = []

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
  const { avisar } = useAvisos()
  const [caso, setCaso] = useState<Caso | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const { data: responsaveis = SEM_RESPONSAVEIS } = useResponsaveis()

  const [responsavel, setResponsavel] = useState('')
  const [pasta, setPasta] = useState('')
  const [acesso, setAcesso] = useState('equipe')

  const [salvando, setSalvando] = useState(false)
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
    return () => { atual = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, casoId])

  async function salvar() {
    setSalvando(true)
    try {
      const atualizado = await enviarJson<Caso>(cliente, `/casos/${casoId}`, { responsavel: responsavel.trim(), pasta: pasta.trim(), acesso }, 'PATCH')
      setCaso(atualizado)
      avisar({ texto: 'Alterações do processo salvas.' })
      onSalvo(atualizado)
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível salvar. Tente de novo.' })
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
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível excluir. Tente de novo.' })
      setParaExcluir(false)
    } finally {
      setExcluindo(false)
    }
  }

  const pendente = Boolean(caso) && (responsavel !== (caso?.responsavel ?? '') || pasta !== (caso?.pasta ?? '') || acesso !== (caso?.acesso ?? 'equipe'))
  useAlteracoesPendentes(pendente)

  if (carregando) return <Carregamento tipo="detalhe" />
  if (erroCarregar) return (
    <Callout.Root color="red" size="1">
      <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
      <Callout.Text>Erro ao carregar processo: {erroCarregar}</Callout.Text>
    </Callout.Root>
  )

  const opcoesResponsavel = [...new Set([...responsaveis, caso?.responsavel].filter((v): v is string => Boolean(v)))]

  return (
    <Flex direction="column" gap="6">
      <section className="casos-resumo" aria-label="Dados do processo">
        <Heading as="h2" size="4">Identificação do processo</Heading>
        <div className="casos-formulario-grade">
          <dl><dt>Número CNJ</dt><dd>{caso?.processos?.length ? caso.processos.map(formatarNumeroCNJ).join(', ') : 'Ainda não informado'}</dd></dl>
          <dl><dt>Classe / ação</dt><dd>{caso?.acao || 'Não informada'}</dd></dl>
          <dl style={{ gridColumn: '1 / -1' }}><dt>Foro</dt><dd>{caso?.foro || 'Não informado'}</dd></dl>
        </div>
      </section>
      {caso?.processos?.length ? caso.processos.map(numero => (
        <CapaProcesso
          key={`${casoId}-${numero}`}
          caso={caso}
          numero={numero}
          onMovimentacoes={onMovimentacoes}
          onAtualizado={atualizado => { setCaso(atualizado); onSalvo(atualizado) }}
        />
      )) : (
        <Callout.Root color="blue" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>Este processo ainda não tem número CNJ para consultar a capa.</Callout.Text>
        </Callout.Root>
      )}
      <Heading as="h2" size="4">Organização do escritório</Heading>
      <div className="casos-formulario-grade">
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="editar-caso-responsavel">Responsável</label>
          <Select.Root value={responsavel || '__none__'} onValueChange={(v) => setResponsavel(v === '__none__' ? '' : v)}>
            <Select.Trigger id="editar-caso-responsavel" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__none__">Selecione um responsável</Select.Item>
              {opcoesResponsavel.map((nome) => (
                <Select.Item key={nome} value={nome}>{nome}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="editar-caso-pasta">Pasta</label>
          <TextField.Root id="editar-caso-pasta" autoComplete="off" value={pasta} onChange={(e) => setPasta(e.target.value)} />
        </div>
        {caso && <PastaDrive tipo="casos" id={caso.id} pastaId={caso.drive_pasta_id} onCriada={(pastaId) => setCaso({ ...caso, drive_pasta_id: pastaId })} />}
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="editar-caso-acesso">Acesso</label>
          <Select.Root value={acesso} onValueChange={setAcesso}>
            <Select.Trigger id="editar-caso-acesso" style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="equipe">Equipe</Select.Item>
              <Select.Item value="publico">Público</Select.Item>
              <Select.Item value="privado">Privado</Select.Item>
            </Select.Content>
          </Select.Root>
          <Text size="1" color="gray">Classificação interna; não altera as permissões do sistema.</Text>
        </div>
      </div>
      <div className="casos-acoes-cadastro">
        <Button size="2" onClick={salvar} loading={salvando}>
          Salvar alterações
        </Button>
        <Button variant="ghost" color="red" size="2" onClick={() => setParaExcluir(true)}>
          Excluir processo
        </Button>
      </div>
      <AlertDialog.Root open={paraExcluir} onOpenChange={(open) => !open && setParaExcluir(false)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir processo</AlertDialog.Title>
          <AlertDialog.Description>
            Excluir o processo "{caso?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.
          </AlertDialog.Description>
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
