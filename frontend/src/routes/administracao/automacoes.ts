// Tela "Automações" da Administração: rótulos, estado resumido e validação, sem React (testado em
// tests/automacoes.test.mjs). O servidor é quem valida de verdade; aqui só se evita o ida-e-volta óbvio.

export type ParametroDefinido = { tipo: 'int'; rotulo: string; minimo: number; maximo: number; padrao: number }
export type ExecucaoAuto = { inicio: string; fim: string | null; estado: string; erro: string | null }
export type RotinaAuto = {
  chave: string; nome: string; descricao: string; ativo: boolean
  parametros: Record<string, number>; parametros_definidos: Record<string, ParametroDefinido>
  ultima_execucao: ExecucaoAuto | null
}
export type EstadoAuto = { ativo: boolean; parametros: Record<string, number> }
export type AlteracaoAuto = { ocorrido_em: string; ator: string; chave: string; antes: EstadoAuto; depois: EstadoAuto }

export type SeloAuto = { texto: string; cor: 'gray' | 'green' | 'red' | 'amber' }

export function seloRotina(r: Pick<RotinaAuto, 'ativo' | 'ultima_execucao'>): SeloAuto {
  if (!r.ativo) return { texto: 'Desligada', cor: 'gray' }
  const e = r.ultima_execucao
  if (!e) return { texto: 'Ainda não executou', cor: 'gray' }
  if (e.estado === 'falha') return { texto: 'Falhou na última execução', cor: 'red' }
  if (e.estado === 'interrompida') return { texto: 'Interrompida', cor: 'amber' }
  if (e.estado === 'executando') return { texto: 'Executando', cor: 'amber' }
  return { texto: 'Em dia', cor: 'green' }
}

/** "2026-11-17T22:30:00+00:00" → "17/11/2026 19:30" (horário de Brasília). */
export function quandoBrasilia(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const partes = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map(p => [p.type, p.value]))
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`
}

/** "usuario:ana" → "ana"; "bootstrap" → "Token administrativo". */
export function nomeDoAutor(ator: string): string {
  if (ator === 'bootstrap') return 'Token administrativo'
  return ator.startsWith('usuario:') ? ator.slice('usuario:'.length) : ator
}

export function descreverAlteracao(a: AlteracaoAuto, nomes: Record<string, string>): string {
  const nome = nomes[a.chave] ?? a.chave
  const quem = nomeDoAutor(a.ator)
  if (a.antes.ativo !== a.depois.ativo) return `${quem} ${a.depois.ativo ? 'ligou' : 'desligou'} "${nome}"`
  return `${quem} alterou os parâmetros de "${nome}"`
}

/** Mensagem de erro para o valor digitado, ou '' se estiver valendo. */
export function erroDoParametro(def: ParametroDefinido, texto: string): string {
  const valor = texto.trim()
  if (!/^-?\d+$/.test(valor)) return `${def.rotulo}: informe um número inteiro.`
  const n = Number(valor)
  if (n < def.minimo || n > def.maximo) return `${def.rotulo}: informe um valor entre ${def.minimo} e ${def.maximo}.`
  return ''
}
