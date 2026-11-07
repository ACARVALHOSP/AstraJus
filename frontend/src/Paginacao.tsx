import { Button, Text } from '@radix-ui/themes'

export const POR_PAGINA = 20

/** Rodapé padrão das listas: "Mostrando 1–20 de 57 …" e Anterior / Próxima. */
export default function Paginacao({ pagina, total, porPagina = POR_PAGINA, onPagina, nome, rotulo }: {
  pagina: number
  total: number
  porPagina?: number
  onPagina: (pagina: number) => void
  /** Plural do item, ex.: "atividades". */
  nome: string
  /** Rótulo acessível da navegação, ex.: "Páginas de atividades". */
  rotulo?: string
}) {
  if (total <= porPagina) return null
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))
  const atual = Math.min(Math.max(1, pagina), totalPaginas)
  return (
    <nav aria-label={rotulo ?? `Páginas de ${nome}`} className="aj-paginacao">
      <Text size="2" color="gray">
        Mostrando {(atual - 1) * porPagina + 1}–{Math.min(atual * porPagina, total)} de {total} {nome}
      </Text>
      <span style={{ marginLeft: 'auto' }} />
      <Button variant="soft" color="gray" size="2" disabled={atual <= 1} onClick={() => onPagina(atual - 1)} aria-label="Página anterior">Anterior</Button>
      <Text size="2">Página {atual} de {totalPaginas}</Text>
      <Button variant="soft" color="gray" size="2" disabled={atual >= totalPaginas} onClick={() => onPagina(atual + 1)} aria-label="Próxima página">Próxima</Button>
    </nav>
  )
}

/** Página atual que volta para 1 sempre que a chave dos filtros muda. */
export function paginaPara(estado: { chave: string; pagina: number }, chave: string) {
  return estado.chave === chave ? estado.pagina : 1
}
