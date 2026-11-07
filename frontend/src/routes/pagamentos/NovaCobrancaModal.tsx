import CampoData from '../../CampoData'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Checkbox, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
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
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) { limpar(); onClose() } }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Nova cobrança</Dialog.Title>
        <Flex direction="column" gap="5">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="cobranca-cliente-cpf">Cliente (CPF/CNPJ) *</label>
            <TextField.Root
              id="cobranca-cliente-cpf"
              placeholder="Ex.: 123.456.789-00"
              autoComplete="off"
              value={cpfCnpj}
              onChange={(e) => aoDigitarCpfCnpj(e.target.value)}
            />
            {statusCpfCnpj() && <Text size="1" color="gray">{statusCpfCnpj()}</Text>}
          </div>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={parcelar} onCheckedChange={(checked) => setParcelar(Boolean(checked))} />
              Parcelar
            </Flex>
          </Text>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="cobranca-tipo">Tipo de cobrança *</label>
              <Select.Root value={tipo} onValueChange={(v) => setTipo(v as 'BOLETO' | 'PIX')}>
                <Select.Trigger id="cobranca-tipo" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="BOLETO">Boleto</Select.Item>
                  <Select.Item value="PIX">Pix</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            {parcelar && (
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="cobranca-parcelas">Quantidade de parcelas *</label>
                <TextField.Root
                  id="cobranca-parcelas"
                  type="number"
                  min={2}
                  max={60}
                  value={String(parcelas)}
                  onChange={(e) => setParcelas(Number(e.target.value) || 2)}
                />
              </div>
            )}
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="cobranca-valor">{parcelar ? 'Valor total *' : 'Valor *'}</label>
              <TextField.Root
                id="cobranca-valor"
                type="number"
                placeholder="Ex.: 1500.00"
                min="0.01"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="cobranca-vencimento">Vencimento *</label>
              <CampoData
                id="cobranca-vencimento"
                value={vencimento}
                onChange={v => setVencimento(v)}
              />
            </div>
          </div>
          <PreviaParcelas parcelar={parcelar} valor={valor} parcelas={parcelas} vencimento={vencimento} />
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="cobranca-descricao">Descrição</label>
            <TextField.Root
              id="cobranca-descricao"
              placeholder="Ex.: Honorários - parcela 1/3"
              autoComplete="off"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="2" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">Cancelar</Button>
            </Dialog.Close>
            <Button size="2" disabled={enviando} onClick={criar}>Criar cobrança</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
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
