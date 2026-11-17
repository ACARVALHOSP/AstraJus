// Sugestão de prazo por modelo: a classe/assunto do processo escolhe o modelo e o texto da publicação
// escolhe, entre os prazos desse modelo, o que a publicação está pedindo. Só sugere quando os dois
// concordam e há um único prazo candidato; na dúvida, não sugere nada.
import type { ItemPrazo, Modelo } from '../casos/modelosPrazo.ts'

export type SugestaoModeloPrazo = { modelo: string; prazo: ItemPrazo; classe: string }

/** Minúsculas, sem acento e com espaços simples (igual ao `normalizar` de modelos_prazo.py). */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

const PALAVRAS_VAZIAS = new Set(['prazo', 'para', 'sobre', 'dias', 'apresentar', 'protocolar', 'ofertar'])
const TAMANHO_RADICAL = 6

/** Radicais das palavras do título do prazo ("Contestação" → "contes"): casam com contestar, contestação etc. */
function radicais(titulo: string): string[] {
  return normalizar(titulo).split(/[^a-z0-9]+/).filter(p => p.length >= 4 && !PALAVRAS_VAZIAS.has(p)).map(p => p.slice(0, TAMANHO_RADICAL))
}

/** O texto cita o prazo quando traz todas as palavras do título (pelo radical). */
export function textoCitaPrazo(titulo: string, texto: string): boolean {
  const rs = radicais(titulo)
  if (!rs.length) return false
  const palavras = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean)
  return rs.every(r => palavras.some(p => p.startsWith(r)))
}

/** `textosClasse`: classe e assuntos do processo (capa, DJEN). Um modelo vale quando o critério está contido
 *  em algum deles; dentre os prazos desses modelos, vale o que o texto da publicação cita. */
export function sugerirPorModelo(
  modelos: Array<Pick<Modelo, 'nome' | 'criterio' | 'ativo' | 'prazos'>>, textosClasse: string[], textoPublicacao: string,
): SugestaoModeloPrazo | null {
  const classes = textosClasse.filter(Boolean).map(t => ({ original: t, normal: normalizar(t) }))
  const candidatos = new Map<string, SugestaoModeloPrazo>()
  for (const modelo of modelos) {
    const chave = normalizar(modelo.criterio)
    const classe = chave ? classes.find(c => c.normal.includes(chave)) : undefined
    if (!modelo.ativo || !classe) continue
    for (const prazo of modelo.prazos) {
      if (!textoCitaPrazo(prazo.titulo, textoPublicacao)) continue
      const id = `${normalizar(prazo.titulo)}|${prazo.dias}|${prazo.contagem}`
      if (!candidatos.has(id)) candidatos.set(id, { modelo: modelo.nome, prazo, classe: classe.original })
    }
  }
  return candidatos.size === 1 ? [...candidatos.values()][0] : null
}
