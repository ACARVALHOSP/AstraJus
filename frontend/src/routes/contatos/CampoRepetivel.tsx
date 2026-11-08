import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Select, Text, TextField } from '@radix-ui/themes'

export type OpcaoTipo = { valor: string; rotulo: string }

type Campo = {
  chave: string
  tipo: 'select' | 'texto'
  rotulo: string
  opcoes?: OpcaoTipo[]
  tipoInput?: string
  placeholder?: string
  /** Formata enquanto a pessoa digita (ex.: telefone). */
  mascara?: (valor: string) => string
  /** Mensagem de erro do valor, ou '' se estiver certo; aparece ao sair do campo. */
  validar?: (valor: string) => string
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
  const [tocados, setTocados] = useState<Set<string>>(new Set())
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
                <CampoTexto key={campo.chave} id={`${titulo}-${indice}-${campo.chave}`} campo={campo}
                  valor={item[campo.chave] ?? ''}
                  tocado={tocados.has(`${indice}-${campo.chave}`)}
                  onTocar={() => setTocados(t => new Set(t).add(`${indice}-${campo.chave}`))}
                  onAlterar={(v) => onAlterar(indice, campo.chave, v)} />
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

function CampoTexto({ id, campo, valor, tocado, onTocar, onAlterar }: {
  id: string; campo: Campo; valor: string; tocado: boolean; onTocar: () => void; onAlterar: (v: string) => void
}) {
  const erro = tocado && campo.validar ? campo.validar(valor) : ''
  return (
    <div className="form-campo">
      <label className="form-campo-label" htmlFor={id}>{campo.rotulo}</label>
      <TextField.Root
        id={id}
        type={campo.tipoInput as React.ComponentProps<typeof TextField.Root>['type'] ?? 'text'}
        placeholder={campo.placeholder}
        value={valor}
        color={erro ? 'red' : undefined}
        aria-invalid={Boolean(erro)}
        aria-describedby={erro ? `${id}-erro` : undefined}
        onChange={(e) => onAlterar(campo.mascara ? campo.mascara(e.target.value) : e.target.value)}
        onBlur={onTocar}
      />
      {erro && <Text id={`${id}-erro`} size="1" color="red">{erro}</Text>}
    </div>
  )
}
