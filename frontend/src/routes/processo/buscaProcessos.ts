// Busca de processos no DataJud por classe, órgão julgador e assunto (tool buscar_processos_datajud).

export type FiltrosBusca = {
  tribunal: string
  classe: string
  orgao: string
  assunto: string
  inicio: string // AAAA-MM-DD ou ''
  fim: string // AAAA-MM-DD ou ''
  grau: string
}

export type ResumoProcesso = {
  numeroProcesso?: string
  tribunal?: string
  grau?: string
  grau_descricao?: string
  classe?: string
  classe_codigo?: number
  classe_caminho?: string[]
  assuntos?: { codigo?: number; nome?: string; area?: string | null }[]
  orgaoJulgador?: string
  orgao_julgador_codigo?: number
  dataAjuizamento?: string
}

export const FILTROS_VAZIOS: FiltrosBusca = { tribunal: '', classe: '', orgao: '', assunto: '', inicio: '', fim: '', grau: '' }

const codigo = (v: string) => v.trim()

/** Argumentos da tool a partir do formulário, ou a mensagem do que falta/está errado. O servidor
 *  valida de novo; aqui só se evita a ida e volta (a API do DataJud é lenta). */
export function montarArgsBusca(f: FiltrosBusca, cursor?: unknown[] | null, tamanho = 20): { args: Record<string, unknown> } | { erro: string } {
  if (!f.tribunal.trim()) return { erro: 'Escolha o tribunal: a busca no DataJud é feita em um tribunal por vez.' }
  const args: Record<string, unknown> = { tribunal: f.tribunal.trim().toLowerCase(), tamanho }
  for (const [chave, rotulo, valor] of [
    ['classe_codigo', 'Classe', f.classe], ['orgao_julgador_codigo', 'Órgão julgador', f.orgao], ['assunto_codigo', 'Assunto', f.assunto],
  ] as const) {
    if (!codigo(valor)) continue
    if (!/^\d+$/.test(codigo(valor)) || Number(codigo(valor)) <= 0) return { erro: `${rotulo}: informe o código numérico da tabela do CNJ (ex.: 7).` }
    args[chave] = Number(codigo(valor))
  }
  if (f.inicio) args.ajuizamento_inicio = f.inicio
  if (f.fim) args.ajuizamento_fim = f.fim
  if (f.inicio && f.fim && f.inicio > f.fim) return { erro: 'A data inicial não pode ser posterior à final.' }
  if (f.grau.trim()) args.grau = f.grau.trim().toUpperCase()
  if (!['classe_codigo', 'orgao_julgador_codigo', 'assunto_codigo', 'ajuizamento_inicio', 'ajuizamento_fim'].some(k => k in args)) {
    return { erro: 'Informe ao menos um filtro: classe, órgão julgador, assunto ou período de ajuizamento.' }
  }
  if (cursor?.length) args.search_after = cursor
  return { args }
}

/** Junta a página nova à lista, sem repetir (número, grau) caso o cursor devolva um item de borda. */
export function juntarPaginas(atuais: ResumoProcesso[], novas: ResumoProcesso[]): ResumoProcesso[] {
  const vistos = new Set(atuais.map(p => `${p.numeroProcesso}|${p.grau}`))
  return [...atuais, ...novas.filter(p => !vistos.has(`${p.numeroProcesso}|${p.grau}`))]
}

/** Item das Tabelas Processuais Unificadas devolvido pela tool consultar_tpu. */
export type ItemTpu = { codigo: number; nome: string; caminho?: string }

/** Complemento da opção na lista: código e, se houver, onde o item fica na hierarquia. */
export function rotuloItemTpu(item: ItemTpu): string {
  const trilha = (item.caminho ?? '').split(' > ').filter(Boolean)
  // Só os dois últimos níveis: a árvore completa não cabe numa linha.
  const resumo = trilha.slice(-2).join(' › ')
  return resumo ? `${item.codigo} · ${resumo}` : String(item.codigo)
}
