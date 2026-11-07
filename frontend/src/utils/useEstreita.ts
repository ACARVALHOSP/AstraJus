import { useEffect, useState } from 'react'

/** Verdadeiro em telas estreitas (celular), onde as listas viram cartões. */
export function useEstreita(consulta = '(max-width: 672px)') {
  const [estreita, setEstreita] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const media = window.matchMedia(consulta)
    const mudar = () => setEstreita(media.matches)
    media.addEventListener('change', mudar)
    return () => media.removeEventListener('change', mudar)
  }, [consulta])
  return estreita
}
