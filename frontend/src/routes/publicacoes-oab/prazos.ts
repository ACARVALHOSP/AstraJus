/** Calendar providers can add municipal holidays, court suspensions and official acts.
 * Completeness is explicit: an empty list must never imply a verified calendar. */
export type CalendarioForense = {
  municipio: string; tribunal: string; anos: number[]; fonte: string; consultadoEm: string
  completo: boolean; impedimentos: Array<{ inicio: string; fim: string; descricao: string; fonte?: string; tipo?: 'feriado' | 'suspensao' }>
}
export type ContextoCalendario = { municipio: string; tribunal: string; anos: number[] }
export type ProvedorCalendario = (contexto: ContextoCalendario) => Promise<CalendarioForense>
export type RegraPrazo = 'dje' | 'inicio'
export const REGRAS_PRAZO: Record<RegraPrazo, string> = {
  dje: 'Disponibilização DJEN → publicação no 1º dia útil seguinte → início da contagem no dia útil seguinte',
  inicio: 'Termo inicial informado: conta como primeiro dia se for dia útil',
}
export function dataValida(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso
}
const somar = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
export function detectarDias(texto: string): number | null {
  // Only an explicit, unique duration; no default deadline or inference by action type.
  if (/dias\s+corridos/iu.test(texto)) return null
  const valores = [...texto.matchAll(/prazo\s+(?:de\s+)?(\d{1,3})(?:\s*\([^)]{1,30}\))?\s+dias\b/giu)].map(m => Number(m[1]))
  const unicos = [...new Set(valores)]
  return unicos.length === 1 && unicos[0] > 0 ? unicos[0] : null
}
export type Contagem = 'uteis' | 'corridos'
export type OpcoesPrazo = { contagem?: Contagem; emDobro?: boolean }

export function calcularPrazo(base: string, dias: number, regra: RegraPrazo, calendario: CalendarioForense, suspensaoCpc: boolean, opcoes: OpcoesPrazo = {}) {
  if (!dataValida(base) || !Number.isInteger(dias) || dias < 1 || dias > 999 || !REGRAS_PRAZO[regra]) throw new Error('Informe data, regra e prazo entre 1 e 999 dias.')
  const contagem: Contagem = opcoes.contagem ?? 'uteis'
  const emDobro = Boolean(opcoes.emDobro)
  // Prazo em dobro (CPC arts. 180, 183, 186 e 229) multiplica a quantidade de dias.
  const total = emDobro ? dias * 2 : dias
  const linhas: Array<{ data: string; evento: string; dia: number | null }> = []
  const emRecesso = (iso: string) => suspensaoCpc && (iso.slice(5) >= '12-20' || iso.slice(5) <= '01-20')
  function suspensao(iso: string): string | null {
    if (emRecesso(iso)) return 'Suspensão de 20/12 a 20/01 (regra CPC selecionada)'
    return calendario.impedimentos.find(i => i.tipo === 'suspensao' && iso >= i.inicio && iso <= i.fim)?.descricao || null
  }
  function impedimento(iso: string, contagemUtil = true): string | null {
    const dia = new Date(`${iso}T12:00:00Z`).getUTCDay()
    if (dia === 0 || dia === 6) return 'Fim de semana'
    if (contagemUtil && emRecesso(iso)) return 'Suspensão de 20/12 a 20/01 (regra CPC selecionada)'
    return calendario.impedimentos.find(i => (contagemUtil || i.tipo !== 'suspensao') && iso >= i.inicio && iso <= i.fim)?.descricao || null
  }
  let atual = base, passos = 0
  function proximoUtil(incluir: boolean, contagemUtil = true) {
    if (!incluir) atual = somar(atual)
    while (impedimento(atual, contagemUtil)) {
      if (++passos > 10000) throw new Error('Calendário sem dia útil disponível no intervalo.')
      linhas.push({ data: atual, evento: impedimento(atual, contagemUtil)!, dia: null }); atual = somar(atual)
    }
  }
  // Dias corridos: só a suspensão interrompe a contagem; sábados, domingos e feriados contam.
  function proximoCorrido() {
    atual = somar(atual)
    while (suspensao(atual)) {
      if (++passos > 10000) throw new Error('Calendário sem dia disponível no intervalo.')
      linhas.push({ data: atual, evento: suspensao(atual)!, dia: null }); atual = somar(atual)
    }
  }
  if (regra === 'dje') {
    linhas.push({ data: base, evento: 'Disponibilização DJEN', dia: null })
    proximoUtil(false, false); linhas.push({ data: atual, evento: 'Publicação', dia: null }); proximoUtil(false)
  } else proximoUtil(true)
  const termoInicial = atual
  for (let dia = 1; dia <= total; dia++) {
    if (dia > 1) { if (contagem === 'uteis') proximoUtil(false); else proximoCorrido() }
    const ultimo = dia === total
    linhas.push({ data: atual, evento: ultimo ? (contagem === 'corridos' ? 'Último dia da contagem' : 'Vencimento') : dia === 1 ? 'Início da contagem' : 'Contagem', dia })
  }
  // Art. 224, §1º: prazo em dias corridos que termina sem expediente vai para o primeiro dia útil seguinte.
  let prorrogado = false
  if (contagem === 'corridos' && impedimento(atual)) {
    prorrogado = true
    proximoUtil(false)
    linhas.push({ data: atual, evento: 'Vencimento (prorrogado para o primeiro dia útil, CPC art. 224, §1º)', dia: null })
  }
  const anos = [...new Set(linhas.map(l => Number(l.data.slice(0, 4))))]
  return {
    termoInicial, dataFinal: atual, linhas, contagem, emDobro, diasContados: total, prorrogado,
    pendenteRevisao: !calendario.completo || anos.some(a => !calendario.anos.includes(a)),
  }
}

