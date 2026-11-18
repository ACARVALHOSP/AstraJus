// Regras de distribuição de responsável (editor da tela "Automações"): tipos, ordem e validação local, sem React
// (testado em tests/regrasResponsavel.test.mjs). O servidor valida de verdade; aqui evita-se o ida-e-volta óbvio.

export type TipoRegra = 'captou' | 'cliente' | 'classe' | 'assunto' | 'tribunal' | 'orgao' | 'padrao'
export type Regra = { id?: number | null; tipo: TipoRegra; valor: string; responsavel: string; ativo: boolean; invalida?: boolean }

export const LIMITE_REGRAS = 50

export const TIPOS: { id: TipoRegra; rotulo: string; dica: string }[] = [
  { id: 'captou', rotulo: 'Quem captou a publicação', dica: 'O processo vai para quem monitorou a OAB que trouxe a publicação.' },
  { id: 'cliente', rotulo: 'Cliente', dica: 'Processos deste cliente.' },
  { id: 'classe', rotulo: 'Classe contém', dica: 'Parte do nome da classe (ex.: Execução). Sem diferenciar acento ou maiúscula.' },
  { id: 'assunto', rotulo: 'Assunto contém', dica: 'Parte do assunto (ex.: Alimentos).' },
  { id: 'tribunal', rotulo: 'Tribunal é', dica: 'Sigla exata do tribunal (ex.: TJSP).' },
  { id: 'orgao', rotulo: 'Órgão julgador contém', dica: 'Parte do nome da vara ou órgão (ex.: 2ª Vara).' },
  { id: 'padrao', rotulo: 'Padrão do escritório', dica: 'Vale para todo o resto. Fica sempre por último.' },
]

export const tipoDe = (id: TipoRegra) => TIPOS.find(t => t.id === id) ?? TIPOS[0]
export const temValor = (t: TipoRegra) => !['captou', 'padrao'].includes(t)
export const temPessoa = (t: TipoRegra) => t !== 'captou'

/** Move a regra uma posição; o padrão nunca sai do fim e nada passa por baixo dele. */
export function moverRegra(lista: Regra[], indice: number, delta: -1 | 1): Regra[] {
  const alvo = indice + delta
  if (indice < 0 || alvo < 0 || indice >= lista.length || alvo >= lista.length) return lista
  if (lista[indice].tipo === 'padrao' || lista[alvo].tipo === 'padrao') return lista
  const nova = [...lista]
  ;[nova[indice], nova[alvo]] = [nova[alvo], nova[indice]]
  return nova
}

/** Primeira mensagem de erro da lista, ou '' se estiver pronta para salvar. */
export function erroDasRegras(lista: Regra[], pessoasAtivas: string[]): string {
  if (lista.length > LIMITE_REGRAS) return `No máximo ${LIMITE_REGRAS} regras.`
  if (lista.filter(r => r.tipo === 'padrao').length > 1) return 'Só pode haver um padrão do escritório.'
  for (const [i, r] of lista.entries()) {
    const nome = `Regra ${i + 1} (${tipoDe(r.tipo).rotulo})`
    if (temValor(r.tipo) && !r.valor.trim()) return `${nome}: preencha o valor.`
    if (r.valor.length > 200) return `${nome}: valor longo demais (máx. 200 caracteres).`
    if (r.tipo === 'padrao' && !r.responsavel) continue // padrão sem pessoa = "ninguém"
    if (temPessoa(r.tipo) && (!r.responsavel || !pessoasAtivas.includes(r.responsavel))) return `${nome}: escolha um responsável ativo.`
  }
  return ''
}

/** Resumo da regra em uma frase, para a lista e a simulação. */
export function resumoRegra(r: Regra, nomePessoa: (l: string) => string, nomeCliente: (id: string) => string): string {
  const quem = r.responsavel ? nomePessoa(r.responsavel) : 'ninguém'
  if (r.tipo === 'captou') return 'Quem captou a publicação fica responsável'
  if (r.tipo === 'padrao') return `Todo o resto → ${quem}`
  const valor = r.tipo === 'cliente' ? nomeCliente(r.valor) : r.valor
  return `${tipoDe(r.tipo).rotulo} “${valor}” → ${quem}`
}
