import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, HeaderGlobalAction } from '@carbon/react'
import { Notification } from '@carbon/icons-react'
import { useCliente } from './api/ClienteContext'
import { useNavegacao } from './api/NavegacaoContext'
import { buscarJson, enviarJson } from './api/rest'
import { ErroMCP } from './api/mcpClient'

type Destino =
  | { tipo: 'atividade'; caso_id: string; atividade_id: string }
  | { tipo: 'publicacoes_processo'; caso_id: string }
  | { tipo: 'publicacoes_monitoradas' }

type Notificacao = {
  id: string
  titulo: string
  mensagem: string
  criado_em: string
  lida_em: string | null
  destino: Destino
}

export default function CentralNotificacoes() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [aberta, setAberta] = useState(false)
  const [itens, setItens] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  const carregar = useCallback(
    async (anexar = false) => {
      if (!cliente) return
      setCarregando(true)
      setErro(null)
      try {
        const query = new URLSearchParams({ limite: '20', estado: somenteNaoLidas ? 'nao_lidas' : 'todas' })
        if (anexar && cursor) query.set('cursor', cursor)
        const dados = await buscarJson<{ notificacoes: Notificacao[]; proximo_cursor: string | null; nao_lidas: number }>(
          cliente,
          `/notificacoes?${query}`,
        )
        setItens((atual) => (anexar ? [...atual, ...dados.notificacoes] : dados.notificacoes))
        setCursor(dados.proximo_cursor)
        setNaoLidas(dados.nao_lidas)
      } catch (e) {
        setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar notificações.')
      } finally {
        setCarregando(false)
      }
    },
    [cliente, cursor, somenteNaoLidas],
  )

  useEffect(() => {
    if (!cliente) return
    buscarJson<{ nao_lidas: number }>(cliente, '/notificacoes?limite=1&estado=nao_lidas')
      .then((d) => setNaoLidas(d.nao_lidas))
      .catch(() => {})
  }, [cliente])

  useEffect(() => {
    function aoClicarFora(ev: MouseEvent) {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberta(false)
    }
    document.addEventListener('click', aoClicarFora)
    return () => document.removeEventListener('click', aoClicarFora)
  }, [])

  function abrir() {
    const abrindo = !aberta
    setAberta(abrindo)
    if (abrindo) carregar(false)
  }

  async function marcarLida(item: Notificacao) {
    if (!cliente) return
    try {
      await enviarJson(cliente, `/notificacoes/${item.id}`, { lida: true }, 'PATCH')
      setItens((atual) => atual.map((n) => (n.id === item.id ? { ...n, lida_em: new Date().toISOString() } : n)))
      setNaoLidas((atual) => (atual !== null ? Math.max(0, atual - 1) : atual))
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao marcar como lida.')
    }
  }

  function abrirDestino(item: Notificacao) {
    setAberta(false)
    const destino = item.destino
    if (destino.tipo === 'publicacoes_monitoradas') irPara('publicacoes-oab')
    else irPara('casos', { id: destino.caso_id })
    if (!item.lida_em) marcarLida(item)
  }

  return (
    <div ref={raiz} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <HeaderGlobalAction aria-label={`Notificações${naoLidas ? `: ${naoLidas} não lidas` : ''}`} aria-expanded={aberta} onClick={abrir}>
        <span style={{ position: 'relative' }}>
          <Notification size={20} />
          {!!naoLidas && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: '1rem',
                height: '1rem',
                padding: '0 0.25rem',
                borderRadius: '1rem',
                background: 'var(--cds-support-error, #da1e28)',
                color: '#fff',
                fontSize: '0.625rem',
                lineHeight: '1rem',
                textAlign: 'center',
              }}
            >
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </span>
      </HeaderGlobalAction>
      {aberta && (
        <div
          style={{
            position: 'absolute',
            insetInlineEnd: 0,
            top: '100%',
            inlineSize: 'min(26rem, calc(100vw - 2rem))',
            maxBlockSize: 'calc(100dvh - 4rem)',
            overflowY: 'auto',
            background: 'var(--cds-layer, #f4f4f4)',
            boxShadow: '0 4px 8px rgba(0,0,0,.15)',
            padding: '1rem',
            zIndex: 8100,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 600 }}>Notificações</h2>
            <Button kind="ghost" size="sm" onClick={() => carregar(false)} disabled={carregando}>
              Atualizar
            </Button>
          </div>
          <Checkbox
            id="notificacoes-filtro"
            labelText="Mostrar só não lidas"
            checked={somenteNaoLidas}
            onChange={(_e, { checked }) => {
              setSomenteNaoLidas(checked)
              setCursor(null)
            }}
          />
          <div style={{ marginTop: '0.75rem' }}>
            {erro && <p style={{ color: 'var(--cds-support-error, #da1e28)' }}>{erro}</p>}
            {!erro && !carregando && itens.length === 0 && <p>Nenhuma notificação nos últimos 180 dias.</p>}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {itens.map((item) => (
                <li key={item.id} style={{ borderBottom: '1px solid var(--cds-border-subtle, #e0e0e0)', padding: '0.75rem 0' }}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600 }}>{item.titulo}</h3>
                  <p style={{ margin: '0.25rem 0' }}>{item.mensagem}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--cds-text-secondary, #525252)' }}>
                    {new Date(item.criado_em).toLocaleString('pt-BR')} · {item.lida_em ? 'Lida' : 'Não lida'}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <Button kind="ghost" size="sm" onClick={() => abrirDestino(item)}>
                      Abrir
                    </Button>
                    {!item.lida_em && (
                      <Button kind="ghost" size="sm" onClick={() => marcarLida(item)}>
                        Marcar como lida
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {cursor && (
              <Button kind="ghost" size="sm" onClick={() => carregar(true)} disabled={carregando}>
                Carregar mais
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
