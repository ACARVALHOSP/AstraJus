import { useEffect, useRef } from 'react'

/** Fecha painéis não modais sem prender a navegação por teclado. */
export function usePainelShell(aberto: boolean, fechar: () => void) {
  const raiz = useRef<HTMLDivElement>(null)
  const fecharAtual = useRef(fechar)
  useEffect(() => { fecharAtual.current = fechar }, [fechar])
  useEffect(() => {
    if (!aberto) return
    const acionador = raiz.current?.querySelector<HTMLButtonElement>('button')
    function teclado(evento: KeyboardEvent) {
      if (evento.key !== 'Escape') return
      evento.preventDefault()
      evento.stopPropagation()
      fecharAtual.current()
      acionador?.focus()
    }
    function fora(evento: MouseEvent | FocusEvent) {
      if (raiz.current && !raiz.current.contains(evento.target as Node)) fecharAtual.current()
    }
    document.addEventListener('keydown', teclado, true)
    document.addEventListener('click', fora, true)
    document.addEventListener('focusin', fora)
    return () => {
      document.removeEventListener('keydown', teclado, true)
      document.removeEventListener('click', fora, true)
      document.removeEventListener('focusin', fora)
    }
  }, [aberto])
  return raiz
}
