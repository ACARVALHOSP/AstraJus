import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COR_SITUACAO_CONTRATO, FORM_CONTRATO_VAZIO, ROTULO_SITUACAO_CONTRATO, dataValida, formDeContrato,
  reaisDeTexto, reaisParaTexto, situacaoParcela, somaParcelas, validarContrato,
} from '../src/routes/financeiro/dadosContrato.ts'

const HOJE = '2026-11-17'

const formulario = (extra = {}) => ({
  ...FORM_CONTRATO_VAZIO,
  cliente_id: 'cliente-1',
  titulo: 'Honorários iniciais',
  valor_total: '1.000,00',
  parcelas: '3',
  primeiro_vencimento: '2026-01-31',
  ...extra,
})

test('rótulos e cores de situação do contrato', () => {
  assert.deepEqual(ROTULO_SITUACAO_CONTRATO, {
    rascunho: 'Rascunho', vigente: 'Vigente', encerrado: 'Encerrado', cancelado: 'Cancelado',
  })
  assert.deepEqual(COR_SITUACAO_CONTRATO, {
    rascunho: 'gray', vigente: 'green', encerrado: 'blue', cancelado: 'red',
  })
})

test('dinheiro em reais: texto brasileiro, zero e inválidos', () => {
  assert.equal(reaisDeTexto('1.500,00'), 1500)
  assert.equal(reaisDeTexto('1500'), 1500)
  assert.equal(reaisDeTexto('0,00'), 0)
  assert.equal(reaisDeTexto(''), null)
  assert.equal(reaisDeTexto('1000.50'), null)
  assert.equal(reaisDeTexto('abc'), null)
  assert.equal(reaisParaTexto(1500), '1.500,00')
})

test('data válida exige formato e dia existente', () => {
  assert.equal(dataValida('2026-02-28'), true)
  assert.equal(dataValida('2026-02-30'), false)
  assert.equal(dataValida('31/01/2026'), false)
  assert.equal(dataValida(''), false)
})

test('validação espelha as regras do servidor', () => {
  assert.deepEqual(validarContrato(formulario()), [])

  const tem = (extra, trecho) => assert.ok(
    validarContrato(formulario(extra)).some(mensagem => mensagem.includes(trecho)),
    `esperava mensagem com "${trecho}" para ${JSON.stringify(extra)}`,
  )

  tem({ titulo: '' }, 'título')
  tem({ titulo: 'x'.repeat(201) }, 'título')
  tem({ valor_total: '' }, 'valor total')
  tem({ valor_total: '0,00' }, 'maior que zero')
  tem({ entrada: '1.000,00' }, 'entrada deve ser menor')
  tem({ entrada: '2.000,00' }, 'entrada deve ser menor')
  tem({ parcelas: '0' }, 'parcelas')
  tem({ parcelas: '121' }, 'parcelas')
  tem({ parcelas: '2,5' }, 'parcelas')
  tem({ primeiro_vencimento: '' }, 'primeiro vencimento')
  tem({ primeiro_vencimento: '31/01/2026' }, 'primeiro vencimento')
  tem({ entrada: '100,00', entrada_vencimento: '31/01/2026' }, 'vencimento da entrada')
  tem({ exito_percentual: '101' }, 'êxito')
  tem({ exito_percentual: '-1' }, 'êxito')
  tem({ vigencia_inicio: '2026-12-01', vigencia_fim: '2026-11-01' }, 'início da vigência')
  tem({ vigencia_inicio: '01/12/2026' }, 'início da vigência')
})

test('entrada zero e datas opcionais em branco são aceitas', () => {
  assert.deepEqual(validarContrato(formulario({ entrada: '0,00', entrada_vencimento: '' })), [])
  assert.deepEqual(validarContrato(formulario({ exito_percentual: '0', exito_descricao: '' })), [])
  assert.deepEqual(validarContrato(formulario({ vigencia_inicio: '', vigencia_fim: '' })), [])
})

test('soma das parcelas em centavos fecha o total', () => {
  assert.equal(somaParcelas([{ valor: 333.33 }, { valor: 333.33 }, { valor: 333.34 }]), 100000)
  assert.equal(somaParcelas([{ valor: 100 }, { valor: 300 }, { valor: 300 }, { valor: 300 }]), 100000)
  assert.equal(somaParcelas([]), 0)
})

test('situação de cada parcela: paga, vencida e em aberto', () => {
  assert.equal(situacaoParcela({ pago: true, vencimento: '2026-11-01' }, HOJE), 'paga')
  assert.equal(situacaoParcela({ pago: false, vencimento: '2026-11-16' }, HOJE), 'vencida')
  assert.equal(situacaoParcela({ pago: false, vencimento: '2026-11-17' }, HOJE), 'aberta')
  assert.equal(situacaoParcela({ pago: false, vencimento: undefined }, HOJE), 'aberta')
})

test('formulário de edição preserva os dados do contrato', () => {
  const contrato = {
    id: 'c1', cliente_id: 'cliente-1', caso_id: null, documento_id: 12, titulo: 'Honorários',
    valor_total: 1000, entrada: 100, entrada_vencimento: '2026-01-15', parcelas: 3,
    primeiro_vencimento: '2026-01-31', exito_percentual: 10, exito_descricao: 'Ao final',
    vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31', situacao: 'rascunho',
    responsavel: 'ana@teste.com', ativar_ao_assinar: false, recibo_automatico: false,
    lembrete_automatico: false, criado_em: '', atualizado_em: '', ativado_em: null,
  }
  assert.deepEqual(formDeContrato(contrato), {
    cliente_id: 'cliente-1', caso_id: '', documento_id: '12', titulo: 'Honorários',
    valor_total: '1.000,00', entrada: '100,00', entrada_vencimento: '2026-01-15',
    parcelas: '3', primeiro_vencimento: '2026-01-31', exito_percentual: '10',
    exito_descricao: 'Ao final', vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31',
  })
})
