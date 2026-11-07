import CampoData from '../../CampoData'
import Carregamento from '../../Carregamento'
import PreviaParcelas from '../../PreviaParcelas'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Checkbox, Dialog, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
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

  function fechar() {
    limpar()
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(novoAberto) => !novoAberto && fechar()}>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>Adicionar lançamento</Dialog.Title>
        <Dialog.Description>Registre um valor a receber ou a pagar. Os campos com * são obrigatórios.</Dialog.Description>
        <Flex direction="column" gap="5" mt="4">
          {erroBase && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erroBase}</Callout.Text>
            </Callout.Root>
          )}

          <div className="form-campo">
            <label className="form-campo-label" htmlFor="honorario-descricao">Descrição *</label>
            <TextField.Root
              id="honorario-descricao"
              placeholder="Ex.: Honorários iniciais, Parcela contratual"
              autoComplete="off"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-direcao">Tipo de lançamento *</label>
              <Select.Root value={direcao} onValueChange={(v) => setDirecao(v as 'RECEITA' | 'DESPESA')}>
                <Select.Trigger id="honorario-direcao" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="RECEITA">A receber</Select.Item>
                  <Select.Item value="DESPESA">A pagar</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-valor">Valor (R$) *</label>
              <TextField.Root
                id="honorario-valor"
                placeholder="Ex.: 1.500,00"
                autoComplete="off"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <Text size="1" color="gray">Use vírgula para os centavos.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-vencimento">Vencimento *</label>
              <CampoData id="honorario-vencimento" value={vencimento} onChange={v => setVencimento(v)} />
            </div>
            {parcelar && (
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="honorario-parcelas">Quantidade de parcelas *</label>
                <TextField.Root
                  id="honorario-parcelas"
                  type="number"
                  min={2}
                  max={60}
                  value={parcelas}
                  onChange={(e) => setParcelas(Number(e.target.value) || 2)}
                />
              </div>
            )}
          </div>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={recorrente} onCheckedChange={(checked) => setRecorrente(Boolean(checked))} />
              Repetir mensalmente
            </Flex>
          </Text>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={parcelar} onCheckedChange={(checked) => setParcelar(Boolean(checked))} />
              Parcelar
            </Flex>
          </Text>
          {previewParcelas && <PreviaParcelas parcelas={previewParcelas} quantidade={parcelas} />}

          <Heading as="h4" size="2">Vínculos e responsabilidade</Heading>
          {carregandoBase ? <Carregamento tipo="detalhe" descricao="Carregando clientes e processos…" /> : <>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-cliente-busca">Cliente *</label>
              <TextField.Root
                id="honorario-cliente-busca"
                placeholder="Busque por nome ou CPF/CNPJ"
                autoComplete="off"
                value={clienteSelecionado ? formatarNomeExibicao(clienteSelecionado.nome) : buscaCliente}
                onChange={(e) => {
                  setClienteSelecionado(null)
                  setCasosSelecionados(new Set())
                  setBuscaCliente(e.target.value)
                }}
              />
            </div>
            {resultadosBusca.length > 0 && (
              <Flex direction="column" gap="1" className="busca-resultados">
                {resultadosBusca.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="aj-busca-item"
                    onClick={() => {
                      setClienteSelecionado(c)
                      setBuscaCliente('')
                    }}
                  >
                    {formatarNomeExibicao(c.nome)}
                    {c.cpf_cnpj ? ` — ${c.cpf_cnpj}` : ''}
                  </button>
                ))}
              </Flex>
            )}
            {buscaCliente.trim() && !clienteSelecionado && resultadosBusca.length === 0 && <Text size="2" color="gray">Nenhum cliente encontrado.</Text>}

            <div className="form-campo">
              <Text as="p" size="2" weight="medium">Processos do cliente *</Text>
              {!clienteSelecionado && <Text size="2" color="gray">Selecione o cliente para ver os processos vinculados.</Text>}
              {clienteSelecionado && processosDoCliente.length === 0 && <Text size="2" color="gray">Esse cliente não tem processos cadastrados.</Text>}
              <Flex direction="column" gap="2" mt="1">
                {processosDoCliente.map((caso) => (
                  <Text as="label" size="2" key={caso.id}>
                    <Flex gap="2" align="center">
                      <Checkbox
                        checked={casosSelecionados.has(caso.id)}
                        onCheckedChange={(checked) => alternarCaso(caso.id, Boolean(checked))}
                      />
                      {formatarNomeExibicao(caso.titulo || 'Sem título')}
                    </Flex>
                  </Text>
                ))}
              </Flex>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-responsavel">Responsável *</label>
              <TextField.Root id="honorario-responsavel" placeholder="Ex.: Dra. Fernanda Reis" autoComplete="off" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
            </div>
          </>}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" onClick={fechar}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || carregandoBase}>Salvar lançamento</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
