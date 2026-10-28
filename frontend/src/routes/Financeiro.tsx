import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, InlineLoading, InlineNotification, Modal, Stack, Tag } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'

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
    <Stack gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Lançamentos</h2>
        <Button size="sm" disabled title="Em breve: cadastro de novo lançamento">
          Novo lançamento
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <InlineLoading description="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && lancamentos && lancamentos.length === 0 && (
          <InlineNotification kind="info" title="Nenhum lançamento cadastrado" lowContrast hideCloseButton />
        )}
        {!carregando && lancamentos && lancamentos.length > 0 && (
          <div className="tabela-responsiva-wrap">
            <table className="tabela-responsiva tabela-lancamentos">
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
                  const rotuloDirecao = lanc.direcao === 'DESPESA' ? 'A pagar' : 'A receber'
                  const rotuloPago = lanc.direcao === 'DESPESA' ? 'Pago' : 'Recebido'
                  return (
                    <tr key={lanc.id}>
                      <td data-label="Vencimento">{formatarDataSimples(lanc.vencimento)}</td>
                      <td data-label="Valor">{formatarMoeda(lanc.valor)}</td>
                      <td data-label="Descrição">
                        {lanc.descricao}
                        {lanc.recorrente ? ' (mensal)' : ''}
                      </td>
                      <td data-label="Cliente">{formatarNomeExibicao(nomeCliente(lanc.cliente_id))}</td>
                      <td data-label="Processo">{formatarNomeExibicao(tituloCaso(lanc.caso_id))}</td>
                      <td data-label="Responsável">{formatarNomeExibicao(lanc.responsavel)}</td>
                      <td data-label="Direção">
                        <Tag type={lanc.direcao === 'DESPESA' ? 'red' : 'green'} size="sm">
                          {rotuloDirecao}
                        </Tag>
                        <div>
                          <Checkbox
                            id={`pago-${lanc.id}`}
                            labelText={rotuloPago}
                            checked={lanc.pago}
                            onChange={(_e, { checked }) => alternarPago(lanc, checked)}
                          />
                        </div>
                      </td>
                      <td data-label="Ações">
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {lanc.asaas_cobranca_id ? (
                            <span title={`Cobrança ${lanc.asaas_cobranca_id}`}>Cobrança gerada</span>
                          ) : (
                            !lanc.pago && (
                              <Button kind="tertiary" size="sm" onClick={() => gerarCobranca(lanc)}>
                                Gerar cobrança
                              </Button>
                            )
                          )}
                          <Button kind="danger--tertiary" size="sm" onClick={() => setParaExcluir(lanc)}>
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir lançamento"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>
          Excluir o lançamento "{paraExcluir?.descricao}"? Essa ação não pode ser desfeita.
        </p>
      </Modal>
    </Stack>
  )
}
