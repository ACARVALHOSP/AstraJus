const TRIBUNAL_MAP: Record<string, string> = {
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

export function siglaTribunalPorNumero(numero: string): string | null {
  const digitos = numero.replace(/\D/g, '')
  if (digitos.length === 20) {
    const cod = digitos.substring(13, 16)
    return TRIBUNAL_MAP[cod] ?? null
  }
  return null
}
