// Número único do processo (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO.
// J.TR identifica o tribunal; DD é o dígito verificador (módulo 97, base 10).

export const TRIBUNAL_MAP: Record<string, string> = {
  '100': 'stf', '300': 'stj', '700': 'stm',
  '401': 'trf1', '402': 'trf2', '403': 'trf3', '404': 'trf4', '405': 'trf5', '406': 'trf6',
  '501': 'trt1', '502': 'trt2', '503': 'trt3', '504': 'trt4', '505': 'trt5',
  '506': 'trt6', '507': 'trt7', '508': 'trt8', '509': 'trt9', '510': 'trt10',
  '511': 'trt11', '512': 'trt12', '513': 'trt13', '514': 'trt14', '515': 'trt15',
  '516': 'trt16', '517': 'trt17', '518': 'trt18', '519': 'trt19', '520': 'trt20',
  '521': 'trt21', '522': 'trt22', '523': 'trt23', '524': 'trt24',
  '601': 'treac', '602': 'treal', '603': 'treap', '604': 'tream', '605': 'treba',
  '606': 'trece', '607': 'tredf', '608': 'trees', '609': 'trego', '610': 'trema',
  '611': 'tremt', '612': 'trems', '613': 'tremg', '614': 'trepa', '615': 'trepb',
  '616': 'trepr', '617': 'trepe', '618': 'trepi', '619': 'trerj', '620': 'trern',
  '621': 'trers', '622': 'trero', '623': 'trerr', '624': 'tresc', '625': 'trese',
  '626': 'tresp', '627': 'treto',
  '801': 'tjac', '802': 'tjal', '803': 'tjap', '804': 'tjam', '805': 'tjba',
  '806': 'tjce', '807': 'tjdft', '808': 'tjes', '809': 'tjgo', '810': 'tjma',
  '811': 'tjmt', '812': 'tjms', '813': 'tjmg', '814': 'tjpa', '815': 'tjpb',
  '816': 'tjpr', '817': 'tjpe', '818': 'tjpi', '819': 'tjrj', '820': 'tjrn',
  '821': 'tjrs', '822': 'tjro', '823': 'tjrr', '824': 'tjsc', '825': 'tjse',
  '826': 'tjsp', '827': 'tjto',
  '913': 'tjmmg', '921': 'tjmrs', '926': 'tjmsp',
}


const JUSTICA: Record<string, string> = {
  '1': 'Supremo Tribunal Federal', '2': 'Conselho Nacional de Justiça', '3': 'Superior Tribunal de Justiça',
  '4': 'Justiça Federal', '5': 'Justiça do Trabalho', '6': 'Justiça Eleitoral',
  '7': 'Justiça Militar da União', '8': 'Justiça dos Estados e do DF', '9': 'Justiça Militar Estadual',
}

export type AnaliseNumeroCnj = {
  /** 20 dígitos, ou o que foi digitado só com números. */
  digitos: string
  /** `0000000-00.0000.0.00.0000` quando há 20 dígitos. */
  formatado: string
  valido: boolean
  /** Motivo quando inválido; vazio quando válido. */
  motivo: string
  /** Sigla em minúsculas (`tjsp`), quando o código J.TR é conhecido. */
  sigla: string | null
  justica: string | null
  ano: number | null
}

function resto97(texto: string): number {
  let resto = 0
  for (const c of texto) resto = (resto * 10 + Number(c)) % 97
  return resto
}

/** Dígito verificador esperado: 98 − (NNNNNNN AAAA JTR OOOO 00 mod 97). */
export function digitoVerificadorCnj(digitos: string): string {
  const base = digitos.slice(0, 7) + digitos.slice(9)
  return String(98 - resto97(base + '00')).padStart(2, '0')
}

export function formatarCnj(digitos: string): string {
  return digitos.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')
}

export function analisarNumeroCnj(valor: string, anoAtual = new Date().getFullYear()): AnaliseNumeroCnj {
  const bruto = (valor || '').trim()
  const digitos = bruto.replace(/\D/g, '')
  const vazio = { digitos, formatado: bruto, sigla: null, justica: null, ano: null }
  if (/[^\d.\-\s]/.test(bruto)) return { ...vazio, valido: false, motivo: 'Use só números, pontos e traço.' }
  if (digitos.length !== 20) return { ...vazio, valido: false, motivo: `O número CNJ tem 20 dígitos (informados: ${digitos.length}).` }
  const ano = Number(digitos.slice(9, 13))
  const codigo = digitos.slice(13, 16)
  const base = { digitos, formatado: formatarCnj(digitos), sigla: TRIBUNAL_MAP[codigo] ?? null, justica: JUSTICA[digitos[13]] ?? null, ano }
  if (digitoVerificadorCnj(digitos) !== digitos.slice(7, 9)) {
    return { ...base, valido: false, motivo: `Dígito verificador inválido (o esperado seria ${digitoVerificadorCnj(digitos)}). Confira o número.` }
  }
  if (ano < 1900 || ano > anoAtual + 1) return { ...base, valido: false, motivo: `Ano de ajuizamento improvável (${ano}).` }
  if (!base.sigla) return { ...base, valido: false, motivo: `Código de tribunal desconhecido (${digitos[13]}.${digitos.slice(14, 16)}).` }
  return { ...base, valido: true, motivo: '' }
}
