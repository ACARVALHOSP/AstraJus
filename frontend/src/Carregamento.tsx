import { Flex, Skeleton } from '@radix-ui/themes'

type Props = {
  tipo?: 'tabela' | 'detalhe' | 'cartoes' | 'texto'
  descricao?: string
  colunas?: number
}

export default function Carregamento({ tipo = 'tabela', descricao = 'Carregando dados…', colunas = 5 }: Props) {
  return (
    <div className={`carregamento carregamento--${tipo}`}>
      <span className="carregamento-status" role="status">{descricao}</span>
      <Flex direction="column" gap="2" aria-hidden="true" aria-busy="true">
        {tipo === 'tabela' ? (
          Array.from({ length: 5 }, (_, i) => (
            <Flex key={i} gap="2">
              {Array.from({ length: colunas }, (_, j) => (
                <Skeleton key={j} height="2.25rem" style={{ flex: 1 }} />
              ))}
            </Flex>
          ))
        ) : tipo === 'texto' ? (
          <Flex direction="column" gap="2">
            <Skeleton height="1rem" width="90%" />
            <Skeleton height="1rem" width="75%" />
          </Flex>
        ) : (
          Array.from({ length: tipo === 'cartoes' ? 3 : 2 }, (_, i) => (
            <Flex key={i} direction="column" gap="2" p="4" style={{ background: 'var(--color-panel-solid)', borderRadius: 'var(--radius-3)', border: '1px solid var(--gray-a4)' }}>
              <Skeleton height="1.1rem" width="40%" />
              <Skeleton height="0.9rem" />
              <Skeleton height="0.9rem" width="80%" />
            </Flex>
          ))
        )}
      </Flex>
    </div>
  )
}
