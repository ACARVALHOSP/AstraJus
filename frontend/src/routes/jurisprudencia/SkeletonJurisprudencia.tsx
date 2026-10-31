import { SkeletonText, Stack, Tile } from '@carbon/react'

export function SkeletonJurisprudencia() {
  return (
    <Stack gap={5} aria-busy="true" aria-label="Carregando acórdãos da jurisprudência…">
      {[1, 2, 3].map((idx) => (
        <Tile key={idx}>
          <Stack gap={3}>
            <div className="aj-layout-48" style={{ alignItems: 'center' }}>
              <SkeletonText width="50px" />
              <SkeletonText width="100px" />
              <div style={{ flex: '1 1 auto' }} />
              <SkeletonText width="120px" />
            </div>
            <SkeletonText paragraph lineCount={3} />
            <SkeletonText width="55%" />
            <div className="aj-layout-48" style={{ marginTop: '0.5rem' }}>
              <SkeletonText width="110px" />
            </div>
          </Stack>
        </Tile>
      ))}
    </Stack>
  )
}
