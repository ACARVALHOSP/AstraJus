import { OverflowMenu, OverflowMenuItem, useTheme } from '@carbon/react'

type Acao = { texto: string; executar?: () => void; href?: string; perigo?: boolean; desabilitada?: boolean }

export default function AcoesTabela({ rotulo, acoes }: { rotulo: string; acoes: Acao[] }) {
  const { theme } = useTheme()
  if (!acoes.length) return <span>—</span>
  return (
    <OverflowMenu flipped size="sm" menuOptionsClass={`acoes-tabela-menu--${theme}`} aria-label={`Ações: ${rotulo}`} iconDescription={`Ações: ${rotulo}`}>
      {acoes.map((acao, indice) => (
        <OverflowMenuItem
          key={acao.texto}
          itemText={acao.texto}
          onClick={acao.executar}
          disabled={acao.desabilitada}
          isDelete={acao.perigo}
          hasDivider={acao.perigo && indice > 0}
          dangerDescription="Ação destrutiva"
          {...(acao.href ? { href: acao.href, target: '_blank', rel: 'noopener noreferrer' } : {})}
        />
      ))}
    </OverflowMenu>
  )
}
