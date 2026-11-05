import { Plus, X } from 'lucide-react'
import { Button, Select, TextField } from '@radix-ui/themes'

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
      <span className="form-campo-label">{titulo}</span>
      <div className="aj-layout-29">
        {itens.map((item, indice) => (
          <div key={indice} className={`campo-repetivel-linha campo-repetivel-grade--${Math.min(campos.length, 3)}`}>
            {campos.map((campo) =>
              campo.tipo === 'select' ? (
                <div key={campo.chave} className="form-campo">
                  <label className="form-campo-label" htmlFor={`${titulo}-${indice}-${campo.chave}`}>{campo.rotulo}</label>
                  <Select.Root
                    value={item[campo.chave] || '__empty__'}
                    onValueChange={(v) => onAlterar(indice, campo.chave, v === '__empty__' ? '' : v)}
                  >
                    <Select.Trigger id={`${titulo}-${indice}-${campo.chave}`} style={{ width: '100%' }} />
                    <Select.Content>
                      {campo.opcoes?.map((o) => (
                        <Select.Item key={o.valor || '__empty__'} value={o.valor || '__empty__'}>{o.rotulo}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </div>
              ) : (
                <div key={campo.chave} className="form-campo">
                  <label className="form-campo-label" htmlFor={`${titulo}-${indice}-${campo.chave}`}>{campo.rotulo}</label>
                  <TextField.Root
                    id={`${titulo}-${indice}-${campo.chave}`}
                    type={campo.tipoInput ?? 'text'}
                    value={item[campo.chave] ?? ''}
                    onChange={(e) => onAlterar(indice, campo.chave, e.target.value)}
                  />
                </div>
              ),
            )}
            <div className="aj-layout-30">
              <Button variant="ghost" size="1" aria-label="Remover" onClick={() => onRemover(indice)}>
                <X size={16} />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="1" onClick={onAdicionar} className="aj-layout-31">
        <Plus size={16} />
        Adicionar {titulo.toLowerCase()}
      </Button>
    </div>
  )
}
