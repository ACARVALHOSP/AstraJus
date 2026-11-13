import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Callout, Checkbox, Flex, IconButton, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, DollarSign, Download, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react'
import { useAvisos } from '../Avisos'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import LinhaFiltros from '../LinhaFiltros'
import TabelaResponsiva from '../TabelaResponsiva'
import { useCasos, useNomePessoa, useResponsaveis } from '../api/consultas'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { usePerfil } from '../api/PerfilContext'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao } from '../utils/formatadores'
import { baixarCsv } from '../utils/csv'
import { DialogoFaturar, DialogoIniciarCronometro, DialogoLancarHoras, DialogoTarifas } from './horas/DialogosHoras'
import {
  formatarDuracao, formatarRelogio, mesDe, motivoNaoFaturar, parametrosDeHoras, podeFaturar, situacaoDasHoras,
  type Horas, type StatusFiltro, type Totais,
} from './horas/dados'
import './home/home-radix.css'

const TODOS = '__todos__'
type Cronometro = { caso_id: string; caso_titulo: string | null; descricao: string | null; inicio: string }

/** Horas por processo: lançamento manual, cronômetro, valor por hora, relatório e faturamento. */
export default function HorasPagina() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const { podeEditar, nivel, login: eu } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const editavel = podeEditar('atividades')
  const podeFaturarNoFinanceiro = podeEditar('financeiro')
  const administrador = nivel === 'administrador'

  const [filtros, setFiltros] = useState(() => ({ ...mesDe(new Date()), usuario: '', casoId: '', status: 'todos' as StatusFiltro }))
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [dialogo, setDialogo] = useState<null | 'lancar' | 'cronometro' | 'faturar' | 'tarifas'>(null)
  const [emEdicao, setEmEdicao] = useState<Horas | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  const consulta = useQuery({
    queryKey: ['horas', cliente?.token, filtros],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ horas: Horas[]; totais: Totais }>(cliente, `/horas?${parametrosDeHoras(filtros)}`, signal),
  })
  const cronometroQ = useQuery({
    queryKey: ['horas-cronometro', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ cronometro: Cronometro | null }>(cliente, '/horas/cronometro', signal).then(r => r.cronometro),
  })
  const tarifasQ = useQuery({
    queryKey: ['horas-tarifas', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ tarifas: Record<string, number> }>(cliente, '/horas/tarifas', signal).then(r => r.tarifas ?? {}),
  })
  const casosQ = useCasos<{ id: string; titulo?: string }>({ enabled: Boolean(cliente) })
  const pessoasQ = useResponsaveis()
  const nomePessoa = useNomePessoa()

  const casos = useMemo(() => [...(casosQ.data ?? [])].sort((a, b) => (a.titulo ?? '').localeCompare(b.titulo ?? '', 'pt-BR')), [casosQ.data])
  const horas = consulta.data?.horas ?? []
  const totais = consulta.data?.totais
  const cronometro = cronometroQ.data ?? null
  const tarifaPropria = eu ? tarifasQ.data?.[eu] ?? null : null

  // O relógio só anda enquanto o cronômetro está ligado.
  useEffect(() => {
    if (!cronometro) return
    const id = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [cronometro])

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ['horas'] })
    void queryClient.invalidateQueries({ queryKey: ['horas-cronometro'] })
    void queryClient.invalidateQueries({ queryKey: ['horas-tarifas'] })
  }
  const escolhidas = horas.filter(h => selecionadas.has(h.id))
  const motivo = motivoNaoFaturar(escolhidas)
  const selecionaveis = horas.filter(podeFaturar)
  const valorEscolhido = escolhidas.reduce((s, h) => s + Math.round((h.valor ?? 0) * 100), 0) / 100
  const mudarFiltro = (parcial: Partial<typeof filtros>) => { setFiltros(f => ({ ...f, ...parcial })); setSelecionadas(new Set()) }

  async function pararCronometro() {
    try {
      const r = await enviarJson<{ horas: Horas & { limitado?: boolean } }>(cliente, '/horas/cronometro/parar', {}, 'POST')
      avisar({ texto: `${formatarDuracao(r.horas.minutos)} lançadas em “${formatarNomeExibicao(r.horas.caso_titulo)}”.${r.horas.limitado ? ' O cronômetro ficou ligado por mais de 24 h; o tempo foi limitado a 24 h. Corrija se precisar.' : ''}` })
      recarregar()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível parar o cronômetro.' })
    }
  }
  async function descartarCronometro() {
    if (!window.confirm('Descartar o cronômetro sem lançar o tempo?')) return
    try { await enviarJson(cliente, '/horas/cronometro', {}, 'DELETE'); recarregar() }
    catch (e) { avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível descartar.' }) }
  }
  async function excluir(h: Horas) {
    if (!window.confirm(`Excluir ${formatarDuracao(h.minutos)} de ${formatarDataSimples(h.data)}?`)) return
    try { await enviarJson(cliente, `/horas/${h.id}`, {}, 'DELETE'); setSelecionadas(s => { const n = new Set(s); n.delete(h.id); return n }); recarregar() }
    catch (e) { avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível excluir.' }) }
  }
  function exportar() {
    if (!horas.length) { avisar({ tipo: 'info', texto: 'Não há horas neste período e filtros para exportar.' }); return }
    baixarCsv('horas', [
      { titulo: 'Data', valor: h => formatarDataSimples(h.data) },
      { titulo: 'Pessoa', valor: h => nomePessoa(h.usuario) },
      { titulo: 'Processo', valor: h => formatarNomeExibicao(h.caso_titulo) },
      { titulo: 'Descrição', valor: h => h.descricao },
      { titulo: 'Tempo', valor: h => formatarDuracao(h.minutos) },
      { titulo: 'Horas (decimal)', valor: h => Math.round((h.minutos / 60) * 100) / 100 },
      { titulo: 'Faturável', valor: h => (h.faturavel ? 'Sim' : 'Não') },
      { titulo: 'Valor por hora', valor: h => h.valor_hora },
      { titulo: 'Valor', valor: h => h.valor },
      { titulo: 'Situação', valor: h => situacaoDasHoras(h).texto },
    ], horas)
  }

  const segundos = cronometro ? (agora - Date.parse(cronometro.inicio)) / 1000 : 0
  const filtrosAtivos = (filtros.usuario ? 1 : 0) + (filtros.casoId ? 1 : 0) + (filtros.status !== 'todos' ? 1 : 0)

  return (
    <div className="home">
      <CabecalhoPagina
        titulo="Horas"
        descricao="Tempo por processo e cliente. O cronômetro só conta quando você o liga."
        acoes={(
          <Flex gap="2" wrap="wrap">
            {administrador && <Button size="2" variant="soft" color="gray" disabled={!cliente} onClick={() => setDialogo('tarifas')}><DollarSign size={15} aria-hidden="true" />Valor por hora</Button>}
            <Button size="2" variant="soft" color="gray" disabled={!cliente} onClick={exportar}><Download size={15} aria-hidden="true" />Exportar CSV</Button>
            {!cronometro && <Button size="2" variant="soft" disabled={!cliente || !editavel} onClick={() => setDialogo('cronometro')}><Play size={15} aria-hidden="true" />Iniciar cronômetro</Button>}
            <Button size="2" disabled={!cliente || !editavel} onClick={() => { setEmEdicao(null); setDialogo('lancar') }}><Plus size={16} aria-hidden="true" />Lançar horas</Button>
          </Flex>
        )}
      />
      {!cliente && <Text as="p" size="2" color="gray">Conecte-se na aba Acesso para ver as horas.</Text>}

      {cronometro && (
        <Callout.Root color="blue" size="2" role="status" aria-label="Cronômetro em andamento">
          <Callout.Icon><Play size={16} /></Callout.Icon>
          <Callout.Text>
            <Flex gap="3" align="center" wrap="wrap">
              <strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: '1.1rem' }}>{formatarRelogio(segundos)}</strong>
              <span>{formatarNomeExibicao(cronometro.caso_titulo) || '(processo)'}{cronometro.descricao ? ` · ${cronometro.descricao}` : ''}</span>
              <Button size="1" onClick={() => void pararCronometro()}><Square size={12} aria-hidden="true" />Parar e lançar</Button>
              <Button size="1" variant="soft" color="gray" onClick={() => void descartarCronometro()}>Descartar</Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )}

      {consulta.isError && (
        <Callout.Root color="red" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>Não foi possível carregar as horas. <Button size="1" variant="ghost" onClick={() => void consulta.refetch()}>Tentar novamente</Button></Callout.Text>
        </Callout.Root>
      )}

      <div className="home-resumo" role="list" aria-label="Resumo das horas" aria-busy={consulta.isFetching}>
        {[
          { chave: 'tempo', titulo: 'Tempo total', valor: formatarDuracao(totais?.minutos ?? 0), legenda: `${horas.length} ${horas.length === 1 ? 'lançamento' : 'lançamentos'}` },
          { chave: 'fat', titulo: 'Tempo faturável', valor: formatarDuracao(totais?.minutos_faturaveis ?? 0), legenda: 'pode ser cobrado do cliente' },
          { chave: 'a', titulo: 'A faturar', valor: formatarMoeda(totais?.a_faturar ?? 0), legenda: 'faturável, ainda sem lançamento' },
          { chave: 'f', titulo: 'Faturado', valor: formatarMoeda(totais?.faturado ?? 0), legenda: 'já virou honorário' },
        ].map(c => (
          <div key={c.chave} role="listitem" className="home-metrica">
            <span className="home-metrica-titulo">{c.titulo}</span>
            <span className="home-metrica-num">{consulta.isPending ? '—' : c.valor}</span>
            <span className="home-metrica-desc">{c.legenda}</span>
          </div>
        ))}
      </div>
      {!!totais?.sem_valor_hora && (
        <Callout.Root color="amber" size="1" role="status"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{totais.sem_valor_hora} {totais.sem_valor_hora === 1 ? 'lançamento faturável está' : 'lançamentos faturáveis estão'} sem valor por hora e não {totais.sem_valor_hora === 1 ? 'entra' : 'entram'} no valor a faturar. {administrador ? 'Defina o valor por hora de cada pessoa e corrija esses lançamentos.' : 'Peça ao administrador para definir o seu valor por hora, ou informe o valor ao editar o lançamento.'}</Callout.Text>
        </Callout.Root>
      )}

      <LinhaFiltros ativos={filtrosAtivos}>
        <Flex direction="column" gap="1"><Text as="label" size="1" color="gray" htmlFor="horas-de">De</Text>
          <TextField.Root id="horas-de" type="date" value={filtros.de} onChange={e => mudarFiltro({ de: e.target.value })} /></Flex>
        <Flex direction="column" gap="1"><Text as="label" size="1" color="gray" htmlFor="horas-ate">Até</Text>
          <TextField.Root id="horas-ate" type="date" value={filtros.ate} onChange={e => mudarFiltro({ ate: e.target.value })} /></Flex>
        <Flex direction="column" gap="1"><Text size="1" color="gray">Pessoa</Text>
          <Select.Root value={filtros.usuario || TODOS} onValueChange={v => mudarFiltro({ usuario: v === TODOS ? '' : v })}>
            <Select.Trigger aria-label="Filtrar por pessoa" />
            <Select.Content><Select.Item value={TODOS}>Todas as pessoas</Select.Item>{(pessoasQ.data ?? []).map(p => <Select.Item key={p} value={p}>{nomePessoa(p)}</Select.Item>)}</Select.Content>
          </Select.Root></Flex>
        <Flex direction="column" gap="1"><Text size="1" color="gray">Processo</Text>
          <Select.Root value={filtros.casoId || TODOS} onValueChange={v => mudarFiltro({ casoId: v === TODOS ? '' : v })}>
            <Select.Trigger aria-label="Filtrar por processo" />
            <Select.Content><Select.Item value={TODOS}>Todos os processos</Select.Item>{casos.map(c => <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.titulo) || '(sem título)'}</Select.Item>)}</Select.Content>
          </Select.Root></Flex>
        <Flex direction="column" gap="1"><Text size="1" color="gray">Situação</Text>
          <Select.Root value={filtros.status} onValueChange={v => mudarFiltro({ status: v as StatusFiltro })}>
            <Select.Trigger aria-label="Filtrar por situação" />
            <Select.Content>
              <Select.Item value="todos">Todas</Select.Item><Select.Item value="a_faturar">A faturar</Select.Item>
              <Select.Item value="faturadas">Faturadas</Select.Item><Select.Item value="nao_faturaveis">Não faturáveis</Select.Item>
            </Select.Content>
          </Select.Root></Flex>
      </LinhaFiltros>

      {escolhidas.length > 0 && (
        <Flex align="center" gap="3" wrap="wrap" role="status">
          <Text size="2">{escolhidas.length} {escolhidas.length === 1 ? 'selecionada' : 'selecionadas'} · {formatarDuracao(escolhidas.reduce((s, h) => s + h.minutos, 0))} · {formatarMoeda(valorEscolhido)}</Text>
          <Button size="2" disabled={Boolean(motivo) || !podeFaturarNoFinanceiro} onClick={() => setDialogo('faturar')}>Faturar selecionadas</Button>
          {(motivo || !podeFaturarNoFinanceiro) && <Text size="1" color="amber">{!podeFaturarNoFinanceiro ? 'Seu perfil não pode criar lançamentos no Financeiro.' : motivo}</Text>}
        </Flex>
      )}

      {consulta.isPending && cliente && <Carregamento tipo="tabela" colunas={7} descricao="Carregando horas…" />}
      {consulta.data && horas.length === 0 && <Text as="p" size="2" color="gray" role="status">Nenhuma hora neste período e filtros. Use o cronômetro ou “Lançar horas”.</Text>}
      {horas.length > 0 && (
        <TabelaResponsiva principais={['Data', 'Processo', 'Tempo', 'Valor', 'Situação']} larguraCompacta={680}>
          <table aria-label="Horas lançadas" className="fin-tabela">
            <thead>
              <tr>
                <th className="tabela-controle">
                  <Checkbox aria-label="Selecionar todas as horas que podem ser faturadas" disabled={!selecionaveis.length}
                    checked={selecionaveis.length > 0 && selecionaveis.every(h => selecionadas.has(h.id)) ? true : selecionadas.size ? 'indeterminate' : false}
                    onCheckedChange={() => setSelecionadas(selecionaveis.every(h => selecionadas.has(h.id)) ? new Set() : new Set(selecionaveis.map(h => h.id)))} />
                </th>
                <th>Data</th><th>Processo</th><th>Tempo</th><th>Valor</th><th>Situação</th>
                <th className="tabela-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {horas.map(h => {
                const situacao = situacaoDasHoras(h)
                const meu = h.usuario === eu || administrador
                const travada = h.faturado
                return (
                  <tr key={h.id}>
                    <td className="tabela-controle">
                      <Checkbox aria-label={`Selecionar ${formatarDuracao(h.minutos)} de ${formatarDataSimples(h.data)}`} disabled={!podeFaturar(h)}
                        checked={selecionadas.has(h.id)}
                        onCheckedChange={() => setSelecionadas(s => { const n = new Set(s); if (n.has(h.id)) n.delete(h.id); else n.add(h.id); return n })} />
                    </td>
                    <td>
                      <div>{formatarDataSimples(h.data)}</div>
                      <Text as="div" size="1" color="gray">{nomePessoa(h.usuario)}</Text>
                    </td>
                    <td>
                      <Button variant="ghost" size="2" onClick={() => irPara('casos', { id: h.caso_id })}>{formatarNomeExibicao(h.caso_titulo) || '(sem título)'}</Button>
                      {h.descricao && <Text as="div" size="1" color="gray">{h.descricao}</Text>}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatarDuracao(h.minutos)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{h.valor === null ? '—' : formatarMoeda(h.valor)}</td>
                    <td><Badge color={situacao.cor} variant="soft">{situacao.texto}</Badge></td>
                    <td className="tabela-acoes">
                      <Flex gap="1">
                        <IconButton size="1" variant="soft" color="gray" aria-label="Editar horas" disabled={!editavel || travada || !meu} title={travada ? 'Horas faturadas não podem ser alteradas' : undefined} onClick={() => { setEmEdicao(h); setDialogo('lancar') }}><Pencil size={13} /></IconButton>
                        <IconButton size="1" variant="soft" color="red" aria-label="Excluir horas" disabled={!editavel || travada || !meu} title={travada ? 'Horas faturadas não podem ser excluídas' : undefined} onClick={() => void excluir(h)}><Trash2 size={13} /></IconButton>
                      </Flex>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TabelaResponsiva>
      )}

      {dialogo === 'lancar' && <DialogoLancarHoras inicial={emEdicao} casos={casos} tarifaPropria={tarifaPropria} onClose={() => setDialogo(null)}
        onSalvo={() => { setDialogo(null); recarregar(); avisar({ texto: emEdicao ? 'Horas atualizadas.' : 'Horas lançadas.' }) }} />}
      {dialogo === 'cronometro' && <DialogoIniciarCronometro casos={casos} onClose={() => setDialogo(null)} onIniciado={() => { setDialogo(null); recarregar() }} />}
      {dialogo === 'faturar' && <DialogoFaturar selecionadas={escolhidas} onClose={() => setDialogo(null)} irParaFinanceiro={() => irPara('financeiro')}
        onFaturado={() => { setSelecionadas(new Set()); recarregar(); void queryClient.invalidateQueries({ queryKey: ['lancamentos'] }) }} />}
      {dialogo === 'tarifas' && <DialogoTarifas pessoas={pessoasQ.data ?? []} tarifas={tarifasQ.data ?? {}} onClose={() => setDialogo(null)}
        onSalvo={() => { setDialogo(null); recarregar(); avisar({ texto: 'Valores por hora salvos.' }) }} />}
    </div>
  )
}
