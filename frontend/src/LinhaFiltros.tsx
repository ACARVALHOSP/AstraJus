import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Badge, Button, Dialog, Flex } from '@radix-ui/themes'
import { SlidersHorizontal } from 'lucide-react'
import { useEstreita } from './utils/useEstreita'

/**
 * Linha de busca e filtros das listas. No computador, tudo numa linha. No celular, fica só a busca
 * (o filho com a classe `aj-filtros-busca`) e um botão "Filtros" que abre os demais numa folha
 * inferior, para a lista começar na primeira tela.
 */
export default function LinhaFiltros({ children, ativos = 0 }: { children: ReactNode; ativos?: number }) {
  const estreita = useEstreita()
  const [aberta, setAberta] = useState(false)
  if (!estreita) return <div className="aj-filtros-linha">{children}</div>

  const itens = Children.toArray(children).filter(isValidElement) as ReactElement<{ className?: string }>[]
  const ehBusca = (c: ReactElement<{ className?: string }>) => /\baj-filtros-busca\b/.test(c.props.className ?? '')
  const busca = itens.filter(ehBusca)
  const demais = itens.filter(c => !ehBusca(c))
  if (!demais.length) return <div className="aj-filtros-linha">{children}</div>

  return (
    <div className="aj-filtros-linha aj-filtros-linha--compacta">
      {busca}
      <Dialog.Root open={aberta} onOpenChange={setAberta}>
        <Dialog.Trigger>
          <Button size="2" variant="soft" color={ativos ? undefined : 'gray'} className="aj-filtros-botao">
            <SlidersHorizontal size={15} aria-hidden />
            Filtros
            {ativos > 0 && <Badge variant="solid" radius="full">{ativos}</Badge>}
          </Button>
        </Dialog.Trigger>
        <Dialog.Content className="aj-folha" aria-describedby={undefined}>
          <Dialog.Title size="4" mb="4">Filtros</Dialog.Title>
          <Flex direction="column" gap="4" className="aj-folha-campos">{demais}</Flex>
          <Flex mt="5">
            <Dialog.Close><Button size="3" style={{ flex: 1 }}>Ver resultados</Button></Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  )
}
