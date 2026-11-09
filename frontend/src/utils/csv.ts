/** Exportação em CSV que o Excel em português abre direto: separador ";", vírgula decimal,
 *  UTF-8 com BOM (para os acentos) e fim de linha CRLF. */
export type ColunaCsv<T> = { titulo: string; valor: (item: T) => string | number | null | undefined }

function celula(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 }) : ''
  }
  // Texto que começa com = + - @ seria executado como fórmula ao abrir na planilha.
  const texto = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function montarCsv<T>(colunas: ColunaCsv<T>[], itens: T[]): string {
  const linhas = [colunas.map(c => celula(c.titulo)).join(';')]
  for (const item of itens) linhas.push(colunas.map(c => celula(c.valor(item))).join(';'))
  return '﻿' + linhas.join('\r\n') + '\r\n'
}

/** Baixa o CSV como "<nome>-AAAA-MM-DD.csv". */
export function baixarCsv<T>(nome: string, colunas: ColunaCsv<T>[], itens: T[]) {
  const d = new Date()
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([montarCsv(colunas, itens)], { type: 'text/csv;charset=utf-8' }))
  link.download = `${nome}-${data}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
