import { Card, Flex, Skeleton } from '@radix-ui/themes'

export function SkeletonJurisprudencia() {
  return (
    <Flex direction="column" gap="5" aria-busy="true" aria-label="Carregando acórdãos da jurisprudência…">
      {[1, 2, 3].map((idx) => (
        <Card key={idx} variant="surface">
          <Flex direction="column" gap="3">
            <Flex align="center" gap="2">
              <Skeleton><span>50px</span></Skeleton>
              <Skeleton><span>Classe exemplo</span></Skeleton>
              <div style={{ flex: '1 1 auto' }} />
              <Skeleton><span>Julgado em 00/00/0000</span></Skeleton>
            </Flex>
            <Skeleton><p>Linha de texto de exemplo para o corpo da ementa que ocupa algumas linhas.</p></Skeleton>
            <Skeleton><p>Linha de texto de exemplo para o corpo da ementa que ocupa algumas linhas.</p></Skeleton>
            <Skeleton><p>Linha de texto de exemplo.</p></Skeleton>
            <Skeleton><span>Relator(a): Exemplo</span></Skeleton>
            <Flex mt="2">
              <Skeleton><span>Copiar ementa</span></Skeleton>
            </Flex>
          </Flex>
        </Card>
      ))}
    </Flex>
  )
}
