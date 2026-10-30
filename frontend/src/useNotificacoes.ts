import { useCallback, useEffect, useRef, useState } from 'react'
import { ErroMCP, type ClienteMCP } from './api/mcpClient'
import { buscarJson, enviarJson } from './api/rest'

export type DestinoNotificacao =
  | { tipo: 'atividade'; caso_id: string; atividade_id: string | number }
  | { tipo: 'publicacoes_processo'; caso_id: string }
  | { tipo: 'publicacoes_monitoradas' }

export type Notificacao = {
  id: string
  titulo: string
  mensagem: string
  criado_em: string
  lida_em: string | null
  destino: DestinoNotificacao
}

type Feed = { notificacoes: Notificacao[]; proximo_cursor: string | null; nao_lidas: number }

export function useNotificacoes(cliente: ClienteMCP | null, aberta: boolean, somenteNaoLidas: boolean) {
  const [itens, setItens] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [carregou, setCarregou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [acaoPendente, setAcaoPendente] = useState<string | null>(null)
  const vida = useRef<AbortController | null>(null)
  const consulta = useRef<AbortController | null>(null)
  const contagem = useRef<AbortController | null>(null)
  const versaoContagem = useRef(0)
  const emAcao = useRef(false)
  const consultando = useRef(false)
  const proximoCursor = useRef<string | null>(null)

  const atualizarContagem = useCallback(async () => {
    const sinal = vida.current?.signal
    if (!cliente || !sinal || sinal.aborted || consultando.current || emAcao.current) return
    contagem.current?.abort()
    const controlador = new AbortController()
    contagem.current = controlador
    const versao = ++versaoContagem.current
    try {
      const dados = await buscarJson<Feed>(cliente, '/notificacoes?limite=1&estado=nao_lidas', controlador.signal)
      if (!sinal.aborted && !controlador.signal.aborted && versao === versaoContagem.current) setNaoLidas(dados.nao_lidas)
    } catch {
      if (!sinal.aborted && !controlador.signal.aborted && versao === versaoContagem.current) setNaoLidas(null)
    }
  }, [cliente])

  const carregar = useCallback(async (anexar = false) => {
    const sinal = vida.current?.signal
    if (!cliente || !sinal || sinal.aborted || emAcao.current) return
    if (anexar && (!proximoCursor.current || consultando.current)) return
    consulta.current?.abort()
    const controlador = new AbortController()
    consulta.current = controlador
    ++versaoContagem.current
    consultando.current = true
    setCarregando(true)
    setErro(null)
    if (!anexar) {
      proximoCursor.current = null
      setCursor(null)
      setItens([])
      setCarregou(false)
    }
    try {
      const query = new URLSearchParams({ limite: '20', estado: somenteNaoLidas ? 'nao_lidas' : 'todas' })
      if (anexar) query.set('cursor', proximoCursor.current!)
      const dados = await buscarJson<Feed>(cliente, `/notificacoes?${query}`, controlador.signal)
      if (sinal.aborted || controlador.signal.aborted) return
      setItens(atual => anexar ? [...new Map([...atual, ...dados.notificacoes].map(item => [item.id, item])).values()] : dados.notificacoes)
      proximoCursor.current = dados.proximo_cursor
      setCursor(dados.proximo_cursor)
      setNaoLidas(dados.nao_lidas)
      setCarregou(true)
    } catch (e) {
      if (sinal.aborted || controlador.signal.aborted) return
      setNaoLidas(null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar notificações. Tente novamente.')
    } finally {
      if (!sinal.aborted && !controlador.signal.aborted) {
        consultando.current = false
        setCarregando(false)
      }
    }
  }, [cliente, somenteNaoLidas])

  useEffect(() => {
    const controlador = new AbortController()
    vida.current = controlador
    atualizarContagem()
    const aoRetornar = () => {
      if (document.visibilityState === 'visible') atualizarContagem()
    }
    const intervalo = window.setInterval(aoRetornar, 60_000)
    document.addEventListener('visibilitychange', aoRetornar)
    window.addEventListener('focus', aoRetornar)
    return () => {
      controlador.abort()
      consulta.current?.abort()
      contagem.current?.abort()
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', aoRetornar)
      window.removeEventListener('focus', aoRetornar)
    }
  }, [atualizarContagem])

  useEffect(() => {
    if (aberta) carregar()
    return () => {
      consulta.current?.abort()
      consultando.current = false
    }
  }, [aberta, carregar])

  async function executarAcao<T>(id: string, acao: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const sinal = vida.current?.signal
    if (!cliente || !sinal || sinal.aborted || emAcao.current || consultando.current) return
    emAcao.current = true
    ++versaoContagem.current
    setAcaoPendente(id)
    setErro(null)
    try {
      const resultado = await acao(sinal)
      if (!sinal.aborted) return resultado
    } catch (e) {
      if (sinal.aborted) return
      if (e instanceof ErroMCP && (e.status === 404 || e.status === 403)) {
        emAcao.current = false
        await carregar()
      }
      if (!sinal.aborted) setErro(e instanceof ErroMCP ? e.message : 'Não foi possível concluir. Tente novamente.')
    } finally {
      if (!sinal.aborted) {
        emAcao.current = false
        setAcaoPendente(null)
      }
    }
  }

  async function marcarLida(item: Notificacao) {
    if (item.lida_em) return
    const resultado = await executarAcao(item.id, sinal => enviarJson<{ lida_em: string }>(
      cliente, `/notificacoes/${encodeURIComponent(item.id)}`, { lida: true }, 'PATCH', sinal,
    ))
    if (!resultado) return
    setItens(atual => somenteNaoLidas ? atual.filter(n => n.id !== item.id) : atual.map(n => n.id === item.id ? { ...n, lida_em: resultado.lida_em } : n))
    await atualizarContagem()
  }

  async function buscarDestino(item: Notificacao) {
    return executarAcao(item.id, async sinal => {
      const dados = await buscarJson<{ destino: DestinoNotificacao }>(cliente, `/notificacoes/${encodeURIComponent(item.id)}/destino`, sinal)
      const destino = dados.destino
      if (!destino || !['atividade', 'publicacoes_processo', 'publicacoes_monitoradas'].includes(destino.tipo)
        || (destino.tipo !== 'publicacoes_monitoradas' && !destino.caso_id)
        || (destino.tipo === 'atividade' && destino.atividade_id == null)) {
        throw new ErroMCP(404, 'Destino indisponível. Atualize a lista.')
      }
      return destino
    })
  }

  return { itens, naoLidas, cursor, carregando, carregou, erro, acaoPendente, carregar, marcarLida, buscarDestino }
}
