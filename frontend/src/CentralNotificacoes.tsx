import Carregamento from './Carregamento'
import { useState } from 'react'
import { Badge, Button, Callout, Checkbox, Flex, Heading, IconButton, Popover, Text } from '@radix-ui/themes'
import { AlertTriangle, Bell } from 'lucide-react'
import BadgeMui from '@mui/material/Badge'
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
  const { itens, naoLidas, cursor, carregando, carregou, erro, acaoPendente, carregar, marcarLida, confirmarCiencia, buscarDestino } = useNotificacoes(cliente, aberta, somenteNaoLidas)
  const ocupado = carregando || acaoPendente !== null
  const naoLidasVisiveis = itens.filter(n => !n.lida_em)
  async function marcarTodas() {
    for (const n of naoLidasVisiveis) await marcarLida(n)
  }
  const rotulo = !cliente ? 'Conecte-se para consultar notificações' : naoLidas === null ? 'Contagem indisponível' : `${naoLidas} não lidas`

  async function abrirDestino(item: Notificacao) {
    const destino = await buscarDestino(item)
    if (!destino) return
    // Abrir a notificação já conta como lida.
    if (!item.lida_em) void marcarLida(item)
    setAberta(false)
    if (destino.tipo === 'publicacoes_monitoradas') irPara('publicacoes-oab')
    else irPara('casos', {
      id: destino.caso_id,
      aba: destino.tipo === 'atividade' ? 'atividades' : destino.tipo === 'movimentos_processo' ? 'movimentacoes' : 'publicacoes',
      atividadeId: destino.tipo === 'atividade' ? destino.atividade_id : undefined,
    })
  }

  return (
    <Popover.Root open={aberta} onOpenChange={setAberta}>
      <Popover.Trigger>
        <IconButton className="aj-ib" variant="ghost" aria-label={`Notificações: ${rotulo}`}>
          <BadgeMui badgeContent={naoLidas ?? 0} max={99} color="error" overlap="circular" aria-hidden="true">
            <Bell size={17} />
          </BadgeMui>
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="380px" align="end">
        <Flex direction="column" gap="3" role="region" aria-label="Notificações">
          <Flex align="center" justify="between">
            <Heading size="3">Notificações</Heading>
            <Flex gap="3">
              {naoLidasVisiveis.length > 1 && <Button variant="ghost" size="1" onClick={() => void marcarTodas()} disabled={ocupado}>Marcar todas como lidas</Button>}
              <Button variant="ghost" size="1" onClick={() => carregar()} disabled={!cliente || ocupado}>Atualizar</Button>
            </Flex>
          </Flex>
          <Text size="2" color="gray" role="status">{rotulo}</Text>
          {!cliente ? <Text size="2">Conecte-se na aba Acesso para consultar suas notificações.</Text> : <>
            <Text as="label" size="2">
              <Flex gap="2" align="center">
                <Checkbox checked={somenteNaoLidas} disabled={acaoPendente !== null} onCheckedChange={(v) => setSomenteNaoLidas(v === true)} />
                Mostrar só não lidas
              </Flex>
            </Text>
            {erro && (
              <Flex direction="column" gap="2">
                <Callout.Root color="red" size="1">
                  <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                  <Callout.Text>{erro}</Callout.Text>
                </Callout.Root>
                <Button variant="ghost" size="1" disabled={ocupado} onClick={() => carregar()} style={{ alignSelf: 'flex-start' }}>Tentar novamente</Button>
              </Flex>
            )}
            {carregando && <Carregamento tipo="texto" descricao="Carregando notificações…" />}
            <Flex direction="column" gap="3" aria-busy={carregando}>
              {!erro && !carregando && carregou && itens.length === 0 && (
                <Flex direction="column" gap="2" role="status">
                  <Text size="2" color="gray">{somenteNaoLidas ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação nos últimos 180 dias.'}</Text>
                  {somenteNaoLidas && <Button variant="ghost" size="1" onClick={() => setSomenteNaoLidas(false)} style={{ alignSelf: 'flex-start' }}>Mostrar todas</Button>}
                </Flex>
              )}
              <Flex direction="column" gap="3" asChild>
                <ul className="aj-notif-lista">
                  {itens.map(item => (
                    <li key={item.id} className={item.lida_em ? 'aj-notif-lida' : 'aj-notif-nao-lida'}>
                      <Flex direction="column" gap="1" aria-busy={acaoPendente === item.id}>
                        <Text weight={item.lida_em ? 'regular' : 'bold'} size="2">{!item.lida_em && <span className="aj-notif-ponto" aria-hidden="true" />}{item.titulo}</Text>
                        <Text size="2" color="gray">{item.mensagem}</Text>
                        <Text size="1" color="gray">
                          <time dateTime={item.criado_em}>{new Date(item.criado_em).toLocaleString('pt-BR')}</time> · {item.lida_em ? 'Lida' : 'Não lida'}
                        </Text>
                        <Flex gap="2">
                          <Button variant="ghost" size="1" disabled={ocupado} onClick={() => abrirDestino(item)}>{item.destino.tipo === 'atividade' ? 'Abrir atividade' : item.destino.tipo === 'movimentos_processo' ? 'Abrir movimentações' : 'Abrir publicações'}</Button>
                          {!item.lida_em && <Button variant="ghost" size="1" disabled={ocupado} onClick={() => marcarLida(item)}>Marcar como lida</Button>}
                        </Flex>
                        {item.exige_ciencia && (item.ciente
                          ? <Badge color="green" variant="soft" style={{ alignSelf: 'flex-start' }}>Ciente</Badge>
                          : <Button size="1" variant="soft" color="amber" disabled={ocupado} onClick={() => confirmarCiencia(item)} style={{ alignSelf: 'flex-start' }}>Confirmar ciência</Button>)}
                      </Flex>
                    </li>
                  ))}
                </ul>
              </Flex>
              {cursor && <Button variant="ghost" size="1" onClick={() => carregar(true)} disabled={ocupado} style={{ alignSelf: 'flex-start' }}>Carregar mais</Button>}
            </Flex>
            <Text size="1" color="gray">Notificações dos últimos 180 dias</Text>
          </>}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  )
}
