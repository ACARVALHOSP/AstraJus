import { Button, Column, Grid, Select, SelectItem, TextInput } from '@carbon/react'

export type OpcaoTipo = { valor: string; rotulo: string }

type Campo = {
  chave: string
  tipo: 'select' | 'texto'
  rotulo: string
  opcoes?: OpcaoTipo[]
  tipoInput?: string
}

function spanSelect(opcoes: OpcaoTipo[] | undefined): number {
  const maior = Math.max(...(opcoes?.map((o) => o.rotulo.length) ?? [8]))
  return maior <= 7 ? 3 : maior <= 11 ? 4 : 5
}

export default function CampoRepetivel<T extends Record<string, string>>({
  titulo,
  itens,
  campos,
  onAdicionar,
  onRemover,
  onAlterar,
}: {
  titulo: string
  itens: T[]
  campos: Campo[]
  onAdicionar: () => void
  onRemover: (indice: number) => void
  onAlterar: (indice: number, chave: string, valor: string) => void
}) {
  return (
    <div>
      <span className="cds--label">{titulo}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
        {itens.map((item, indice) => {
          const selectSpans = campos.filter((c) => c.tipo === 'select').reduce((soma, c) => soma + spanSelect(c.opcoes), 0)
          const textos = campos.filter((c) => c.tipo === 'texto')
          const spanTexto = Math.max(3, Math.floor((15 - selectSpans) / Math.max(textos.length, 1)))
          return (
            <Grid key={indice} narrow fullWidth className="campo-repetivel-linha">
              {campos.map((campo) =>
                campo.tipo === 'select' ? (
                  <Column key={campo.chave} sm={4} md={spanSelect(campo.opcoes)} lg={spanSelect(campo.opcoes)}>
                    <Select
                      id={`${titulo}-${indice}-${campo.chave}`}
                      labelText={campo.rotulo}
                      value={item[campo.chave] ?? ''}
                      onChange={(e) => onAlterar(indice, campo.chave, e.target.value)}
                    >
                      {campo.opcoes?.map((o) => (
                        <SelectItem key={o.valor} value={o.valor} text={o.rotulo} />
                      ))}
                    </Select>
                  </Column>
                ) : (
                  <Column key={campo.chave} sm={4} md={spanTexto} lg={spanTexto}>
                    <TextInput
                      id={`${titulo}-${indice}-${campo.chave}`}
                      type={campo.tipoInput ?? 'text'}
                      labelText={campo.rotulo}
                      value={item[campo.chave] ?? ''}
                      onChange={(e) => onAlterar(indice, campo.chave, e.target.value)}
                    />
                  </Column>
                ),
              )}
              <Column sm={4} md={1} lg={1} style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button kind="ghost" size="sm" hasIconOnly iconDescription="Remover" onClick={() => onRemover(indice)}>
                  ✕
                </Button>
              </Column>
            </Grid>
          )
        })}
      </div>
      <Button kind="ghost" size="sm" onClick={onAdicionar} style={{ marginTop: '0.5rem' }}>
        + Adicionar {titulo.toLowerCase()}
      </Button>
    </div>
  )
}
