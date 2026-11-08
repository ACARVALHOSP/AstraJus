export function mascaraCep(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

export function mascaraCpfCnpj(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 14)
  if (digitos.length <= 11) {
    return digitos.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digitos
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function cpfValido(d: string) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    if (((soma * 10) % 11) % 10 !== Number(d[tamanho])) return false
  }
  return true
}

function cnpjValido(d: string) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  for (const tamanho of [12, 13]) {
    const p = pesos.slice(13 - tamanho)
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * p[i]
    const resto = soma % 11
    if ((resto < 2 ? 0 : 11 - resto) !== Number(d[tamanho])) return false
  }
  return true
}

/** Mensagem de erro do CPF/CNPJ informado, ou '' se estiver vazio ou válido. */
export function erroCpfCnpj(valor: string): string {
  const d = valor.replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 11) return cpfValido(d) ? '' : 'CPF inválido. Confira os números digitados.'
  if (d.length === 14) return cnpjValido(d) ? '' : 'CNPJ inválido. Confira os números digitados.'
  return 'O CPF deve ter 11 dígitos e o CNPJ, 14.'
}

/** (11) 99999-0000 para celular, (11) 3333-0000 para fixo; aceita +55 no início. */
export function mascaraTelefone(valor: string): string {
  let d = valor.replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function erroTelefone(valor: string): string {
  const d = valor.replace(/\D/g, '')
  if (!d) return ''
  return d.length === 10 || d.length === 11 ? '' : 'Telefone com DDD: 10 ou 11 dígitos.'
}

export function erroEmail(valor: string): string {
  const v = valor.trim()
  if (!v) return ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'E-mail incompleto. Confira, por exemplo: nome@exemplo.com.br'
}
