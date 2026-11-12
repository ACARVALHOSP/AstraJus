/** "há 5 min", "há 3 h", "ontem", "há 2 dias", "há 3 meses". Sem data: "Nunca acessou". */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return 'Nunca acessou'
  const quando = new Date(iso)
  if (Number.isNaN(quando.getTime())) return 'Não registrado'
  const segundos = Math.floor((agora.getTime() - quando.getTime()) / 1000)
  if (segundos < 60) return 'agora há pouco'          // também cobre relógios levemente adiantados
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  if (horas < 48) return 'ontem'
  const dias = Math.floor(horas / 24)
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`
  const anos = Math.floor(meses / 12)
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`
}

/** Lê um valor por hora digitado ("300", "300,50", "1.250,00"). Vazio: null (sem valor). Inválido: undefined. */
export function lerValorHora(texto: string): number | null | undefined {
  const t = texto.trim().replace(/^R\$\s*/i, '')
  if (t === '') return null
  const normalizado = /,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return undefined
  const n = Number(normalizado)
  return n > 0 && n <= 100000 ? n : undefined
}

const CAMPOS_CADASTRO: Record<string, string> = {
  nome_completo: 'Nome', email: 'E-mail', nivel_acesso: 'Nível de acesso', status: 'Status', permissoes: 'Acesso por área',
}
const CATEGORIAS_LIMPEZA: Record<string, string> = {
  publicacoes: 'Publicações capturadas', monitoramento_tecnico: 'Dados técnicos de monitoramento', notificacoes: 'Notificações',
}
const ACOES: Record<string, string> = { criar: 'Cadastro criado', atualizar: 'Cadastro alterado', limpar_banco: 'Limpeza de dados' }

/** Rótulo da ação do histórico administrativo; ação desconhecida aparece como veio. */
export const rotuloAcao = (acao: string): string => ACOES[acao] ?? acao

/** Texto dos "campos alterados" de uma linha do histórico administrativo. Aceita lista (cadastro), objeto
 *  (limpeza de dados: quantos registros por categoria), texto simples ou nada, sem nunca quebrar a tela. */
export function descreverCampos(bruto: unknown): string {
  let valor: unknown = bruto
  if (typeof bruto === 'string') {
    try { valor = JSON.parse(bruto) } catch { return bruto }
  }
  if (Array.isArray(valor)) return valor.map(c => CAMPOS_CADASTRO[String(c)] ?? String(c)).join(', ')
  if (valor && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>)
      .map(([chave, total]) => CATEGORIAS_LIMPEZA[chave] ? `${CATEGORIAS_LIMPEZA[chave]}: ${total} registro(s) apagado(s)` : `${CAMPOS_CADASTRO[chave] ?? chave}: ${String(total)}`)
      .join('; ')
  }
  return valor === null || valor === undefined ? '' : String(valor)
}
