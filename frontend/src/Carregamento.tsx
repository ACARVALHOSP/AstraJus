import { DataTableSkeleton, SkeletonText, Stack } from '@carbon/react'

type Props = {
  tipo?: 'tabela' | 'detalhe' | 'cartoes' | 'texto'
  descricao?: string
  colunas?: number
}

/** Representa somente conteúdo pendente; ações mantêm seu próprio feedback. */
export default function Carregamento({ tipo = 'tabela', descricao = 'Carregando dados…', colunas = 5 }: Props) {
  return (
    <div className={`carregamento carregamento--${tipo}`}>
      <span className="carregamento-status" role="status">{descricao}</span>
      <div aria-hidden="true" aria-busy="true" className="carregamento-conteudo">
        {tipo === 'tabela' ? (
          <DataTableSkeleton columnCount={colunas} rowCount={5} showHeader={false} showToolbar={false} />
        ) : (
          <Stack gap={5}>
            {Array.from({ length: tipo === 'texto' ? 1 : 3 }, (_, i) => (
              <div key={i} className={tipo === 'cartoes' ? 'carregamento-cartao' : undefined}>
                {tipo !== 'texto' && <SkeletonText heading width="45%" />}
                <SkeletonText paragraph lineCount={tipo === 'texto' ? 2 : 3} />
              </div>
            ))}
          </Stack>
        )}
      </div>
    </div>
  )
}
