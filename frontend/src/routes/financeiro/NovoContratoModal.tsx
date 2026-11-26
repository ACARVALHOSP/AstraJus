import { confirmarSaida, useAlteracoesPendentes } from '../../AlteracoesPendentes'
import CampoData from '../../CampoData'
import Carregamento from '../../Carregamento'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Dialog, Flex, Heading, Select, Table, Text, TextArea, TextField } from '@radix-ui/themes'
import { useQuery } from '@tanstack/react-query'
import { useCliente } from '../../api/ClienteContext'
import { useCasos, useClientes } from '../../api/consultas'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson, requisitar } from '../../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao } from '../../utils/formatadores'
import {
  FORM_CONTRATO_VAZIO, dataValida, formDeContrato, reaisDeTexto, somaParcelas, validarContrato,
  type Contrato, type FormContrato,
} from './dadosContrato'

type ClienteBusca = { id: string; nome: string; cpf_cnpj?: string }
type CasoOpcao = { id: string; titulo?: string; cliente_id?: string; clientes_adicionais?: string[] }
type DocumentoOpcao = { id: number; nome: string; cliente_id?: string | null }
type ParcelaPrevia = { numero: number; rotulo: string; vencimento: string; valor: number }

const SEM_CLIENTES: ClienteBusca[] = []
const SEM_CASOS: CasoOpcao[] = []
const SEM_DOCUMENTOS: DocumentoOpcao[] = []

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Criação e edição de rascunho de contrato; no contrato vigente só os campos permitidos ficam abertos. */
export default function NovoContratoModal({ open, contrato, onClose, onSalvo }: {
  open: boolean
  contrato?: Contrato | null
  onClose: () => void
  onSalvo: (contrato: Contrato) => void
}) {
  const { cliente } = useCliente()
  const consultaClientes = useClientes<ClienteBusca>({ enabled: open && Boolean(cliente) })
  const consultaCasos = useCasos<CasoOpcao>({ enabled: open && Boolean(cliente) })
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const casos = consultaCasos.data ?? SEM_CASOS
  const carregandoBase = open && (consultaClientes.isLoading || consultaCasos.isLoading)
  const falhaBase = consultaClientes.error ?? consultaCasos.error
  const erroBase = falhaBase ? (falhaBase instanceof ErroMCP ? falhaBase.message : 'Falha ao carregar clientes/processos.') : null

  const [form, setForm] = useState<FormContrato>(FORM_CONTRATO_VAZIO)
  const [inicial, setInicial] = useState<FormContrato>(FORM_CONTRATO_VAZIO)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<string[]>([])
  const [previa, setPrevia] = useState<ParcelaPrevia[] | null>(null)
  const [erroPrevia, setErroPrevia] = useState<string | null>(null)
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)

  const consultaDocumentos = useQuery({
    queryKey: ['documentos', cliente?.token, form.cliente_id],
    enabled: open && Boolean(cliente) && Boolean(form.cliente_id),
    queryFn: ({ signal }) => buscarJson<{ documentos: DocumentoOpcao[] }>(
      cliente, `/documentos?cliente_id=${encodeURIComponent(form.cliente_id)}`, signal,
    ).then(r => r.documentos ?? []),
  })
  const documentos = consultaDocumentos.data ?? SEM_DOCUMENTOS

  const travado = contrato?.situacao === 'vigente'

  useEffect(() => {
    if (!open) return
    const novo = contrato ? formDeContrato(contrato) : { ...FORM_CONTRATO_VAZIO }
    // eslint-disable-next-line react/set-state-in-effect
    setForm(novo)
    setInicial(novo)
    setBuscaCliente('')
    setErro(null)
    setErros([])
    setErroPrevia(null)
    setPrevia(null)
    // Reaplica só ao abrir ou trocar de contrato: recarregar clientes não pode apagar o que foi digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contrato?.id])

  const clienteSelecionado = useMemo(
    () => clientes.find(c => c.id === form.cliente_id) ?? null,
    [clientes, form.cliente_id],
  )
  const processosDoCliente = useMemo(
    () => (clienteSelecionado
      ? casos.filter(c => c.cliente_id === clienteSelecionado.id || (c.clientes_adicionais ?? []).includes(clienteSelecionado.id))
      : []),
    [casos, clienteSelecionado],
  )

  const termoNormalizado = normalizar(buscaCliente.trim())
  const digitos = buscaCliente.replace(/\D/g, '')
  const resultadosBusca = !clienteSelecionado && termoNormalizado
    ? clientes.filter(c => normalizar(c.nome).includes(termoNormalizado) || (digitos.length >= 3 && (c.cpf_cnpj ?? '').replace(/\D/g, '').includes(digitos))).slice(0, 8)
    : []

  function mudar(parcial: Partial<FormContrato>) {
    setForm(f => ({ ...f, ...parcial }))
  }

  function escolherCliente(c: ClienteBusca) {
    setForm(f => ({ ...f, cliente_id: c.id, caso_id: '', documento_id: '' }))
    setBuscaCliente('')
  }

  function limparCliente(texto: string) {
    setForm(f => ({ ...f, cliente_id: '', caso_id: '', documento_id: '' }))
    setBuscaCliente(texto)
  }

  // Prévia ao vivo: espera 300 ms, cancela a requisição anterior e só chama o servidor com dados válidos.
  useEffect(() => {
    if (!open) {
      setPrevia(null)
      setErroPrevia(null)
      setCarregandoPrevia(false)
      return
    }
    const total = reaisDeTexto(form.valor_total)
    const entrada = form.entrada.trim() ? reaisDeTexto(form.entrada) : 0
    const parcelas = Number(form.parcelas)
    const pronto = total !== null && total > 0 && entrada !== null && entrada < total
      && Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 120
      && dataValida(form.primeiro_vencimento)
      && (!form.entrada_vencimento || dataValida(form.entrada_vencimento))
    if (!cliente || !pronto) {
      setPrevia(null)
      setErroPrevia(null)
      setCarregandoPrevia(false)
      return
    }
    const controlador = new AbortController()
    setCarregandoPrevia(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const resposta = await requisitar(cliente, '/contratos-honorarios/previa', {
            metodo: 'POST',
            corpo: {
              valor_total: total,
              entrada,
              parcelas,
              primeiro_vencimento: form.primeiro_vencimento,
              ...(entrada > 0 && form.entrada_vencimento ? { entrada_vencimento: form.entrada_vencimento } : {}),
            },
            signal: controlador.signal,
          })
          const dados = await resposta.json() as { parcelas?: ParcelaPrevia[] }
          if (!controlador.signal.aborted) {
            setPrevia(dados.parcelas ?? [])
            setErroPrevia(null)
          }
        } catch (e) {
          if (controlador.signal.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          setPrevia(null)
          setErroPrevia(e instanceof ErroMCP ? e.message : 'Não foi possível calcular a prévia das parcelas.')
        } finally {
          if (!controlador.signal.aborted) setCarregandoPrevia(false)
        }
      })()
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controlador.abort()
    }
  }, [open, cliente, form.valor_total, form.entrada, form.parcelas, form.primeiro_vencimento, form.entrada_vencimento])

  async function salvar() {
    setErro(null)
    const problemas = validarContrato(form)
    setErros(problemas)
    if (problemas.length) return

    const total = reaisDeTexto(form.valor_total)
    const entrada = form.entrada.trim() ? reaisDeTexto(form.entrada) : 0
    if (total === null || entrada === null) return
    const parcelas = Number(form.parcelas)
    const exito = form.exito_percentual.trim() ? Number(form.exito_percentual.replace(',', '.')) : null
    const corpo = {
      cliente_id: form.cliente_id,
      caso_id: form.caso_id || null,
      documento_id: form.documento_id ? Number(form.documento_id) : null,
      titulo: form.titulo.trim(),
      valor_total: total,
      entrada,
      entrada_vencimento: entrada > 0 && form.entrada_vencimento ? form.entrada_vencimento : null,
      parcelas,
      primeiro_vencimento: form.primeiro_vencimento,
      exito_percentual: exito,
      exito_descricao: form.exito_descricao.trim() || null,
      vigencia_inicio: form.vigencia_inicio || null,
      vigencia_fim: form.vigencia_fim || null,
      ...(contrato ? {} : { ativar_ao_assinar: false, recibo_automatico: false, lembrete_automatico: false }),
    }

    setSalvando(true)
    try {
      const r = contrato
        ? await enviarJson<{ contrato: Contrato }>(cliente, `/contratos-honorarios/${contrato.id}`, corpo, 'PATCH')
        : await enviarJson<{ contrato: Contrato }>(cliente, '/contratos-honorarios', corpo)
      onSalvo(r.contrato)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao salvar o contrato.')
    } finally {
      setSalvando(false)
    }
  }

  const pendente = open && (buscaCliente.trim() !== ''
    || Object.keys(inicial).some(chave => form[chave as keyof FormContrato] !== inicial[chave as keyof FormContrato]))
  useAlteracoesPendentes(pendente)

  function fechar() {
    confirmarSaida(onClose)
  }

  const totalPrevisto = reaisDeTexto(form.valor_total)
  const totalPrevistoCentavos = totalPrevisto === null ? null : Math.round(totalPrevisto * 100)
  const totalParcelasCentavos = previa ? somaParcelas(previa) : 0

  return (
    <Dialog.Root open={open} onOpenChange={(novoAberto) => !novoAberto && fechar()}>
      <Dialog.Content maxWidth="760px" maxHeight="90vh">
        <Dialog.Title>{contrato ? 'Editar contrato' : 'Novo contrato'}</Dialog.Title>
        <Dialog.Description>
          {contrato
            ? 'Ajuste os dados permitidos e salve. As parcelas já lançadas no Financeiro não são recalculadas.'
            : 'O contrato nasce como rascunho; as parcelas só entram no Financeiro quando você ativar.'}
        </Dialog.Description>

        <Flex direction="column" gap="5" mt="4">
          {erroBase && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erroBase}</Callout.Text>
            </Callout.Root>
          )}

          {travado && (
            <Callout.Root color="blue" size="1">
              <Callout.Text>
                Contrato vigente: cliente, processo, valor, entrada, parcelas e vencimentos já foram lançados no Financeiro.
                Aqui você ajusta título, êxito, vigência e documento.
              </Callout.Text>
            </Callout.Root>
          )}

          <Heading as="h4" size="2">Dados do contrato</Heading>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="contrato-titulo">Título *</label>
            <TextField.Root
              id="contrato-titulo"
              placeholder="Ex.: Honorários iniciais — Silva x Banco"
              autoComplete="off"
              maxLength={200}
              value={form.titulo}
              onChange={e => mudar({ titulo: e.target.value })}
            />
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-valor">Valor total (R$) *</label>
              <TextField.Root
                id="contrato-valor"
                placeholder="Ex.: 12.000,00"
                autoComplete="off"
                value={form.valor_total}
                disabled={travado}
                onChange={e => mudar({ valor_total: e.target.value })}
              />
              <Text size="1" color="gray">Use vírgula para os centavos.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-entrada">Entrada (R$)</label>
              <TextField.Root
                id="contrato-entrada"
                placeholder="Opcional"
                autoComplete="off"
                value={form.entrada}
                disabled={travado}
                onChange={e => mudar({ entrada: e.target.value })}
              />
              <Text size="1" color="gray">Deixe em branco para não ter entrada.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-entrada-vencimento">Vencimento da entrada</label>
              <CampoData
                id="contrato-entrada-vencimento"
                value={form.entrada_vencimento}
                disabled={travado}
                onChange={v => mudar({ entrada_vencimento: v })}
              />
              <Text size="1" color="gray">Sem data, a entrada vence junto com a primeira parcela.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-parcelas">Número de parcelas *</label>
              <TextField.Root
                id="contrato-parcelas"
                type="number"
                min={1}
                max={120}
                value={form.parcelas}
                disabled={travado}
                onChange={e => mudar({ parcelas: e.target.value })}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-primeiro-vencimento">Primeiro vencimento *</label>
              <CampoData
                id="contrato-primeiro-vencimento"
                value={form.primeiro_vencimento}
                disabled={travado}
                onChange={v => mudar({ primeiro_vencimento: v })}
              />
            </div>
          </div>

          <Heading as="h4" size="2">Cliente e processo</Heading>
          {carregandoBase ? <Carregamento tipo="detalhe" descricao="Carregando clientes e processos…" /> : <>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-cliente-busca">Cliente *</label>
              <TextField.Root
                id="contrato-cliente-busca"
                placeholder="Busque por nome ou CPF/CNPJ"
                autoComplete="off"
                disabled={travado}
                value={clienteSelecionado ? formatarNomeExibicao(clienteSelecionado.nome) : buscaCliente}
                onChange={e => limparCliente(e.target.value)}
              />
            </div>
            {resultadosBusca.length > 0 && (
              <Flex direction="column" gap="1" className="busca-resultados">
                {resultadosBusca.map(c => (
                  <button key={c.id} type="button" className="aj-busca-item" onClick={() => escolherCliente(c)}>
                    {formatarNomeExibicao(c.nome)}
                    {c.cpf_cnpj ? ` — ${c.cpf_cnpj}` : ''}
                  </button>
                ))}
              </Flex>
            )}
            {buscaCliente.trim() && !clienteSelecionado && resultadosBusca.length === 0 && (
              <Text size="2" color="gray">Nenhum cliente encontrado.</Text>
            )}

            <div className="aj-form-grade">
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contrato-processo">Processo (opcional)</label>
                <Select.Root
                  value={form.caso_id || '__sem__'}
                  onValueChange={v => mudar({ caso_id: v === '__sem__' ? '' : v })}
                  disabled={travado || !clienteSelecionado}
                >
                  <Select.Trigger id="contrato-processo" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__sem__">Sem processo</Select.Item>
                    {processosDoCliente.map(c => (
                      <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.titulo || 'Sem título')}</Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {clienteSelecionado && processosDoCliente.length === 0 && (
                  <Text size="1" color="gray">Este cliente não tem processos cadastrados.</Text>
                )}
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contrato-documento">Documento vinculado (opcional)</label>
                <Select.Root
                  value={form.documento_id || '__sem__'}
                  onValueChange={v => mudar({ documento_id: v === '__sem__' ? '' : v })}
                  disabled={!form.cliente_id || consultaDocumentos.isLoading}
                >
                  <Select.Trigger id="contrato-documento" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__sem__">Sem documento</Select.Item>
                    {documentos.map(d => <Select.Item key={d.id} value={String(d.id)}>{d.nome}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
                {form.cliente_id && !consultaDocumentos.isLoading && documentos.length === 0 && (
                  <Text size="1" color="gray">Nenhum documento deste cliente.</Text>
                )}
              </div>
            </div>
          </>}

          <Heading as="h4" size="2">Êxito e vigência</Heading>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-exito">Êxito (%)</label>
              <TextField.Root
                id="contrato-exito"
                placeholder="Opcional, ex.: 20"
                inputMode="decimal"
                autoComplete="off"
                value={form.exito_percentual}
                onChange={e => mudar({ exito_percentual: e.target.value })}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-exito-descricao">Descrição do êxito</label>
              <TextArea
                id="contrato-exito-descricao"
                placeholder="Ex.: 20% sobre o valor recuperado"
                rows={2}
                value={form.exito_descricao}
                onChange={e => mudar({ exito_descricao: e.target.value })}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-vigencia-inicio">Início da vigência</label>
              <CampoData
                id="contrato-vigencia-inicio"
                value={form.vigencia_inicio}
                onChange={v => mudar({ vigencia_inicio: v })}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contrato-vigencia-fim">Fim da vigência</label>
              <CampoData
                id="contrato-vigencia-fim"
                value={form.vigencia_fim}
                onChange={v => mudar({ vigencia_fim: v })}
              />
            </div>
          </div>
          <Text size="1" color="gray">
            O êxito fica só registrado no contrato. O lançamento do valor recebido é feito à mão no Financeiro depois.
          </Text>

          {erroPrevia && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erroPrevia}</Callout.Text>
            </Callout.Root>
          )}
          {!previa && carregandoPrevia && <Text size="2" color="gray">Calculando a prévia das parcelas…</Text>}
          {previa && previa.length > 0 && (
            <div>
              <Flex justify="between" align="center" gap="3" wrap="wrap" mb="2">
                <Heading as="h4" size="2">Prévia das parcelas</Heading>
                {carregandoPrevia && <Text size="1" color="gray">Atualizando…</Text>}
              </Flex>
              <Table.Root variant="surface" size="1">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Parcela</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Vencimento</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Valor</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {previa.map(p => (
                    <Table.Row key={p.numero}>
                      <Table.Cell>{p.rotulo}</Table.Cell>
                      <Table.Cell>{formatarDataSimples(p.vencimento)}</Table.Cell>
                      <Table.Cell justify="end">{formatarMoeda(p.valor)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Flex justify="between" align="baseline" gap="3" mt="2" wrap="wrap">
                <Text size="2" color="gray">Total das parcelas</Text>
                <Text size="2" weight="bold">{formatarMoeda(totalParcelasCentavos / 100)}</Text>
              </Flex>
              {totalPrevistoCentavos !== null && totalParcelasCentavos !== totalPrevistoCentavos
                ? (
                  <Callout.Root color="amber" size="1" mt="2">
                    <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                    <Callout.Text>A soma das parcelas não confere com o valor total do contrato.</Callout.Text>
                  </Callout.Root>
                )
                : <Text as="p" size="1" color="green" mt="1">Total confere com o valor do contrato.</Text>}
            </div>
          )}

          {erros.length > 0 && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>
                {erros.map(mensagem => <div key={mensagem}>{mensagem}</div>)}
              </Callout.Text>
            </Callout.Root>
          )}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}

          <Flex gap="3" justify="end">
            <Button size="2" variant="soft" color="gray" onClick={fechar}>Cancelar</Button>
            <Button size="2" onClick={() => void salvar()} loading={salvando} disabled={carregandoBase}>
              {contrato ? 'Salvar alterações' : 'Salvar rascunho'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
