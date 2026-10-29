import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { Checkbox, Column, DatePicker, DatePickerInput, Grid, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDdMmAaaa, formatarMoeda, formatarNomeExibicao } from '../../utils/formatadores'
import { calcularValoresParcelas, somarMeses, valorLancamentoEmReais } from '../../utils/parcelas'

type ClienteBusca = { id: string; nome: string; cpf_cnpj?: string }
type CasoOpcao = { id: string; titulo?: string; cliente_id?: string; clientes_adicionais?: string[] }

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function NovoLancamentoModal({ open, onClose, onSalvo }: { open: boolean; onClose: () => void; onSalvo: () => void }) {
  const { cliente } = useCliente()
  const [clientes, setClientes] = useState<ClienteBusca[]>([])
  const [casos, setCasos] = useState<CasoOpcao[]>([])
  const [carregandoBase, setCarregandoBase] = useState(false)
  const [erroBase, setErroBase] = useState<string | null>(null)

  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteBusca | null>(null)
  const [casosSelecionados, setCasosSelecionados] = useState<Set<string>>(new Set())

  const [direcao, setDirecao] = useState<'RECEITA' | 'DESPESA'>('RECEITA')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [recorrente, setRecorrente] = useState(false)
  const [parcelar, setParcelar] = useState(false)
  const [parcelas, setParcelas] = useState(2)
  const [responsavel, setResponsavel] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCarregandoBase(true)
    setErroBase(null)
    Promise.all([buscarJson<{ clientes: ClienteBusca[] }>(cliente, '/clientes'), buscarJson<{ casos: CasoOpcao[] }>(cliente, '/casos')])
      .then(([rc, rp]) => {
        setClientes(rc.clientes ?? [])
        setCasos(rp.casos ?? [])
      })
      .catch((e) => setErroBase(e instanceof ErroMCP ? e.message : 'Falha ao carregar clientes/processos.'))
      .finally(() => setCarregandoBase(false))
  }, [open, cliente])

  function limpar() {
    setBuscaCliente('')
    setClienteSelecionado(null)
    setCasosSelecionados(new Set())
    setDirecao('RECEITA')
    setDescricao('')
    setValor('')
    setVencimento('')
    setRecorrente(false)
    setParcelar(false)
    setParcelas(2)
    setResponsavel('')
    setErro(null)
  }

  const termoNormalizado = normalizar(buscaCliente.trim())
  const digitos = buscaCliente.replace(/\D/g, '')
  const resultadosBusca =
    !clienteSelecionado && termoNormalizado
      ? clientes.filter((c) => normalizar(c.nome).includes(termoNormalizado) || (digitos.length >= 3 && (c.cpf_cnpj ?? '').replace(/\D/g, '').includes(digitos))).slice(0, 8)
      : []

  const processosDoCliente = clienteSelecionado
    ? casos.filter((c) => c.cliente_id === clienteSelecionado.id || (c.clientes_adicionais ?? []).includes(clienteSelecionado.id))
    : []

  function alternarCaso(casoId: string, marcado: boolean) {
    setCasosSelecionados((atual) => {
      const novo = new Set(atual)
      if (marcado) novo.add(casoId)
      else novo.delete(casoId)
      return novo
    })
  }

  const valorNumerico = valorLancamentoEmReais(valor)
  const previewParcelas =
    parcelar && valorNumerico && parcelas >= 2 && vencimento
      ? calcularValoresParcelas(Math.round(valorNumerico * 100), parcelas).map((centavos, i) => ({
          numero: i + 1,
          vencimento: somarMeses(vencimento, i),
          valor: centavos / 100,
        }))
      : null

  async function salvar() {
    setErro(null)
    if (valorNumerico === null) {
      setErro('Informe um valor maior que zero, como 1.500,00.')
      return
    }
    if (!clienteSelecionado) {
      setErro('Busque e selecione um cliente cadastrado.')
      return
    }
    if (casosSelecionados.size === 0) {
      setErro('Selecione ao menos um processo do cliente.')
      return
    }
    if (!descricao.trim() || !vencimento || !responsavel.trim()) {
      setErro('Preencha descrição, vencimento e responsável.')
      return
    }
    const quantidade = parcelar ? parcelas : 1
    const listaParcelas = parcelar
      ? calcularValoresParcelas(Math.round(valorNumerico * 100), quantidade).map((centavos, i) => ({
          valor: centavos / 100,
          vencimento: somarMeses(vencimento, i),
          descricao: `${descricao.trim()} (parcela ${i + 1}/${quantidade})`,
        }))
      : [{ valor: valorNumerico, vencimento, descricao: descricao.trim() }]

    setSalvando(true)
    try {
      for (const casoId of casosSelecionados) {
        for (const parcela of listaParcelas) {
          await enviarJson(cliente, '/lancamentos', {
            vencimento: parcela.vencimento,
            valor: parcela.valor,
            descricao: parcela.descricao,
            recorrente,
            caso_id: casoId,
            cliente_id: clienteSelecionado.id,
            responsavel: responsavel.trim(),
            direcao,
          })
        }
      }
      limpar()
      onSalvo()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao salvar lançamento.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal closeButtonLabel="Fechar"
      open={open}
      modalHeading="Adicionar lançamento"
      primaryButtonText="Salvar lançamento"
      secondaryButtonText="Cancelar"
      primaryButtonDisabled={salvando || carregandoBase}
      onRequestClose={() => {
        limpar()
        onClose()
      }}
      onRequestSubmit={salvar}
    >
      <Stack gap={5}>
        <p>Registre um valor a receber ou a pagar. Os campos com * são obrigatórios.</p>
        {erroBase && <InlineNotification kind="error" title="Erro" subtitle={erroBase} lowContrast hideCloseButton />}

        <TextInput
          id="honorario-descricao"
          labelText="Descrição *"
          placeholder="Ex.: Honorários iniciais, Parcela contratual"
          autoComplete="off"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <Grid narrow fullWidth>
          <Column sm={4} md={2} lg={4}>
            <Select id="honorario-direcao" labelText="Tipo de lançamento *" value={direcao} onChange={(e) => setDirecao(e.target.value as 'RECEITA' | 'DESPESA')}>
              <SelectItem value="RECEITA" text="A receber" />
              <SelectItem value="DESPESA" text="A pagar" />
            </Select>
          </Column>
          <Column sm={4} md={2} lg={4}>
            <TextInput
              id="honorario-valor"
              labelText="Valor (R$) *"
              helperText="Use vírgula para os centavos."
              placeholder="Ex.: 1.500,00"
              autoComplete="off"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </Column>
          <Column sm={4} md={2} lg={4}>
            <DatePicker
              datePickerType="single"
              dateFormat="d/m/Y"
              onChange={(datas: Date[]) => setVencimento(datas[0] ? isoDeData(datas[0]) : '')}
            >
              <DatePickerInput id="honorario-vencimento" labelText="Vencimento *" placeholder="dd/mm/aaaa" />
            </DatePicker>
          </Column>
          {parcelar && (
            <Column sm={4} md={2} lg={4}>
              <TextInput
                id="honorario-parcelas"
                type="number"
                labelText="Quantidade de parcelas *"
                min={2}
                max={60}
                value={String(parcelas)}
                onChange={(e) => setParcelas(Number(e.target.value) || 2)}
              />
            </Column>
          )}
        </Grid>
        <Checkbox id="honorario-recorrente" labelText="Repetir mensalmente" checked={recorrente} onChange={(_e, { checked }) => setRecorrente(checked)} />
        <Checkbox id="honorario-parcelar" labelText="Parcelar" checked={parcelar} onChange={(_e, { checked }) => setParcelar(checked)} />
        {previewParcelas && (
          <div>
            <p>Prévia das parcelas:</p>
            <table className="tabela-responsiva">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {previewParcelas.map((p) => (
                  <tr key={p.numero}>
                    <td>
                      {p.numero}/{parcelas}
                    </td>
                    <td>{formatarDdMmAaaa(new Date(p.vencimento + 'T00:00:00'))}</td>
                    <td>{formatarMoeda(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4>Vínculos e responsabilidade</h4>
        {carregandoBase ? <Carregamento tipo="detalhe" descricao="Carregando clientes e processos…" /> : <>
        <TextInput
          id="honorario-cliente-busca"
          labelText="Cliente *"
          placeholder="Busque por nome ou CPF/CNPJ"
          autoComplete="off"
          value={clienteSelecionado ? formatarNomeExibicao(clienteSelecionado.nome) : buscaCliente}
          onChange={(e) => {
            setClienteSelecionado(null)
            setCasosSelecionados(new Set())
            setBuscaCliente(e.target.value)
          }}
        />
        {resultadosBusca.length > 0 && (
          <div className="busca-resultados">
            {resultadosBusca.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClienteSelecionado(c)
                  setBuscaCliente('')
                }}
              >
                {formatarNomeExibicao(c.nome)}
                {c.cpf_cnpj ? ` — ${c.cpf_cnpj}` : ''}
              </button>
            ))}
          </div>
        )}
        {buscaCliente.trim() && !clienteSelecionado && resultadosBusca.length === 0 && <p>Nenhum cliente encontrado.</p>}

        <fieldset className="cds--form-item">
          <legend className="cds--label">Processos do cliente *</legend>
          {!clienteSelecionado && <p>Selecione o cliente para ver os processos vinculados.</p>}
          {clienteSelecionado && processosDoCliente.length === 0 && <p>Esse cliente não tem processos cadastrados.</p>}
          {processosDoCliente.map((caso) => (
            <Checkbox
              key={caso.id}
              id={`honorario-processo-${caso.id}`}
              labelText={formatarNomeExibicao(caso.titulo || 'Sem título')}
              checked={casosSelecionados.has(caso.id)}
              onChange={(_e, { checked }) => alternarCaso(caso.id, checked)}
            />
          ))}
        </fieldset>
        <TextInput id="honorario-responsavel" labelText="Responsável *" placeholder="Ex.: Dra. Fernanda Reis" autoComplete="off" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />

        </>}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </Stack>
    </Modal>
  )
}

function isoDeData(data: Date): string {
  const [dia, mes, ano] = formatarDdMmAaaa(data).split('/')
  return `${ano}-${mes}-${dia}`
}
