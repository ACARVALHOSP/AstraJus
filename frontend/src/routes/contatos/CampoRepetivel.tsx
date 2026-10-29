import { Button, Select, SelectItem, TextInput } from '@carbon/react'

export type OpcaoTipo = { valor: string; rotulo: string }

type Campo = {
  chave: string
  tipo: 'select' | 'texto'
  rotulo: string
  opcoes?: OpcaoTipo[]
  tipoInput?: string
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
        {itens.map((item, indice) => (
          <div key={indice} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {campos.map((campo) =>
              campo.tipo === 'select' ? (
                <div key={campo.chave} style={{ maxWidth: `calc(${Math.max(...(campo.opcoes?.map((o) => o.rotulo.length) ?? [8]))}ch + 3.5rem)` }}>
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
                </div>
              ) : (
                <TextInput
                  key={campo.chave}
                  id={`${titulo}-${indice}-${campo.chave}`}
                  type={campo.tipoInput ?? 'text'}
                  labelText={campo.rotulo}
                  value={item[campo.chave] ?? ''}
                  onChange={(e) => onAlterar(indice, campo.chave, e.target.value)}
                />
              ),
            )}
            <Button kind="ghost" size="sm" hasIconOnly iconDescription="Remover" onClick={() => onRemover(indice)}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button kind="ghost" size="sm" onClick={onAdicionar} style={{ marginTop: '0.5rem' }}>
        + Adicionar {titulo.toLowerCase()}
      </Button>
    </div>
  )
}
