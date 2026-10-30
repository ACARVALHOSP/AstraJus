import { useLayoutEffect, useRef, useState } from 'react'
import { Tooltip } from '@carbon/react'

export default function TextoTabela({ texto, onClick }: { texto: string; onClick?: () => void }) {
  const elemento = useRef<HTMLElement | null>(null)
  const [cortado, setCortado] = useState(false)

  useLayoutEffect(() => {
    const alvo = elemento.current
    if (!alvo) return
    const medir = () => setCortado(alvo.scrollWidth > alvo.clientWidth + 1)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [texto, cortado])

  const ref = (alvo: HTMLElement | null) => { elemento.current = alvo }
  const conteudo = onClick ? (
    <button ref={ref} type="button" className="contato-nome-link texto-tabela" onClick={onClick}>{texto}</button>
  ) : (
    <span ref={ref} className="texto-tabela" tabIndex={cortado ? 0 : undefined}>{texto}</span>
  )

  return cortado ? (
    <Tooltip label={texto} autoAlign align="bottom" closeOnActivation={false} className="texto-tabela-dica" enterDelayMs={200}>
      {conteudo}
    </Tooltip>
  ) : conteudo
}
