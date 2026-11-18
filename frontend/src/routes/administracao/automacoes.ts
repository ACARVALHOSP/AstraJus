// Tela "Automações" da Administração: rótulos, estado resumido e validação, sem React (testado em
// tests/automacoes.test.mjs). O servidor é quem valida de verdade; aqui só se evita o ida-e-volta óbvio.

export type ParametroInt = { tipo: 'int'; rotulo: string; minimo: number; maximo: number; padrao: number }
export type ParametroLista = { tipo: 'lista_int'; rotulo: string; minimo: number; maximo: number; min_itens: number; max_itens: number; padrao: number[] }
export type ParametroDefinido = ParametroInt | ParametroLista
export type ValorParametro = number | number[]
export type ExecucaoAuto = { inicio: string; fim: string | null; estado: string; erro: string | null }
export type RotinaAuto = {
  chave: string; nome: string; descricao: string; ativo: boolean; agendada?: boolean
  parametros: Record<string, ValorParametro>; parametros_definidos: Record<string, ParametroDefinido>
  ultima_execucao: ExecucaoAuto | null
}
export type EstadoAuto = { ativo: boolean; parametros: Record<string, ValorParametro> }
export type AlteracaoAuto = { ocorrido_em: string; ator: string; chave: string; antes: EstadoAuto; depois: EstadoAuto }

export type SeloAuto = { texto: string; cor: 'gray' | 'green' | 'red' | 'amber' }

export function seloRotina(r: Pick<RotinaAuto, 'ativo' | 'ultima_execucao'> & { agendada?: boolean }): SeloAuto {
  if (!r.ativo) return { texto: 'Desligada', cor: 'gray' }
  if (r.agendada === false) return { texto: 'Ligada', cor: 'green' } // age quando algo acontece, não por horário
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
  if (a.chave === 'responsavel_regras') return `${quem} alterou as regras de "${nome}"`
  return `${quem} alterou os parâmetros de "${nome}"`
}

/** Valor mostrado no campo: número, ou a lista separada por vírgula ("15, 5, 1, 0"). */
export function textoDoValor(valor: ValorParametro): string {
  return Array.isArray(valor) ? valor.join(', ') : String(valor)
}

/** Lê o texto digitado. Devolve o valor (lista em ordem decrescente, como o servidor guarda) ou a mensagem de erro. */
export function lerParametro(def: ParametroDefinido, texto: string): { valor: ValorParametro; erro: '' } | { valor: null; erro: string } {
  const fim = (erro: string) => ({ valor: null, erro }) as const
  if (def.tipo === 'int') {
    const t = texto.trim()
    if (!/^-?\d+$/.test(t)) return fim(`${def.rotulo}: informe um número inteiro.`)
    const n = Number(t)
    if (n < def.minimo || n > def.maximo) return fim(`${def.rotulo}: informe um valor entre ${def.minimo} e ${def.maximo}.`)
    return { valor: n, erro: '' }
  }
  const partes = texto.split(/[\s,;]+/).filter(Boolean)
  if (partes.some(p => !/^\d+$/.test(p))) return fim(`${def.rotulo}: informe números inteiros separados por vírgula.`)
  const lista = partes.map(Number)
  if (lista.length < def.min_itens || lista.length > def.max_itens) return fim(`${def.rotulo}: informe de ${def.min_itens} a ${def.max_itens} valores.`)
  if (new Set(lista).size !== lista.length) return fim(`${def.rotulo}: há valores repetidos.`)
  if (lista.some(v => v < def.minimo || v > def.maximo)) return fim(`${def.rotulo}: cada valor deve estar entre ${def.minimo} e ${def.maximo}.`)
  return { valor: [...lista].sort((x, y) => y - x), erro: '' }
}

/** Mensagem de erro para o valor digitado, ou '' se estiver valendo. */
export function erroDoParametro(def: ParametroDefinido, texto: string): string {
  return lerParametro(def, texto).erro
}
