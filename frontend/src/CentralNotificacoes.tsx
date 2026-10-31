import Carregamento from './Carregamento'
import { usePainelShell } from './usePainelShell'
import { useState } from 'react'
import { Button, Checkbox, HeaderGlobalAction, InlineNotification } from '@carbon/react'
import { Notification } from '@carbon/icons-react'
import { useCliente } from './api/ClienteContext'
import { useNavegacao } from './api/NavegacaoContext'
import type { ClienteMCP } from './api/mcpClient'
import { useNotificacoes, type Notificacao } from './useNotificacoes'

export default function CentralNotificacoes() {
  const { cliente } = useCliente()
  // A troca de credencial desmonta o feed anterior antes de exibir a nova sessão.
  return <PainelNotificacoes key={cliente?.token ?? 'sem-sessao'} cliente={cliente} />
}

function PainelNotificacoes({ cliente }: { cliente: ClienteMCP | null }) {
  const { irPara } = useNavegacao()
  const [aberta, setAberta] = useState(false)
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false)
  const raiz = usePainelShell(aberta, () => setAberta(false))
  const { itens, naoLidas, cursor, carregando, carregou, erro, acaoPendente, carregar, marcarLida, buscarDestino } = useNotificacoes(cliente, aberta, somenteNaoLidas)
  const ocupado = carregando || acaoPendente !== null
  const rotulo = !cliente ? 'Conecte-se para consultar notificações' : naoLidas === null ? 'Contagem indisponível' : `${naoLidas} não lidas`

  async function abrirDestino(item: Notificacao) {
    const destino = await buscarDestino(item)
    if (!destino) return
    setAberta(false)
    if (destino.tipo === 'publicacoes_monitoradas') irPara('publicacoes-oab')
    else irPara('casos', {
      id: destino.caso_id,
      aba: destino.tipo === 'atividade' ? 'atividades' : 'publicacoes',
      atividadeId: destino.tipo === 'atividade' ? destino.atividade_id : undefined,
    })
  }

  return (
    <div ref={raiz} className="shell-action">
      <HeaderGlobalAction aria-label={`Notificações: ${rotulo}`} aria-controls="painel-notificacoes" aria-expanded={aberta} isActive={aberta} onClick={() => setAberta(atual => !atual)}>
        <span className="aj-layout-2">
          <Notification size={20} />
          {!!naoLidas && <span className="aj-layout-3" aria-hidden="true">{naoLidas > 99 ? '99+' : naoLidas}</span>}
        </span>
      </HeaderGlobalAction>
      {aberta && (
        <div id="painel-notificacoes" className="shell-panel notificacoes-painel" role="region" aria-labelledby="notificacoes-titulo">
          <div className="aj-layout-4">
            <h2 id="notificacoes-titulo">Notificações</h2>
            <Button kind="ghost" size="sm" onClick={() => carregar()} disabled={!cliente || ocupado}>Atualizar</Button>
          </div>
          <p className="notificacoes-contagem" role="status">{rotulo}</p>
          {!cliente ? <p>Conecte-se na aba Acesso para consultar suas notificações.</p> : <>
            <Checkbox id="notificacoes-filtro" labelText="Mostrar só não lidas" checked={somenteNaoLidas} disabled={acaoPendente !== null} onChange={(_e, { checked }) => setSomenteNaoLidas(checked)} />
            {erro && <div className="notificacoes-erro">
              <InlineNotification kind="error" title="Não foi possível concluir" subtitle={erro} lowContrast hideCloseButton />
              <Button kind="ghost" size="sm" disabled={ocupado} onClick={() => carregar()}>Tentar novamente</Button>
            </div>}
            {carregando && <Carregamento tipo="texto" descricao="Carregando notificações…" />}
            <div aria-busy={carregando}>
              {!erro && !carregando && carregou && itens.length === 0 && <div className="notificacoes-vazio" role="status">
                <p>{somenteNaoLidas ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação nos últimos 180 dias.'}</p>
                {somenteNaoLidas && <Button kind="ghost" size="sm" onClick={() => setSomenteNaoLidas(false)}>Mostrar todas</Button>}
              </div>}
              <ul className="aj-layout-8">
                {itens.map(item => (
                  <li key={item.id} className="notificacoes-item">
                    <h3>{item.titulo}</h3>
                    <p className="notificacoes-mensagem">{item.mensagem}</p>
                    <p className="notificacoes-data"><time dateTime={item.criado_em}>{new Date(item.criado_em).toLocaleString('pt-BR')}</time> · {item.lida_em ? 'Lida' : 'Não lida'}</p>
                    <div className="notificacoes-acoes" aria-busy={acaoPendente === item.id}>
                      <Button kind="ghost" size="sm" disabled={ocupado} onClick={() => abrirDestino(item)}>{item.destino.tipo === 'atividade' ? 'Abrir atividade' : 'Abrir publicações'}</Button>
                      {!item.lida_em && <Button kind="ghost" size="sm" disabled={ocupado} onClick={() => marcarLida(item)}>Marcar como lida</Button>}
                    </div>
                  </li>
                ))}
              </ul>
              {cursor && <Button kind="ghost" size="sm" onClick={() => carregar(true)} disabled={ocupado}>Carregar mais</Button>}
            </div>
            <p className="notificacoes-retencao">Notificações dos últimos 180 dias</p>
          </>}
        </div>
      )}
    </div>
  )
}
