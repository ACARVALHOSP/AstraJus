import CampoData from '../../CampoData'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Checkbox, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import TabelaParcelas from '../../PreviaParcelas'
import { calcularValoresParcelas, somarMeses, valorLancamentoEmReais } from '../../utils/parcelas'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { confirmarSaida, useAlteracoesPendentes } from '../../AlteracoesPendentes'

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
  // Busca do cliente por nome ou CPF/CNPJ, como em Novo lançamento.
  const [busca, setBusca] = useState('')
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
    setBusca('')
    setClienteEncontrado(null)
    setTipo('BOLETO')
    setParcelar(false)
    setParcelas(2)
    setValor('')
    setVencimento('')
    setDescricao('')
    setErro(null)
  }

  const termo = normalizar(busca.trim())
  const digitosBusca = busca.replace(/\D/g, '')
  const resultados = !clienteEncontrado && termo
    ? clientes.filter(c => normalizar(c.nome ?? '').includes(termo)
        || (digitosBusca.length >= 3 && (c.cpf_cnpj ?? '').replace(/\D/g, '').includes(digitosBusca))).slice(0, 8)
    : []
  const valorNumerico = valorLancamentoEmReais(valor)
  const pendente = open && Boolean(clienteEncontrado || busca.trim() || valor.trim() || vencimento || descricao.trim())
  useAlteracoesPendentes(pendente)

  function fechar() {
    confirmarSaida(() => { limpar(); onClose() })
  }

  async function criar() {
    setErro(null)
    if (!clienteEncontrado) {
      setErro('Escolha o cliente na lista: busque pelo nome ou CPF/CNPJ.')
      return
    }
    if (valorNumerico === null) {
      setErro('Informe um valor maior que zero, como 1.500,00.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
      setErro('Informe a data de vencimento.')
      return
    }
    if (!clienteEncontrado.cpf_cnpj) {
      setErro('Este cliente não tem CPF/CNPJ no cadastro, e o Asaas exige o documento. Complete o cadastro em Contatos.')
      return
    }
    setEnviando(true)
    try {
      await enviarJson(cliente, '/pagamentos', {
        cliente_id: clienteEncontrado.id,
        billing_type: tipo,
        valor: valorNumerico,
        vencimento: vencimento.trim(),
        descricao: descricao.trim(),
        ...(parcelar ? { parcelas } : {}),
      })
      limpar()
      onCriada()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível criar a cobrança. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) fechar() }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Nova cobrança</Dialog.Title>
        <Flex direction="column" gap="5">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="cobranca-cliente">Cliente *</label>
            <TextField.Root
              id="cobranca-cliente"
              placeholder="Busque por nome ou CPF/CNPJ"
              autoComplete="off"
              value={clienteEncontrado ? formatarNomeExibicao(clienteEncontrado.nome) : busca}
              onChange={(e) => { setClienteEncontrado(null); setBusca(e.target.value) }}
            />
            {resultados.length > 0 && (
              <Flex direction="column" gap="1" className="busca-resultados" role="listbox" aria-label="Clientes encontrados">
                {resultados.map(c => (
                  <button key={c.id} type="button" role="option" aria-selected={false} className="aj-busca-item"
                    onClick={() => { setClienteEncontrado(c); setBusca('') }}>
                    {formatarNomeExibicao(c.nome)}{c.cpf_cnpj ? ` — ${c.cpf_cnpj}` : ' — sem CPF/CNPJ'}
                  </button>
                ))}
              </Flex>
            )}
            {busca.trim() && !clienteEncontrado && !resultados.length && <Text size="1" color="gray">Nenhum cliente encontrado. Cadastre-o antes em Contatos.</Text>}
            {clienteEncontrado && !clienteEncontrado.cpf_cnpj && <Text size="1" color="red">Este cliente não tem CPF/CNPJ; o Asaas exige o documento.</Text>}
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
                inputMode="decimal"
                placeholder="Ex.: 1.500,00"
                autoComplete="off"
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
          <PreviaParcelas parcelar={parcelar} valor={valorNumerico ?? 0} parcelas={parcelas} vencimento={vencimento} />
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
            <Button variant="soft" color="gray" onClick={fechar}>Cancelar</Button>
            <Button size="2" loading={enviando} onClick={criar}>Criar cobrança</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function PreviaParcelas({ parcelar, valor, parcelas, vencimento }: { parcelar: boolean; valor: number; parcelas: number; vencimento: string }) {
  const total = valor
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
