import type { ReactNode } from 'react'
import { Heading, Text } from '@radix-ui/themes'

type Props = {
  titulo: ReactNode
  /** Texto curto acima do título (ex.: data no Início). */
  sobretitulo?: ReactNode
  descricao?: ReactNode
  /** Ação principal (e secundárias) alinhadas à direita do título. */
  acoes?: ReactNode
  /** Recebe foco programático ao trocar de tela. */
  focavel?: boolean
  /** Abas de navegação entre telas irmãs, logo abaixo do cabeçalho. */
  abas?: ReactNode
}

/** Cabeçalho único das telas: título 24 px, descrição cinza e ações à direita. */
export default function CabecalhoPagina({ titulo, sobretitulo, descricao, acoes, focavel, abas }: Props) {
  return (
    <>
    <header className="aj-cabecalho-pagina">
      <div className="aj-cabecalho-pagina-texto">
        {sobretitulo && <p className="aj-cabecalho-pagina-sobretitulo">{sobretitulo}</p>}
        <Heading as="h1" size="6" tabIndex={focavel ? -1 : undefined}>{titulo}</Heading>
        {descricao && <Text as="p" size="2" color="gray" className="aj-cabecalho-pagina-descricao">{descricao}</Text>}
      </div>
      {acoes && <div className="aj-cabecalho-pagina-acoes">{acoes}</div>}
    </header>
    {abas}
    </>
  )
}
