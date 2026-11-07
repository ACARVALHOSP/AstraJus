import { useEffect, useRef, useState } from 'react'
import { IconButton, TextField } from '@radix-ui/themes'
import { CalendarDays } from 'lucide-react'

type Props = {
  id: string
  /** Data ISO (aaaa-mm-dd) ou vazio. */
  value?: string
  /** Recebe a data ISO válida, ou '' enquanto o texto estiver incompleto/inválido. */
  onChange: (iso: string) => void
  disabled?: boolean
  required?: boolean
  'aria-describedby'?: string
}

function isoParaTexto(iso?: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function textoParaIso(texto: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  if (!m) return ''
  const [, d, mes, a] = m
  const data = new Date(Number(a), Number(mes) - 1, Number(d))
  const valida = data.getFullYear() === Number(a) && data.getMonth() === Number(mes) - 1 && data.getDate() === Number(d)
  return valida ? `${a}-${mes}-${d}` : ''
}

function mascarar(bruto: string) {
  const digitos = bruto.replace(/\D/g, '').slice(0, 8)
  if (digitos.length <= 2) return digitos
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`
}

/**
 * Campo de data no formato brasileiro (dd/mm/aaaa), independente do idioma do navegador.
 * O botão de calendário abre o seletor nativo como atalho.
 */
export default function CampoData({ id, value, onChange, disabled, required, ...aria }: Props) {
  const [texto, setTexto] = useState(() => isoParaTexto(value))
  const nativo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Sincroniza mudanças externas sem apagar o que o usuário ainda está digitando.
    if ((value ?? '') !== textoParaIso(texto)) setTexto(isoParaTexto(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const iso = textoParaIso(texto)
  const invalido = texto.length === 10 && !iso

  return (
    <TextField.Root
      id={id}
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      value={texto}
      disabled={disabled}
      required={required}
      aria-required={required || undefined}
      aria-invalid={invalido || undefined}
      color={invalido ? 'red' : undefined}
      aria-describedby={aria['aria-describedby']}
      onChange={(e) => {
        const novo = mascarar(e.target.value)
        setTexto(novo)
        onChange(textoParaIso(novo))
      }}
    >
      <TextField.Slot side="right">
        <IconButton
          type="button"
          size="1"
          variant="ghost"
          color="gray"
          disabled={disabled}
          aria-label="Abrir calendário"
          className="aj-campo-data-botao"
          onClick={() => {
            const campo = nativo.current
            if (!campo) return
            campo.value = iso
            try { campo.showPicker() } catch { campo.focus() }
          }}
        >
          <CalendarDays size={14} aria-hidden="true" />
        </IconButton>
        <input
          ref={nativo}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="aj-campo-data-nativo"
          onChange={(e) => {
            setTexto(isoParaTexto(e.target.value))
            onChange(e.target.value)
          }}
        />
      </TextField.Slot>
    </TextField.Root>
  )
}
