import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { confirmarSaida, temAlteracoesPendentes } from '../AlteracoesPendentes'
import { chaveHash, lerHash, montarHash } from './hash'

type NavegacaoContextValor = {
  abaAtiva: string
  versaoNavegacao: number
  irPara: (abaId: string, payload?: unknown) => void
  consumirPayload: <T>(abaId: string) => T | undefined
  /** Grava na URL o estado da tela aberta (processo, aba, filtros) sem recarregar; `empilhar` cria um passo no histórico. */
  sincronizarUrl: (abaId: string, params: Record<string, unknown>, empilhar?: boolean) => void
}

const NavegacaoContext = createContext<NavegacaoContextValor | null>(null)

// O endereço guarda a tela e seus parâmetros ("#/casos?id=1&aba=atividades"): o link abre direto
// no lugar certo e voltar/avançar do navegador funcionam. Os parâmetros viram "payload" da tela,
// o mesmo caminho que irPara(aba, payload) já usava.
export function NavegacaoProvider({ children, abaInicial }: { children: ReactNode; abaInicial: string }) {
  const [abaAtiva, setAbaAtiva] = useState(() => lerHash(window.location.hash, abaInicial).aba)
  const [versaoNavegacao, setVersaoNavegacao] = useState(0)
  const [payloads] = useState(() => {
    const mapa = new Map<string, unknown>()
    const { aba, parametros } = lerHash(window.location.hash, abaInicial)
    if (Object.keys(parametros).length) mapa.set(aba, parametros)
    return mapa
  })

  const abaAtual = useRef(abaAtiva)
  // Hash da tela que está aberta (com parâmetros): distingue o que o próprio sistema acabou de
  // gravar na URL do que veio de fora (link colado, voltar/avançar).
  const hashAtual = useRef(chaveHash(window.location.hash))
  const restaurando = useRef(false)

  // Link sem tela ("/") passa a mostrar o endereço da tela inicial.
  useEffect(() => {
    if (!chaveHash(window.location.hash)) window.history.replaceState(null, '', `#/${abaInicial}`)
  }, [abaInicial])

  const sincronizarUrl = useCallback((abaId: string, params: Record<string, unknown>, empilhar = false) => {
    if (abaAtual.current !== abaId) return
    const novoHash = montarHash(abaId, params)
    if (chaveHash(novoHash) === hashAtual.current) return
    hashAtual.current = chaveHash(novoHash)
    // pushState/replaceState não disparam "hashchange": a tela já está no estado novo.
    window.history[empilhar ? 'pushState' : 'replaceState'](null, '', `#${novoHash}`)
  }, [])

  useEffect(() => {
    function aoMudarHash() {
      if (restaurando.current) { restaurando.current = false; return }
      const recebido = chaveHash(window.location.hash)
      if (recebido === hashAtual.current) return
      const { aba: destino, parametros } = lerHash(window.location.hash, abaInicial)
      if (temAlteracoesPendentes()) {
        // Voltar do navegador ou link com alterações não salvas: desfaz a troca e pergunta.
        restaurando.current = true
        window.location.hash = `/${hashAtual.current}`
        confirmarSaida(() => { window.location.hash = `/${recebido}` })
        return
      }
      hashAtual.current = recebido
      const temParametros = Object.keys(parametros).length > 0
      if (temParametros) payloads.set(destino, parametros)
      else payloads.delete(destino)
      abaAtual.current = destino
      setAbaAtiva(destino)
      // Telas já abertas (Processos, Financeiro…) releem o payload quando esta versão muda;
      // sem parâmetros (voltar para a lista) elas voltam ao estado inicial.
      setVersaoNavegacao(atual => atual + 1)
    }
    window.addEventListener('hashchange', aoMudarHash)
    return () => window.removeEventListener('hashchange', aoMudarHash)
  }, [abaInicial, payloads])

  const valor = useMemo<NavegacaoContextValor>(
    () => ({
      abaAtiva,
      versaoNavegacao,
      irPara: (abaId, payload) => confirmarSaida(() => {
        if (payload !== undefined) payloads.set(abaId, payload)
        const novoHash = montarHash(abaId, payload)
        setAbaAtiva(abaId)
        abaAtual.current = abaId
        hashAtual.current = chaveHash(novoHash)
        setVersaoNavegacao(atual => atual + 1)
        if (chaveHash(window.location.hash) !== hashAtual.current) window.location.hash = novoHash
      }),
      consumirPayload: <T,>(abaId: string) => {
        const valor = payloads.get(abaId) as T | undefined
        payloads.delete(abaId)
        return valor
      },
      sincronizarUrl,
    }),
    [abaAtiva, versaoNavegacao, payloads, sincronizarUrl],
  )

  return <NavegacaoContext.Provider value={valor}>{children}</NavegacaoContext.Provider>
}

export function useNavegacao() {
  const contexto = useContext(NavegacaoContext)
  if (!contexto) throw new Error('useNavegacao precisa estar dentro de <NavegacaoProvider>')
  return contexto
}