/** A contagem passa pelo período de 20/12 a 20/01 sem que a suspensão do CPC (art. 220) tenha sido marcada? */
export function cruzaRecesso(base: string, dataFinal: string): boolean {
  if (!dataValida(base) || !dataValida(dataFinal)) return false
  for (let ano = Number(base.slice(0, 4)) - 1; ano <= Number(dataFinal.slice(0, 4)); ano++) {
    const [ini, fim] = [`${ano}-12-20`, `${ano + 1}-01-20`]
    if (base <= fim && dataFinal >= ini) return true
  }
  return false
}

/** Prazos mais comuns do CPC e da Lei 9.099/95, em dias úteis. A data é sempre uma sugestão a revisar. */
export const PRAZOS_PADRAO = [
  { id: 'contestacao', rotulo: 'Contestação', dias: 15, base: 'CPC art. 335' },
  { id: 'replica', rotulo: 'Réplica', dias: 15, base: 'CPC arts. 350 e 351' },
  { id: 'apelacao', rotulo: 'Apelação', dias: 15, base: 'CPC art. 1.003, §5º' },
  { id: 'contrarrazoes', rotulo: 'Contrarrazões de apelação', dias: 15, base: 'CPC art. 1.010, §1º' },
  { id: 'embargos_declaracao', rotulo: 'Embargos de declaração', dias: 5, base: 'CPC art. 1.023' },
  { id: 'agravo_instrumento', rotulo: 'Agravo de instrumento', dias: 15, base: 'CPC art. 1.003, §5º' },
  { id: 'agravo_interno', rotulo: 'Agravo interno', dias: 15, base: 'CPC art. 1.021, §2º' },
  { id: 'recurso_especial', rotulo: 'Recurso especial / extraordinário', dias: 15, base: 'CPC art. 1.003, §5º' },
  { id: 'cumprimento_pagamento', rotulo: 'Cumprimento de sentença: pagamento voluntário', dias: 15, base: 'CPC art. 523' },
  { id: 'impugnacao_cumprimento', rotulo: 'Impugnação ao cumprimento de sentença', dias: 15, base: 'CPC art. 525' },
  { id: 'embargos_execucao', rotulo: 'Embargos à execução', dias: 15, base: 'CPC art. 915' },
  { id: 'documentos', rotulo: 'Manifestação sobre documentos', dias: 15, base: 'CPC art. 437, §1º' },
  { id: 'manifestacao', rotulo: 'Manifestação sem prazo fixado', dias: 5, base: 'CPC art. 218, §3º' },
  { id: 'recurso_inominado', rotulo: 'Recurso inominado (Juizado Especial)', dias: 10, base: 'Lei 9.099/95 art. 42' },
  { id: 'embargos_declaracao_je', rotulo: 'Embargos de declaração (Juizado Especial)', dias: 5, base: 'Lei 9.099/95 art. 49' },
] as const

/** Sugere o prazo padrão pelo texto da intimação. Só sugere quando UM tipo é claramente identificado;
 *  na dúvida (ou com mais de um tipo), não sugere nada. */
export function sugerirPrazoPadrao(texto: string): (typeof PRAZOS_PADRAO)[number] | null {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const regras: Array<[string, RegExp]> = [
    ['contestacao', /\b(apresent(?:ar|e|em)|oferec(?:er|a|am)|ofert(?:ar|e))\s+(?:a\s+)?contestacao\b|\bpara\s+(?:,?\s*querendo,?\s*)?contestar\b|\bcontestar\s+(?:o\s+)?(?:feito|pedido|acao)\b/],
    ['replica', /\b(?:apresent(?:ar|e|em)|oferec(?:er|a|am))?\s*replica\b|\breplicar\b|manifestar-se\s+sobre\s+a\s+contestacao/],
    ['contrarrazoes', /\bcontrarrazoes\b|\bcontra-razoes\b/],
    ['cumprimento_pagamento', /cumprimento\s+de\s+sentenca[^.]{0,120}\b(pagar|pagamento)\b|\bpagar\s+o\s+debito[^.]{0,60}\b15\b/],
    ['impugnacao_cumprimento', /\bimpugnacao\s+ao\s+cumprimento\b|\bimpugnar\s+o\s+cumprimento\b/],
    ['embargos_execucao', /\bembargos\s+a\s+execucao\b/],
    ['embargos_declaracao', /\bembargos\s+de\s+declaracao\b/],
  ]
  const achados = regras.filter(([, re]) => re.test(t)).map(([id]) => id)
  return achados.length === 1 ? (PRAZOS_PADRAO.find(p => p.id === achados[0]) ?? null) : null
}
