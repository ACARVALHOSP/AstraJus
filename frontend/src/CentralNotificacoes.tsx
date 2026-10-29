import { usePainelShell } from './usePainelShell'
import { useCallback, useEffect, useState } from 'react'
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
  const raiz = usePainelShell(aberta, () => setAberta(false))

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
    <div ref={raiz} className="shell-action">
      <HeaderGlobalAction aria-label={`Notificações${naoLidas ? `: ${naoLidas} não lidas` : ''}`} aria-expanded={aberta} onClick={abrir}>
        <span className="aj-layout-2">
          <Notification size={20} />
          {!!naoLidas && (
            <span
              className="aj-layout-3"
            >
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </span>
      </HeaderGlobalAction>
      {aberta && (
        <div className="shell-panel" role="region" aria-label="Notificações">
          <div className="aj-layout-4">
            <h2 className="aj-layout-5">Notificações</h2>
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
          <div className="aj-layout-6">
            {erro && <p className="aj-layout-7">{erro}</p>}
            {!erro && !carregando && itens.length === 0 && <p>Nenhuma notificação nos últimos 180 dias.</p>}
            <ul className="aj-layout-8">
              {itens.map((item) => (
                <li key={item.id} className="aj-layout-9">
                  <h3 className="aj-layout-10">{item.titulo}</h3>
                  <p className="aj-layout-11">{item.mensagem}</p>
                  <p className="aj-layout-12">
                    {new Date(item.criado_em).toLocaleString('pt-BR')} · {item.lida_em ? 'Lida' : 'Não lida'}
                  </p>
                  <div className="aj-layout-13">
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
