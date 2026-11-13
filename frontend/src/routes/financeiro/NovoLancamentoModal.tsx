import { confirmarSaida, useAlteracoesPendentes } from '../../AlteracoesPendentes'
import CampoData from '../../CampoData'
import Carregamento from '../../Carregamento'
import PreviaParcelas from '../../PreviaParcelas'
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Checkbox, Dialog, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { useCasos, useClientes } from '../../api/consultas'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { calcularValoresParcelas, somarMeses, valorLancamentoEmReais } from '../../utils/parcelas'

type ClienteBusca = { id: string; nome: string; cpf_cnpj?: string }
type CasoOpcao = { id: string; titulo?: string; cliente_id?: string; clientes_adicionais?: string[] }

const SEM_CLIENTES: ClienteBusca[] = []
const SEM_CASOS: CasoOpcao[] = []

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export type TipoLancamento = 'HONORARIO' | 'EXITO' | 'CUSTAS' | 'REPASSE' | 'OUTRO'
export const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamento, string> = {
  HONORARIO: 'Honorário contratual', EXITO: 'Honorário de êxito', CUSTAS: 'Custas e despesas do processo',
  REPASSE: 'Repasse (ao cliente ou a terceiros)', OUTRO: 'Outro',
}
/** Lançamento aberto a partir de outro (ex.: repasse de um valor recebido). */
export type Predefinido = { tipo: TipoLancamento; clienteId: string; casoId: string; valor?: number; descricao?: string; origemId?: string; favorecido?: string }

