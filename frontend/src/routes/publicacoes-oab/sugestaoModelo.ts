// Sugestão de prazo por regra: o backend já casou classe/assunto e palavras-chave da publicação
// com as regras ativas e devolveu as sugestões da mais específica para a menos. Aqui só escolhemos
// a primeira e traduzimos o motivo para uma frase legível. Só sugere; quem cria o prazo é a pessoa.
import type { Sugestao } from '../casos/regrasPrazo.ts'

export type SugestaoPrazoRegra = {
  regra: string
  prazo: { titulo: string; dias: number; contagem: 'uteis' | 'corridos' }
  motivo: string
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/** Motivo em português: termos casados entre aspas e/ou o item de escopo (classe/assunto). */
export function motivoDaSugestao(sugestao: Pick<Sugestao, 'termos' | 'correspondeu_a'>): string {
  const partes: string[] = []
  const termos = (sugestao.termos ?? []).filter(Boolean)
  if (termos.length) partes.push(`termos ${listar(termos.map(t => `“${t}”`))}`)
  const escopo = sugestao.correspondeu_a
  if (escopo?.nome) partes.push(`${escopo.tipo === 'assunto' ? 'assunto' : 'classe'} “${escopo.nome}”`)
  // Regra sem palavras-chave e sem escopo casado: não inventa motivo, assume o casamento da regra.
  return partes.length ? partes.join(' e ') : 'a regra casou com o processo e a publicação'
}

/** Primeira sugestão (a mais específica, já ordenada pelo backend), ou null quando não há nenhuma. */
export function escolherSugestao(sugestoes: Sugestao[]): SugestaoPrazoRegra | null {
  const primeira = sugestoes?.[0]
  if (!primeira) return null
  return {
    regra: primeira.regra.nome,
    prazo: { titulo: primeira.tipo.nome, dias: primeira.tipo.dias, contagem: primeira.tipo.contagem },
    motivo: motivoDaSugestao(primeira),
  }
}

/** Todas as sugestões no formato da tela; a primeira é a aplicada e as demais só são contadas. */
export function sugestoesParaLista(sugestoes: Sugestao[]): SugestaoPrazoRegra[] {
  return (sugestoes ?? []).map(s => ({
    regra: s.regra.nome,
    prazo: { titulo: s.tipo.nome, dias: s.tipo.dias, contagem: s.tipo.contagem },
    motivo: motivoDaSugestao(s),
  }))
}
