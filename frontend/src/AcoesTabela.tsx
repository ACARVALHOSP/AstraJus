import { Fragment } from 'react'
import { DropdownMenu, IconButton } from '@radix-ui/themes'
import { MoreVertical } from 'lucide-react'

type Acao = { texto: string; executar?: () => void; href?: string; perigo?: boolean; desabilitada?: boolean }

export default function AcoesTabela({ rotulo, acoes }: { rotulo: string; acoes: Acao[] }) {
  if (!acoes.length) return <span>—</span>
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton variant="ghost" color="gray" size="2" aria-label={`Ações: ${rotulo}`}>
          <MoreVertical size={16} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {acoes.map((acao, indice) => (
          <Fragment key={acao.texto}>
            {acao.perigo && indice > 0 && <DropdownMenu.Separator />}
            {acao.href ? (
              <DropdownMenu.Item disabled={acao.desabilitada} color={acao.perigo ? 'red' : undefined} asChild>
                <a href={acao.href} target="_blank" rel="noopener noreferrer">{acao.texto}</a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item disabled={acao.desabilitada} color={acao.perigo ? 'red' : undefined} onSelect={acao.executar}>
                {acao.texto}
              </DropdownMenu.Item>
            )}
          </Fragment>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}