export default function NovoLancamentoModal({ open, onClose, onSalvo, predefinido }: {
  open: boolean; onClose: () => void; onSalvo: () => void; predefinido?: Predefinido | null
}) {
  const { cliente } = useCliente()
  // Clientes e processos só são consultados com o diálogo aberto; vêm do cache compartilhado.
  const consultaClientes = useClientes<ClienteBusca>({ enabled: open && Boolean(cliente) })
  const consultaCasos = useCasos<CasoOpcao>({ enabled: open && Boolean(cliente) })
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const casos = consultaCasos.data ?? SEM_CASOS
  const carregandoBase = open && (consultaClientes.isLoading || consultaCasos.isLoading)
  const falhaBase = consultaClientes.error ?? consultaCasos.error
  const erroBase = falhaBase ? (falhaBase instanceof ErroMCP ? falhaBase.message : 'Falha ao carregar clientes/processos.') : null

  const [buscaCliente, setBuscaCliente] = useState('')
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteBusca | null>(null)
  const [casosSelecionados, setCasosSelecionados] = useState<Set<string>>(new Set())

  const [tipo, setTipo] = useState<TipoLancamento>('HONORARIO')
  const [direcao, setDirecao] = useState<'RECEITA' | 'DESPESA'>('RECEITA')
  const [reembolsavel, setReembolsavel] = useState(false)
  const [favorecido, setFavorecido] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [recorrente, setRecorrente] = useState(false)
  const [parcelar, setParcelar] = useState(false)
  const [parcelas, setParcelas] = useState(2)
  const [responsavel, setResponsavel] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const clientePre = predefinido ? clientes.find(x => x.id === predefinido.clienteId) : undefined
  useEffect(() => {
    if (!open || !predefinido || carregandoBase) return
    if (!clientePre) return
    const c = clientePre
    // eslint-disable-next-line react/set-state-in-effect
    setClienteSelecionado(c); setCasosSelecionados(new Set([predefinido.casoId]))
    setTipo(predefinido.tipo); setDirecao(predefinido.tipo === 'REPASSE' || predefinido.tipo === 'CUSTAS' ? 'DESPESA' : 'RECEITA')
    if (predefinido.valor) setValor(String(predefinido.valor).replace('.', ','))
    if (predefinido.descricao) setDescricao(predefinido.descricao)
    if (predefinido.favorecido) setFavorecido(predefinido.favorecido)
    // Reaplica só quando o cliente do atalho aparece: uma recarga da lista não pode apagar o que foi digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, predefinido, carregandoBase, clientePre?.id])

  function limpar() {
    setBuscaCliente('')
    setClienteSelecionado(null)
    setCasosSelecionados(new Set())
    setTipo('HONORARIO')
    setDirecao('RECEITA')
    setReembolsavel(false)
    setFavorecido('')
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
    if (tipo === 'REPASSE' && !favorecido.trim()) {
      setErro('Informe a quem o repasse será feito.')
      return
    }
    setSalvando(true)
    try {
      // O servidor divide o valor em parcelas (centavos exatos) e cria o grupo de uma vez.
      for (const casoId of casosSelecionados) {
        await enviarJson(cliente, '/lancamentos', {
          tipo, vencimento, valor: valorNumerico, descricao: descricao.trim(), recorrente,
          parcelas: parcelar ? parcelas : 1, caso_id: casoId, cliente_id: clienteSelecionado.id,
          responsavel: responsavel.trim(), direcao,
          ...(tipo === 'CUSTAS' ? { reembolsavel } : {}),
          ...(tipo === 'REPASSE' ? { favorecido: favorecido.trim(), ...(predefinido?.origemId ? { origem_id: predefinido.origemId } : {}) } : {}),
        })
      }
      limpar()
      onSalvo()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao salvar lançamento.')
    } finally {
      setSalvando(false)
    }
  }

  const pendente = open && Boolean(clienteSelecionado || buscaCliente.trim() || descricao.trim() || valor.trim() || vencimento || responsavel)
  useAlteracoesPendentes(pendente)
  function fechar() {
    confirmarSaida(() => { limpar(); onClose() })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(novoAberto) => !novoAberto && fechar()}>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>{predefinido?.tipo === 'REPASSE' ? 'Registrar repasse' : 'Adicionar lançamento'}</Dialog.Title>
        <Dialog.Description>Honorários, custas do processo, repasses e outros valores a receber ou a pagar. Os campos com * são obrigatórios.</Dialog.Description>
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
              <label className="form-campo-label" htmlFor="honorario-tipo">Categoria *</label>
              <Select.Root value={tipo} onValueChange={(v) => {
                const t = v as TipoLancamento
                setTipo(t)
                // Custas e repasses são saídas; honorários, entradas; "Outro" deixa escolher.
                if (t === 'CUSTAS' || t === 'REPASSE') setDirecao('DESPESA')
                else if (t !== 'OUTRO') setDirecao('RECEITA')
              }}>
                <Select.Trigger id="honorario-tipo" style={{ width: '100%' }} />
                <Select.Content>
                  {(Object.keys(ROTULO_TIPO_LANCAMENTO) as TipoLancamento[]).map(t => <Select.Item key={t} value={t}>{ROTULO_TIPO_LANCAMENTO[t]}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
            {tipo === 'OUTRO' && (
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="honorario-direcao">Sentido *</label>
                <Select.Root value={direcao} onValueChange={(v) => setDirecao(v as 'RECEITA' | 'DESPESA')}>
                  <Select.Trigger id="honorario-direcao" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="RECEITA">A receber</Select.Item>
                    <Select.Item value="DESPESA">A pagar</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
            )}
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
                  max={120}
                  value={parcelas}
                  onChange={(e) => setParcelas(Number(e.target.value) || 2)}
                />
              </div>
            )}
          </div>
          {tipo === 'CUSTAS' && (
            <Text as="label" size="2">
              <Flex gap="2" align="center">
                <Checkbox checked={reembolsavel} onCheckedChange={(c) => setReembolsavel(Boolean(c))} />
                O cliente deve reembolsar esta custa
              </Flex>
            </Text>
          )}
          {tipo === 'REPASSE' && (
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="honorario-favorecido">Repassar a *</label>
              <TextField.Root id="honorario-favorecido" placeholder="Ex.: nome do cliente ou do advogado parceiro" autoComplete="off" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} />
            </div>
          )}
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
            <Button onClick={salvar} loading={salvando} disabled={carregandoBase}>Salvar lançamento</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
