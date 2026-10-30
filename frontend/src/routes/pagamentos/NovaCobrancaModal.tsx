import { useState } from 'react'
import { Checkbox, Column, Grid, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { mascaraCpfCnpj } from '../../utils/mascaras'
import TabelaParcelas from '../../PreviaParcelas'
import { calcularValoresParcelas, somarMeses } from '../../utils/parcelas'

type Cliente = { id: string; nome?: string; cpf_cnpj?: string }

export default function NovaCobrancaModal({
  open,
  clientes,
  onClose,
  onCriada,
}: {
  open: boolean
  clientes: Cliente[]
  onClose: () => void
  onCriada: () => void
}) {
  const { cliente } = useCliente()
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [clienteEncontrado, setClienteEncontrado] = useState<Cliente | null>(null)
  const [tipo, setTipo] = useState<'BOLETO' | 'PIX'>('BOLETO')
  const [parcelar, setParcelar] = useState(false)
  const [parcelas, setParcelas] = useState(2)
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function limpar() {
    setCpfCnpj('')
    setClienteEncontrado(null)
    setTipo('BOLETO')
    setParcelar(false)
    setParcelas(2)
    setValor('')
    setVencimento('')
    setDescricao('')
    setErro(null)
  }

  function aoDigitarCpfCnpj(valorDigitado: string) {
    const mascarado = mascaraCpfCnpj(valorDigitado)
    setCpfCnpj(mascarado)
    const digitos = mascarado.replace(/\D/g, '')
    setClienteEncontrado(digitos.length >= 11 ? clientes.find((c) => (c.cpf_cnpj ?? '').replace(/\D/g, '') === digitos) ?? null : null)
  }

  function statusCpfCnpj(): string {
    const digitos = cpfCnpj.replace(/\D/g, '')
    if (!digitos) return 'Digite o CPF/CNPJ de um cliente já cadastrado.'
    if (clienteEncontrado) return `Cliente: ${clienteEncontrado.nome}`
    if (digitos.length >= 11) return 'Nenhum cliente cadastrado com esse CPF/CNPJ.'
    return ''
  }

  async function criar() {
    setErro(null)
    if (!clienteEncontrado) {
      setErro('Digite o CPF/CNPJ de um cliente já cadastrado antes de criar a cobrança.')
      return
    }
    setEnviando(true)
    try {
      await enviarJson(cliente, '/pagamentos', {
        cliente_id: clienteEncontrado.id,
        billing_type: tipo,
        valor,
        vencimento: vencimento.trim(),
        descricao: descricao.trim(),
        ...(parcelar ? { parcelas } : {}),
      })
      limpar()
      onCriada()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao criar cobrança.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal closeButtonLabel="Fechar"
      open={open}
      modalHeading="Nova cobrança"
      primaryButtonText="Criar cobrança"
      secondaryButtonText="Cancelar"
      primaryButtonDisabled={enviando}
      onRequestClose={() => {
        limpar()
        onClose()
      }}
      onRequestSubmit={criar}
    >
      <Stack gap={5}>
        <TextInput
          id="cobranca-cliente-cpf"
          labelText="Cliente (CPF/CNPJ) *"
          placeholder="Ex.: 123.456.789-00"
          autoComplete="off"
          helperText={statusCpfCnpj()}
          value={cpfCnpj}
          onChange={(e) => aoDigitarCpfCnpj(e.target.value)}
        />
        <Checkbox id="cobranca-parcelar" labelText="Parcelar" checked={parcelar} onChange={(_e, { checked }) => setParcelar(checked)} />
        <Grid narrow fullWidth>
          <Column sm={4} md={2} lg={3}>
            <Select id="cobranca-tipo" labelText="Tipo de cobrança *" value={tipo} onChange={(e) => setTipo(e.target.value as 'BOLETO' | 'PIX')}>
              <SelectItem value="BOLETO" text="Boleto" />
              <SelectItem value="PIX" text="Pix" />
            </Select>
          </Column>
          {parcelar && (
            <Column sm={4} md={2} lg={4}>
              <TextInput
                id="cobranca-parcelas"
                type="number"
                labelText="Quantidade de parcelas *"
                min={2}
                max={60}
                value={String(parcelas)}
                onChange={(e) => setParcelas(Number(e.target.value) || 2)}
              />
            </Column>
          )}
          <Column sm={4} md={2} lg={4}>
            <TextInput
              id="cobranca-valor"
              type="number"
              labelText={parcelar ? 'Valor total *' : 'Valor *'}
              placeholder="Ex.: 1500.00"
              min="0.01"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </Column>
          <Column sm={4} md={2} lg={4}>
            <TextInput
              id="cobranca-vencimento"
              labelText="Vencimento *"
              placeholder="aaaa-mm-dd"
              autoComplete="off"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
          </Column>
        </Grid>
        <PreviaParcelas parcelar={parcelar} valor={valor} parcelas={parcelas} vencimento={vencimento} />
        <TextInput
          id="cobranca-descricao"
          labelText="Descrição"
          placeholder="Ex.: Honorários - parcela 1/3"
          autoComplete="off"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </Stack>
    </Modal>
  )
}

function PreviaParcelas({ parcelar, valor, parcelas, vencimento }: { parcelar: boolean; valor: string; parcelas: number; vencimento: string }) {
  const total = Number(valor)
  if (!parcelar || !(total > 0) || !(parcelas >= 2) || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null
  const valoresCentavos = calcularValoresParcelas(Math.round(total * 100), parcelas)
  return (
    <TabelaParcelas
      quantidade={parcelas}
      descricao="As parcelas serão geradas pelo Asaas ao confirmar a cobrança."
      parcelas={valoresCentavos.map((centavos, i) => ({
        numero: i + 1,
        vencimento: somarMeses(vencimento, i),
        valor: centavos / 100,
      }))}
    />
  )
}
