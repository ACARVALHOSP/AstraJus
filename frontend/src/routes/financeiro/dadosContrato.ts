// Regras puras dos Contratos de honorários (sem React): tipos, rótulos, validação e somas.
// Ficam fora do componente para serem testadas em tests/contratos.test.mjs.

export type SituacaoContrato = 'rascunho' | 'vigente' | 'encerrado' | 'cancelado'

export type LancamentoContrato = {
  id: string
  vencimento?: string
  valor?: number
  descricao: string
  pago: boolean
  pago_em?: string | null
  parcela_numero?: number | null
  parcela_total?: number | null
  contrato_id?: string | null
  caso_id?: string | null
  cliente_id?: string | null
  asaas_cobranca_id?: string | null
}

export type ResumoContrato = {
  total: number
  pago: number
  em_aberto: number
  vencido: number
  quitado: boolean
}

export type Contrato = {
  id: string
  cliente_id: string
  caso_id: string | null
  documento_id: number | null
  titulo: string
  valor_total: number
  entrada: number
  entrada_vencimento: string | null
  parcelas: number
  primeiro_vencimento: string
  exito_percentual: number | null
  exito_descricao: string | null
  vigencia_inicio: string | null
  vigencia_fim: string | null
  situacao: SituacaoContrato
  responsavel: string
  ativar_ao_assinar: boolean
  recibo_automatico: boolean
  lembrete_automatico: boolean
  criado_em: string
  atualizado_em: string
  ativado_em: string | null
  parcelas_lancamentos?: LancamentoContrato[]
  resumo?: ResumoContrato
}

export const ROTULO_SITUACAO_CONTRATO: Record<SituacaoContrato, string> = {
  rascunho: 'Rascunho', vigente: 'Vigente', encerrado: 'Encerrado', cancelado: 'Cancelado',
}

export const COR_SITUACAO_CONTRATO: Record<SituacaoContrato, 'gray' | 'green' | 'blue' | 'red'> = {
  rascunho: 'gray', vigente: 'green', encerrado: 'blue', cancelado: 'red',
}

/** Campos editáveis no formulário; valores monetários ficam como texto no padrão brasileiro. */
export type FormContrato = {
  cliente_id: string
  caso_id: string
  documento_id: string
  titulo: string
  valor_total: string
  entrada: string
  entrada_vencimento: string
  parcelas: string
  primeiro_vencimento: string
  exito_percentual: string
  exito_descricao: string
  vigencia_inicio: string
  vigencia_fim: string
}

export const FORM_CONTRATO_VAZIO: FormContrato = {
  cliente_id: '',
  caso_id: '',
  documento_id: '',
  titulo: '',
  valor_total: '',
  entrada: '',
  entrada_vencimento: '',
  parcelas: '1',
  primeiro_vencimento: '',
  exito_percentual: '',
  exito_descricao: '',
  vigencia_inicio: '',
  vigencia_fim: '',
}

/** Data AAAA-MM-DD que existe no calendário (rejeita 2026-02-30). */
export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [ano, mes, dia] = iso.split('-').map(Number)
  const data = new Date(ano, mes - 1, dia)
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia
}

/** "1.500,00" → 1500; "0,00" → 0; texto inválido → null. */
export function reaisDeTexto(texto: string): number | null {
  const valor = (texto ?? '').trim()
  if (!valor) return null
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(valor)) return null
  const numero = Number(valor.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numero) ? numero : null
}

/** 1500 → "1.500,00" (para preencher o formulário de edição). */
export function reaisParaTexto(valor: number): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Valida o formulário antes de enviar, espelhando as regras de contratos_honorarios.py.
 * Devolve todas as mensagens encontradas (vazio quando está tudo certo).
 */
