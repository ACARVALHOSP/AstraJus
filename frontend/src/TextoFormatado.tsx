import { type ReactNode } from 'react'

const TAGS = { b: 'strong', i: 'em', u: 'u' } as const
type Tag = keyof typeof TAGS
const decodificar = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Monta o texto formatado a partir do HTML restrito que o servidor devolve (só <b>, <i> e <u>, texto escapado,
 *  quebras de linha como \n). Não usa innerHTML: qualquer outra marcação vira texto literal. `limite` corta
 *  pelo texto visível e acrescenta reticências. */
export function formatado(html: string, limite?: number): ReactNode[] {
  const raiz: ReactNode[] = []
  const pilha: { tag: Tag; filhos: ReactNode[] }[] = []
  const destino = () => (pilha.length ? pilha[pilha.length - 1].filhos : raiz)
  let visivel = 0
  let cortado = false
  let chave = 0
  for (const parte of html.split(/(<\/?[biu]>)/)) {
    if (!parte) continue
    const marca = /^<(\/?)([biu])>$/.exec(parte)
    if (marca) {
      const tag = marca[2] as Tag
      if (!marca[1]) pilha.push({ tag, filhos: [] })
      else if (pilha.some(p => p.tag === tag)) {
        while (pilha.length) {   // fecha em ordem, tolerando aninhamento mal formado
          const topo = pilha.pop()!
          const El = TAGS[topo.tag]
          destino().push(<El key={chave++}>{topo.filhos}</El>)
          if (topo.tag === tag) break
        }
      }
      continue
    }
    let texto = decodificar(parte)
    if (limite !== undefined && visivel + texto.length > limite) { texto = texto.slice(0, Math.max(0, limite - visivel)).trimEnd() + '…'; cortado = true }
    visivel += texto.length
    destino().push(texto)
    if (cortado) break
  }
  while (pilha.length) {
    const topo = pilha.pop()!
    const El = TAGS[topo.tag]
    destino().push(<El key={chave++}>{topo.filhos}</El>)
  }
  return raiz
}

/** Texto de uma publicação do DJEN: com negrito, itálico e sublinhado quando o servidor guardou a formatação,
 *  senão o texto puro. Quem mostra deve preservar as quebras de linha (white-space: pre-wrap). */
export default function TextoFormatado({ texto, html, limite }: { texto?: string | null; html?: string | null; limite?: number }) {
  if (html) return <>{formatado(html, limite)}</>
  return <>{texto ?? ''}</>
}
