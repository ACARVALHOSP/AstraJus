import CabecalhoPagina from '../CabecalhoPagina'
import { useAvisos } from '../Avisos'
import TabelaResponsiva from '../TabelaResponsiva'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import { useEffect, useState } from 'react'
import { Info, Star } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Flex, IconButton, Select, Tabs, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { useCasos, useClientes } from '../api/consultas'
import type { PayloadProcesso } from './Processo'
import type { PayloadPublicacoes } from './Publicacoes'
import type { Caso } from './casos/ListaCasos'
import { ROTULO_TIPO } from './atividades/dados'
import {
  alternarCasoFavorito,
  EVENTO_PREFERENCIAS,
  alternarFavorito,
  ehFavorito,
  lerCasosFavoritos,
  lerFavoritos,
  lerHistorico,
  limparHistorico,
  removerFavorito,
  removerHistorico,
  type Favorito,
  type ItemHistorico,
} from '../utils/listasRapidas'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import './casos/lista-casos.scss'
import './historico/historico.scss'

type Cliente = { id: string; nome?: string }
type Aba = 'processos' | 'consultas' | 'historico'
type TipoFiltro = '' | 'processo' | 'publicacoes'

const SEM_CASOS: Caso[] = []
const SEM_CLIENTES: Cliente[] = []
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function diasEntre(deIso: string, ateIso: string) {
  const [a, b] = [deIso, ateIso].map(v => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / 86_400_000)
}
function dataCurta(iso?: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
function haQuanto(iso: string, hoje: string) {
  const dias = diasEntre(iso.slice(0, 10), hoje)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}

/** Título e detalhe de uma consulta do histórico. */
function descreverConsulta(item: ItemHistorico) {
  const a = item.args as Record<string, string | undefined>
  if (item.tipo === 'processo') {
    return { titulo: formatarNumeroCNJ(a.numero_processo ?? ''), detalhe: `${(a.tribunal ?? '?').toUpperCase()} · DataJud` }
  }
  const titulo = a.numero_processo ? formatarNumeroCNJ(a.numero_processo) : `OAB ${a.numero_oab ?? '?'}/${a.uf_oab ?? '?'}`
  const partes = ['DJEN']
  if (a.sigla_tribunal) partes.push(a.sigla_tribunal)
  if (a.data_disponibilizacao_inicio || a.data_disponibilizacao_fim) {
    partes.push(`${dataCurta(a.data_disponibilizacao_inicio)} a ${dataCurta(a.data_disponibilizacao_fim)}`)
  }
  return { titulo, detalhe: partes.join(' · ') }
}

export default function Historico() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const { avisar } = useAvisos()
  const estreita = useEstreita()
  const [hoje] = useState(() => isoLocal(new Date()))
  const [aba, setAba] = useState<Aba>('processos')
  const [busca, setBusca] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('')
  const [favoritos, setFavoritos] = useState<Favorito[]>(() => lerFavoritos())
  const [historico, setHistorico] = useState<ItemHistorico[]>(() => lerHistorico())
  const [idsFavoritos, setIdsFavoritos] = useState<string[]>(() => lerCasosFavoritos())
  const [confirmarApagar, setConfirmarApagar] = useState(false)

  // Favoritos e histórico chegam do servidor logo depois de conectar: relê a cópia local.
  useEffect(() => {
    const reler = () => { setFavoritos(lerFavoritos()); setHistorico(lerHistorico()); setIdsFavoritos(lerCasosFavoritos()) }
    window.addEventListener(EVENTO_PREFERENCIAS, reler)
    return () => window.removeEventListener(EVENTO_PREFERENCIAS, reler)
  }, [])

  // Só busca quando há favoritos; falha em clientes só tira o nome do cliente das linhas.
  const buscar = idsFavoritos.length > 0 && Boolean(cliente)
  const consultaCasos = useCasos<Caso>({ enabled: buscar })
  const consultaClientes = useClientes<Cliente>({ enabled: buscar })
  const casos = consultaCasos.data ?? SEM_CASOS
  const clientes = consultaClientes.data ?? SEM_CLIENTES
  const carregando = consultaCasos.isLoading || (buscar && consultaClientes.isLoading)

  const nomeCliente = (id?: string) => formatarNomeExibicao(clientes.find(c => c.id === id)?.nome ?? '')
  const termo = normalizar(busca.trim())

  const casosFavoritos = idsFavoritos
    .map(id => casos.find(c => c.id === id))
    .filter((c): c is Caso => Boolean(c))
  const casosVisiveis = casosFavoritos.filter(c => !termo || normalizar(
    [c.titulo, c.foro, nomeCliente(c.cliente_id), ...(c.processos ?? []), ...(c.processos ?? []).map(formatarNumeroCNJ)].join(' '),
  ).includes(termo))
  const favoritosVisiveis = favoritos.filter(f => !termo || normalizar(`${f.tribunal} ${f.numero} ${formatarNumeroCNJ(f.numero)}`).includes(termo))
  const historicoVisivel = historico.filter(h => (!tipoFiltro || h.tipo === tipoFiltro) && (!termo || normalizar(
    `${h.resumo} ${descreverConsulta(h).titulo} ${descreverConsulta(h).detalhe}`,
  ).includes(termo)))

  const grupos = (() => {
    const ordem = ['Hoje', 'Ontem', 'Esta semana', 'Mais antigas']
    const mapa = new Map<string, ItemHistorico[]>()
    for (const item of historicoVisivel) {
      const dias = diasEntre(isoLocal(new Date(item.quando)), hoje)
      const grupo = dias <= 0 ? 'Hoje' : dias === 1 ? 'Ontem' : dias < 7 ? 'Esta semana' : 'Mais antigas'
      mapa.set(grupo, [...(mapa.get(grupo) ?? []), item])
    }
    return ordem.filter(g => mapa.has(g)).map(g => ({ titulo: g, itens: mapa.get(g)! }))
  })()

  function horario(item: ItemHistorico) {
    const d = new Date(item.quando)
    if (Number.isNaN(d.getTime())) return '—'
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const dias = diasEntre(isoLocal(d), hoje)
    if (dias <= 1) return hora
    if (dias < 7) return `${DIAS_SEMANA[d.getDay()]} ${hora}`
    return `${dataCurta(isoLocal(d)).slice(0, 5)} ${hora}`
  }

  function tirarCasoDosFavoritos(id: string) {
    alternarCasoFavorito(id)
    setIdsFavoritos(lerCasosFavoritos())
    const titulo = formatarNomeExibicao(casos.find(c => c.id === id)?.titulo) || 'Processo'
    avisar({
      texto: `${titulo} saiu dos favoritos.`,
      desfazer: () => { if (!lerCasosFavoritos().includes(id)) alternarCasoFavorito(id); setIdsFavoritos(lerCasosFavoritos()) },
    })
  }
  function tirarConsultaDosFavoritos(fav: Favorito) {
    removerFavorito(fav.tribunal, fav.numero)
    setFavoritos(lerFavoritos())
    avisar({
      texto: `${formatarNumeroCNJ(fav.numero)} saiu das consultas favoritas.`,
      desfazer: () => { if (!ehFavorito(fav.tribunal, fav.numero)) alternarFavorito(fav.tribunal, fav.numero); setFavoritos(lerFavoritos()) },
    })
  }
  function consultar(fav: Favorito) {
    const payload: PayloadProcesso = { tribunal: fav.tribunal, numero_processo: fav.numero }
    irPara('processo', payload)
  }
  function repetir(item: ItemHistorico) {
    if (item.tipo === 'processo') irPara('processo', item.args as PayloadProcesso)
    else irPara('publicacoes', item.args as PayloadPublicacoes)
  }
  function favoritarConsulta(item: ItemHistorico) {
    const a = item.args as Record<string, string>
    alternarFavorito(a.tribunal, a.numero_processo)
    setFavoritos(lerFavoritos())
    avisar({ texto: `${formatarNumeroCNJ(a.numero_processo)} adicionado às consultas favoritas.` })
  }
  function tirarDoHistorico(item: ItemHistorico) {
    removerHistorico(item.quando)
    setHistorico(lerHistorico())
  }

  function estrela(c: Caso) {
    return (
      <IconButton variant="ghost" size="1" color="amber" aria-pressed aria-label={`Remover ${c.titulo || 'processo'} dos favoritos`} onClick={() => tirarCasoDosFavoritos(c.id)}>
        <Star size={16} fill="currentColor" />
      </IconButton>
    )
  }
  function compromisso(c: Caso) {
    const p = c.proximo_compromisso
    if (!p) return <Text size="1" color="gray">Nenhum compromisso</Text>
    const atrasado = p.data.slice(0, 10) < hoje
    return (
      <>
        <div className={atrasado ? 'casos-data casos-alerta' : 'casos-data'}>
          {dataCurta(p.data)}{atrasado ? ' · atrasado' : p.hora ? ` · ${p.hora.slice(0, 5)}` : ''}
        </div>
        <div className="casos-secundario">{ROTULO_TIPO[p.tipo] ?? p.tipo}: {p.titulo}</div>
      </>
    )
  }
  function movimentacao(c: Caso) {
    if (!c.ultima_movimentacao_data) return <Text size="1" color="gray">Sem movimentação registrada</Text>
    return (
      <>
        <div className="hist-uma-linha" title={c.ultima_movimentacao_descricao ?? undefined}>{c.ultima_movimentacao_descricao || 'Movimentação'}</div>
        <div className="casos-secundario">{dataCurta(c.ultima_movimentacao_data)} · {haQuanto(c.ultima_movimentacao_data, hoje)}</div>
      </>
    )
  }
  function numeroProcesso(c: Caso) {
    const n = c.processos?.[0]
    return (
      <>
        <div className="casos-data">{n ? formatarNumeroCNJ(n) : '—'}</div>
        {c.foro && <div className="casos-secundario">{c.foro}</div>}
      </>
    )
  }
  function seloTipo(item: ItemHistorico) {
    return item.tipo === 'processo'
      ? <Badge color="blue" variant="soft">Processo</Badge>
      : <Badge color="purple" variant="soft">Publicações</Badge>
  }
  function menuHistorico(item: ItemHistorico) {
    const a = item.args as Record<string, string>
    const podeFavoritar = item.tipo === 'processo' && a.tribunal && a.numero_processo && !ehFavorito(a.tribunal, a.numero_processo)
    return <AcoesTabela rotulo={item.resumo} acoes={[
      ...(podeFavoritar ? [{ texto: 'Adicionar às consultas favoritas', executar: () => favoritarConsulta(item) }] : []),
      { texto: 'Remover do histórico', executar: () => tirarDoHistorico(item), perigo: true },
    ]} />
  }

  const campoBusca = (placeholder: string) => (
    <div className="form-campo aj-filtros-busca">
      <label className="form-campo-label" htmlFor="hist-busca">Buscar</label>
      <TextField.Root id="hist-busca" type="search" placeholder={placeholder} autoComplete="off" value={busca} onChange={e => setBusca(e.target.value)} />
    </div>
  )
  const vazio = (texto: string) => (
    <Callout.Root color="blue" size="1">
      <Callout.Icon><Info size={14} /></Callout.Icon>
      <Callout.Text>{texto}</Callout.Text>
    </Callout.Root>
  )

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina titulo="Histórico e favoritos" descricao="Seus processos favoritos e as consultas que você fez recentemente." />

      <Tabs.Root value={aba} onValueChange={v => { setAba(v as Aba); setBusca('') }}>
        <Tabs.List>
          <Tabs.Trigger value="processos">{estreita ? 'Processos' : 'Processos favoritos'} <Text size="1" color="gray" ml="1">{idsFavoritos.length}</Text></Tabs.Trigger>
          <Tabs.Trigger value="consultas">{estreita ? 'Consultas' : 'Consultas favoritas'} <Text size="1" color="gray" ml="1">{favoritos.length}</Text></Tabs.Trigger>
          <Tabs.Trigger value="historico">{estreita ? 'Histórico' : 'Histórico recente'} <Text size="1" color="gray" ml="1">{historico.length}</Text></Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="processos">
          <Flex direction="column" gap="4" pt="4">
            <div className="aj-filtros-linha">
              {campoBusca('Título, número ou cliente')}
              <Text size="2" color="gray" className="hist-dica">Marque ou desmarque a estrela na lista de Processos.</Text>
            </div>
            {carregando ? <Carregamento tipo="tabela" descricao="Carregando processos favoritos…" />
              : !casosVisiveis.length ? vazio(casosFavoritos.length ? 'Nenhum processo favorito com esta busca.' : 'Nenhum processo favorito ainda. Use a estrela na lista de Processos.')
              : estreita ? (
                <ul className="hist-cartoes">
                  {casosVisiveis.map(c => (
                    <li key={c.id} className="hist-cartao">
                      <Flex align="start" gap="2">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="hist-titulo">{formatarNomeExibicao(c.titulo) || '(sem título)'}</div>
                          {nomeCliente(c.cliente_id) && <div className="casos-secundario">{nomeCliente(c.cliente_id)}</div>}
                        </div>
                        {estrela(c)}
                      </Flex>
                      <div>{numeroProcesso(c)}</div>
                      <div><Text as="div" size="1" color="gray">Próximo compromisso</Text>{compromisso(c)}</div>
                      <Button size="3" variant="soft" color="gray" onClick={() => irPara('casos', { id: c.id })}>Abrir</Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <TabelaResponsiva principais={['Título', 'Nº do processo']}>
                  <table aria-label="Processos favoritos" className="hist-tabela-processos">
                    <thead>
                      <tr>
                        <th className="tabela-controle" aria-label="Favorito"></th>
                        <th>Título</th>
                        <th className="hist-col-numero">Nº do processo</th>
                        <th className="hist-col-compromisso">Próximo compromisso</th>
                        <th className="hist-col-mov">Última movimentação</th>
                        <th className="tabela-acoes hist-col-acoes">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {casosVisiveis.map(c => (
                        <tr key={c.id}>
                          <td className="tabela-controle">{estrela(c)}</td>
                          <td>
                            <button type="button" className="hist-link" onClick={() => irPara('casos', { id: c.id })}>{formatarNomeExibicao(c.titulo) || '(sem título)'}</button>
                            {nomeCliente(c.cliente_id) && <div className="casos-secundario">{nomeCliente(c.cliente_id)}</div>}
                          </td>
                          <td>{numeroProcesso(c)}</td>
                          <td>{compromisso(c)}</td>
                          <td>{movimentacao(c)}</td>
                          <td className="tabela-acoes"><Button size="1" variant="soft" color="gray" onClick={() => irPara('casos', { id: c.id })}>Abrir</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabelaResponsiva>
              )}
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="consultas">
          <Flex direction="column" gap="4" pt="4">
            <div className="aj-filtros-linha">{campoBusca('Tribunal ou número')}</div>
            {!favoritosVisiveis.length ? vazio(favoritos.length ? 'Nenhuma consulta favorita com esta busca.' : 'Nenhuma consulta favorita ainda. Use a estrela ao consultar um processo no DataJud.')
              : (
                <TabelaResponsiva principais={['Número do processo', 'Tribunal']}>
                  <table aria-label="Consultas favoritas" className="hist-tabela-consultas">
                    <thead>
                      <tr>
                        <th className="hist-col-tribunal">Tribunal</th>
                        <th>Número do processo</th>
                        <th className="tabela-acoes hist-col-acoes">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {favoritosVisiveis.map(fav => (
                        <tr key={`${fav.tribunal}:${fav.numero}`}>
                          <td><Badge color="gray" variant="soft">{(fav.tribunal || '?').toUpperCase()}</Badge></td>
                          <td className="casos-data">{formatarNumeroCNJ(fav.numero)}</td>
                          <td className="tabela-acoes">
                            <Flex gap="1" justify="end" align="center">
                              <Button size="1" variant="soft" color="gray" onClick={() => consultar(fav)}>Consultar</Button>
                              <AcoesTabela rotulo={`favorito ${fav.numero}`} acoes={[{ texto: 'Remover dos favoritos', executar: () => tirarConsultaDosFavoritos(fav), perigo: true }]} />
                            </Flex>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabelaResponsiva>
              )}
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="historico">
          <Flex direction="column" gap="4" pt="4">
            <div className="aj-filtros-linha">
              {campoBusca('Número, OAB ou tribunal')}
              <div className="form-campo">
                <label className="form-campo-label" id="hist-tipo-rotulo">Tipo</label>
                <Select.Root value={tipoFiltro || '__todos__'} onValueChange={v => setTipoFiltro(v === '__todos__' ? '' : v as TipoFiltro)}>
                  <Select.Trigger aria-labelledby="hist-tipo-rotulo" />
                  <Select.Content>
                    <Select.Item value="__todos__">Todos os tipos</Select.Item>
                    <Select.Item value="processo">Processo</Select.Item>
                    <Select.Item value="publicacoes">Publicações</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              {historico.length > 0 && (
                <Button size="2" variant="soft" color="red" className="hist-apagar" onClick={() => setConfirmarApagar(true)}>Apagar histórico</Button>
              )}
            </div>
            {!grupos.length ? vazio(historico.length ? 'Nenhuma consulta com estes filtros.' : 'Nenhuma consulta recente.')
              : estreita ? (
                <Flex direction="column" gap="4">
                  {grupos.map(g => (
                    <section key={g.titulo} aria-label={g.titulo}>
                      <h2 className="hist-grupo-titulo">{g.titulo}</h2>
                      <ul className="hist-cartoes">
                        {g.itens.map(item => {
                          const d = descreverConsulta(item)
                          return (
                            <li key={item.quando} className="hist-cartao">
                              <Flex align="center" gap="2">{seloTipo(item)}<Text size="1" color="gray">{horario(item)}</Text></Flex>
                              <div><div className="hist-titulo">{d.titulo}</div><div className="casos-secundario">{d.detalhe}</div></div>
                              <Flex gap="2"><Button size="3" variant="soft" color="gray" style={{ flex: 1 }} onClick={() => repetir(item)}>Repetir</Button>{menuHistorico(item)}</Flex>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </Flex>
              ) : (
                <div className="hist-tabela-caixa">
                  <table aria-label="Consultas recentes" className="hist-tabela">
                    <thead>
                      <tr>
                        <th className="hist-col-hora">Hora</th>
                        <th className="hist-col-tipo">Tipo</th>
                        <th>Consulta</th>
                        <th className="hist-col-acoes-hist">Ações</th>
                      </tr>
                    </thead>
                    {grupos.map(g => (
                      <tbody key={g.titulo}>
                        <tr className="hist-grupo">
                          <th colSpan={4} scope="colgroup">{g.titulo} <span>· {g.itens.length} {g.itens.length === 1 ? 'consulta' : 'consultas'}</span></th>
                        </tr>
                        {g.itens.map(item => {
                          const d = descreverConsulta(item)
                          return (
                            <tr key={item.quando}>
                              <td className="hist-hora">{horario(item)}</td>
                              <td>{seloTipo(item)}</td>
                              <td><div className="hist-titulo">{d.titulo}</div><div className="casos-secundario">{d.detalhe}</div></td>
                              <td><Flex gap="1" justify="end" align="center"><Button size="1" variant="soft" color="gray" onClick={() => repetir(item)}>Repetir</Button>{menuHistorico(item)}</Flex></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    ))}
                  </table>
                </div>
              )}
          </Flex>
        </Tabs.Content>
      </Tabs.Root>

      <Text size="1" color="gray">Favoritos e histórico ficam salvos na sua conta e valem em qualquer navegador. O histórico guarda as 10 consultas mais recentes.</Text>

      <AlertDialog.Root open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Apagar histórico</AlertDialog.Title>
          <AlertDialog.Description>Apagar as {historico.length} consultas recentes? Os favoritos continuam salvos.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">Cancelar</Button></AlertDialog.Cancel>
            <AlertDialog.Action><Button color="red" onClick={() => { limparHistorico(); setHistorico([]); avisar({ texto: 'Histórico apagado.' }) }}>Apagar histórico</Button></AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