export function validarContrato(form: FormContrato): string[] {
  const erros: string[] = []

  if (!form.cliente_id.trim()) erros.push('Informe o cliente do contrato.')

  const titulo = form.titulo.trim()
  if (titulo.length < 1 || titulo.length > 200) erros.push('O título do contrato deve ter de 1 a 200 caracteres.')

  const total = reaisDeTexto(form.valor_total)
  if (total === null) erros.push('Informe o valor total do contrato.')
  else if (total <= 0) erros.push('O valor total deve ser maior que zero.')

  const entradaTexto = form.entrada.trim()
  const entrada = entradaTexto ? reaisDeTexto(entradaTexto) : 0
  if (entrada === null) erros.push('Informe a entrada em reais, como 1.500,00.')
  else if (entrada < 0) erros.push('A entrada não pode ser negativa.')
  else if (total !== null && total > 0 && entrada >= total) erros.push('A entrada deve ser menor que o valor total.')

  const parcelas = Number(form.parcelas)
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120) erros.push('Informe o número de parcelas de 1 a 120.')

  if (!dataValida(form.primeiro_vencimento)) erros.push('Informe o primeiro vencimento no formato AAAA-MM-DD.')
  if (entrada !== null && entrada > 0 && form.entrada_vencimento && !dataValida(form.entrada_vencimento)) {
    erros.push('Informe o vencimento da entrada no formato AAAA-MM-DD.')
  }

  if (form.exito_percentual.trim()) {
    const exito = Number(form.exito_percentual.replace(',', '.'))
    if (!Number.isFinite(exito) || exito < 0 || exito > 100) erros.push('O êxito deve ficar entre 0 e 100%.')
  }

  if (form.vigencia_inicio && !dataValida(form.vigencia_inicio)) erros.push('Informe o início da vigência no formato AAAA-MM-DD.')
  if (form.vigencia_fim && !dataValida(form.vigencia_fim)) erros.push('Informe o fim da vigência no formato AAAA-MM-DD.')
  if (dataValida(form.vigencia_inicio) && dataValida(form.vigencia_fim) && form.vigencia_inicio > form.vigencia_fim) {
    erros.push('O início da vigência não pode ser depois do fim.')
  }

  return erros
}

/** Soma em centavos, para o total da prévia não perder centavo por arredondamento. */
export function somaParcelas(parcelas: Array<{ valor?: number | null }>): number {
  return parcelas.reduce((total, parcela) => total + Math.round((Number(parcela.valor) || 0) * 100), 0)
}

export type SituacaoParcela = 'paga' | 'vencida' | 'aberta'

export function situacaoParcela(parcela: Pick<LancamentoContrato, 'pago' | 'vencimento'>, hoje: string): SituacaoParcela {
  if (parcela.pago) return 'paga'
  return parcela.vencimento && parcela.vencimento.slice(0, 10) < hoje ? 'vencida' : 'aberta'
}

/** Preenche o formulário a partir de um contrato (criação e edição usam o mesmo formulário). */
export function formDeContrato(contrato: Contrato): FormContrato {
  return {
    cliente_id: contrato.cliente_id,
    caso_id: contrato.caso_id ?? '',
    documento_id: contrato.documento_id === null || contrato.documento_id === undefined ? '' : String(contrato.documento_id),
    titulo: contrato.titulo,
    valor_total: reaisParaTexto(contrato.valor_total),
    entrada: contrato.entrada > 0 ? reaisParaTexto(contrato.entrada) : '',
    entrada_vencimento: contrato.entrada_vencimento ?? '',
    parcelas: String(contrato.parcelas),
    primeiro_vencimento: contrato.primeiro_vencimento ?? '',
    exito_percentual: contrato.exito_percentual === null || contrato.exito_percentual === undefined ? '' : String(contrato.exito_percentual).replace('.', ','),
    exito_descricao: contrato.exito_descricao ?? '',
    vigencia_inicio: contrato.vigencia_inicio ?? '',
    vigencia_fim: contrato.vigencia_fim ?? '',
  }
}
