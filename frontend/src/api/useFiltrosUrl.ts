import { useEffect, useRef, useState } from 'react'
import { useNavegacao } from './NavegacaoContext'
import { lerHash } from './hash'

// Filtros de uma tela guardados na URL ("#/horas?de=2026-11-01&status=a_faturar"): recarregar,
// copiar o link ou voltar no navegador mostra a tela do mesmo jeito. Só o que difere do padrão
// vai para o endereço, exceto as chaves em `fixos` (ex.: o período, para o link não "andar" com o mês).
// Texto vazio num filtro de padrão preenchido vira "_" na URL, para não ser confundido com "usar o padrão".
// shortcut: valores só aceitam [\w.:-] (ver hash.ts); texto livre com espaço/acento fica fora, relaxar quando uma tela precisar.
const VAZIO = '_'

export function useFiltrosUrl<T extends Record<string, string>>(
  aba: string, padrao: T, opcoes: { fixos?: (keyof T)[]; normalizar?: (f: T) => T } = {},
) {
  const { sincronizarUrl, versaoNavegacao } = useNavegacao()
  const ref = useRef({ padrao, ...opcoes })
  const lerDaUrl = (): T => {
    const { padrao: base, normalizar } = ref.current
    const { aba: abaUrl, parametros } = lerHash(window.location.hash, '')
    const lido: Record<string, string> = { ...base }
    if (abaUrl === aba) for (const k of Object.keys(base)) if (k in parametros) lido[k] = parametros[k] === VAZIO ? '' : parametros[k]
    return normalizar ? normalizar(lido as T) : (lido as T)
  }
  const [filtros, setFiltros] = useState<T>(lerDaUrl)

  useEffect(() => {
    const { padrao: base, fixos = [] } = ref.current
    const params: Record<string, string | undefined> = {}
    for (const k of Object.keys(base)) {
      const v = filtros[k]
      if (v !== base[k] || fixos.includes(k)) params[k] = v === '' ? VAZIO : v
    }
    sincronizarUrl(aba, params)
  }, [aba, filtros, sincronizarUrl])

  // Voltar/avançar ou clicar no menu relê a URL (versaoNavegacao muda só por navegação externa).
  const versaoLida = useRef(versaoNavegacao)
  useEffect(() => {
    if (versaoLida.current === versaoNavegacao) return
    versaoLida.current = versaoNavegacao
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiltros(lerDaUrl())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoNavegacao])

  return [filtros, setFiltros] as const
}
