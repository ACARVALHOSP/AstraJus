// Soma meses a uma data ISO (AAAA-MM-DD), preso ao último dia do mês alvo quando o dia de
// origem não existir nele - mesma lógica que o Asaas usa pra gerar o vencimento das parcelas.
export function somarMeses(dataIso: string, meses: number): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number)
  const mesesTotal = mes - 1 + meses
  const anoAlvo = ano + Math.floor(mesesTotal / 12)
  const mesAlvo = ((mesesTotal % 12) + 12) % 12
  const ultimoDiaMesAlvo = new Date(anoAlvo, mesAlvo + 1, 0).getDate()
  const diaAlvo = Math.min(dia, ultimoDiaMesAlvo)
  return `${anoAlvo}-${String(mesAlvo + 1).padStart(2, '0')}-${String(diaAlvo).padStart(2, '0')}`
}

// Divide o valor total (em centavos) em N parcelas iguais, jogando a sobra do arredondamento
// na última - mesma regra que o Asaas aplica.
export function calcularValoresParcelas(totalCentavos: number, quantidade: number): number[] {
  const porParcela = Math.floor(totalCentavos / quantidade)
  const valores = Array(quantidade).fill(porParcela)
  valores[quantidade - 1] += totalCentavos - porParcela * quantidade
  return valores
}

export function valorLancamentoEmReais(texto: string): number | null {
  const valor = texto.trim()
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(valor)) return null
  const numero = Number(valor.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numero) && numero > 0 && numero <= Number.MAX_SAFE_INTEGER / 100 ? numero : null
}
