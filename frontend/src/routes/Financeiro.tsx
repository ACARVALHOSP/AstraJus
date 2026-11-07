import CabecalhoPagina from '../CabecalhoPagina'
import TabelaResponsiva from '../TabelaResponsiva'
import TextoTabela from '../TextoTabela'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Checkbox, Flex, Text } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'
import NovoLancamentoModal from './financeiro/NovoLancamentoModal'

type Lancamento = {
  id: string
  vencimento?: string
  valor?: number
  descricao: string
  recorrente?: boolean
  cliente_id?: string
  caso_id?: string
  responsavel?: string
  direcao: 'DESPESA' | 'RECEITA'
  pago: boolean
  asaas_cobranca_id?: string
}

type Cliente = { id: string; nome?: string }
type Caso = { id: string; titulo?: string }

export default function Financeiro() {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [lancamentos, setLancamentos] = useState<Lancamento[] | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [casos, setCasos] = useState<Caso[]>([])
  const [paraExcluir, setParaExcluir] = useState<Lancamento | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [respLancamentos, respClientes, respCasos] = await Promise.all([
        buscarJson<{ lancamentos: Lancamento[] }>(cliente, '/lancamentos'),
        buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes'),
        buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      ])
      setLancamentos(respLancamentos.lancamentos ?? [])
      setClientes(respClientes.clientes ?? [])
      setCasos(respCasos.casos ?? [])
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
    } finally {
      setCarregando(false)
    }
  }, [cliente])

  useEffect(() => {
    carregar()
  }, [carregar])

  const nomeCliente = (id?: string) => clientes.find((c) => c.id === id)?.nome ?? id ?? ''
  const tituloCaso = (id?: string) => casos.find((c) => c.id === id)?.titulo ?? '(sem título)'

  async function alternarPago(lanc: Lancamento, pago: boolean) {
    setLancamentos((atual) => atual?.map((l) => (l.id === lanc.id ? { ...l, pago } : l)) ?? null)
    try {
      await enviarJson(cliente, `/lancamentos/${lanc.id}`, { pago }, 'PATCH')
    } catch (e) {
      setLancamentos((atual) => atual?.map((l) => (l.id === lanc.id ? { ...l, pago: !pago } : l)) ?? null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar.')
    }
  }

  async function gerarCobranca(lanc: Lancamento) {
    try {
      await enviarJson(cliente, `/lancamentos/${lanc.id}/cobranca`, {})
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao gerar cobrança.')
    }
  }

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/lancamentos/${paraExcluir.id}`, {}, 'DELETE')
      setParaExcluir(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Lançamentos"
        descricao="Receitas e despesas do escritório vinculadas a clientes e processos."
        acoes={<Button size="2" onClick={() => setModalNovoAberto(true)}>Novo lançamento</Button>}
      />
      <div aria-live="polite">
        {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && lancamentos && lancamentos.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum lançamento cadastrado</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && lancamentos && lancamentos.length > 0 && (
          <TabelaLancamentos
            lancamentos={lancamentos}
            nomeCliente={nomeCliente}
            tituloCaso={tituloCaso}
            onAlternarPago={alternarPago}
            onGerarCobranca={gerarCobranca}
            onExcluir={setParaExcluir}
          />
        )}
      </div>
      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir lançamento</AlertDialog.Title>
          <AlertDialog.Description>
            Excluir o lançamento "{paraExcluir?.descricao}"? Essa ação não pode ser desfeita.
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
      <NovoLancamentoModal
        open={modalNovoAberto}
        onClose={() => setModalNovoAberto(false)}
        onSalvo={() => {
          setModalNovoAberto(false)
          carregar()
        }}
      />
    </Flex>
  )
}

function TabelaLancamentos({
  lancamentos,
  nomeCliente,
  tituloCaso,
  onAlternarPago,
  onGerarCobranca,
  onExcluir,
}: {
  lancamentos: Lancamento[]
  nomeCliente: (id?: string) => string
  tituloCaso: (id?: string) => string
  onAlternarPago: (lanc: Lancamento, pago: boolean) => void
  onGerarCobranca: (lanc: Lancamento) => void
  onExcluir: (lanc: Lancamento) => void
}) {
  return (
    <TabelaResponsiva principais={['Descrição', 'Valor']}>
      <table aria-label="Lançamentos">
        <thead>
          <tr>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Descrição</th>
            <th>Cliente</th>
            <th>Processo</th>
            <th>Responsável</th>
            <th>Direção</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {lancamentos.map((lanc) => {
            const rotuloPago = lanc.direcao === 'DESPESA' ? 'Pago' : 'Recebido'
            return (
              <tr key={lanc.id}>
                <td>{formatarDataSimples(lanc.vencimento)}</td>
                <td>{formatarMoeda(lanc.valor)}</td>
                <td><TextoTabela texto={lanc.descricao + (lanc.recorrente ? ' (mensal)' : '')} /></td>
                <td><TextoTabela texto={formatarNomeExibicao(nomeCliente(lanc.cliente_id))} /></td>
                <td><TextoTabela texto={formatarNomeExibicao(tituloCaso(lanc.caso_id))} /></td>
                <td><TextoTabela texto={formatarNomeExibicao(lanc.responsavel)} /></td>
                <td>
                  <Flex direction="column" gap="2" align="start">
                    <Badge color={lanc.direcao === 'DESPESA' ? 'red' : 'green'}>
                      {lanc.direcao === 'DESPESA' ? 'A pagar' : 'A receber'}
                    </Badge>
                    <Text as="label" size="2">
                      <Flex gap="2" align="center">
                        <Checkbox checked={lanc.pago} onCheckedChange={(checked) => onAlternarPago(lanc, Boolean(checked))} />
                        {rotuloPago}
                      </Flex>
                    </Text>
                  </Flex>
                </td>
                <td>
                  <Flex direction="column" gap="2" align="end">
                    {lanc.asaas_cobranca_id && <Text size="1" color="gray" title={`Cobrança ${lanc.asaas_cobranca_id}`}>Cobrança gerada</Text>}
                    <AcoesTabela rotulo={lanc.descricao} acoes={[
                      ...(!lanc.asaas_cobranca_id && !lanc.pago ? [{ texto: 'Gerar cobrança', executar: () => onGerarCobranca(lanc) }] : []),
                      { texto: 'Excluir', executar: () => onExcluir(lanc), perigo: true },
                    ]} />
                  </Flex>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TabelaResponsiva>
  )
}
