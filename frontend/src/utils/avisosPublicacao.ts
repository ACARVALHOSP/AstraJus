// Como a pessoa quer receber os e-mails de publicações novas (Meu perfil). Sem React, para testar em
// tests/avisos-publicacao.test.mjs.

export type AvisosPublicacao = 'imediato' | 'resumo' | 'ambos'

export const OPCOES_AVISOS: { valor: AvisosPublicacao; rotulo: string; descricao: string }[] = [
  { valor: 'imediato', rotulo: 'Cada publicação', descricao: 'Um e-mail a cada verificação em que houver publicação nova, como sempre foi.' },
  { valor: 'resumo', rotulo: 'Resumo do dia', descricao: 'Um único e-mail por dia, de manhã, com tudo o que chegou. Sem e-mail a cada lote.' },
  { valor: 'ambos', rotulo: 'Os dois', descricao: 'O e-mail de cada lote e também o resumo do dia.' },
]

/** Valor vindo do servidor; qualquer coisa fora das três opções vira o padrão ("Os dois"). */
export function normalizarAvisos(valor: unknown): AvisosPublicacao {
  return valor === 'imediato' || valor === 'resumo' || valor === 'ambos' ? valor : 'ambos'
}
