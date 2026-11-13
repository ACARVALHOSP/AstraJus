import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Badge, Button, Callout, Flex, Heading, Text } from '@radix-ui/themes'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import { useCliente } from '../../api/ClienteContext'
import { useNavegacao } from '../../api/NavegacaoContext'
import { usePerfil } from '../../api/PerfilContext'
import { buscarJson } from '../../api/rest'
import { formatarMoeda, formatarNomeExibicao } from '../../utils/formatadores'
import { COR_TIPO, isoLocal, ROTULO_TIPO } from '../atividades/dados'
import { somarDias } from '../atividades/agenda'
import type { ResumoInadimplencia } from '../financeiro/dadosResumo'
import CentralRisco from './CentralRisco'
import { montarRiscos, type Destino } from './risco'
import './home-radix.css'

type Item = { id: number | string; caso_id: string; titulo: string; tipo: string; data?: string | null; hora?: string | null; responsavel?: string | null; caso: { titulo?: string | null } }
type Resumo = {
  semana: Item[] | null; atrasadas: Item[] | null; publicacoes: number | null; deClientes: number; inadimplencia: ResumoInadimplencia | null
  clientes: Record<string, string>
  rotinas: Record<string, { estado: string; erro?: string | null }[]> | null
  integracoes: { google: boolean; asaas: boolean; agendaPessoal: boolean | null } | null
}
const dataCurta = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}` }

/** Resumo do escritório inteiro: prazos da semana, publicações a revisar e valores vencidos. Cada
 *  bloco só aparece para quem tem acesso à área correspondente. */
export default function Escritorio({ abas }: { abas: ReactNode }) {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const { abaPermitida } = usePerfil()
  const verAtividades = abaPermitida('atividades'), verPublicacoes = abaPermitida('publicacoes-oab'), verFinanceiro = abaPermitida('financeiro'), verIntegracoes = abaPermitida('integracoes')
  const [agora] = useState(() => new Date())
  const hoje = isoLocal(agora)
  // Cada fonte é independente: se uma falhar (ou o acesso for negado), as outras continuam.
  const consulta = useQuery({
    queryKey: ['escritorio', cliente?.token, hoje, verAtividades, verPublicacoes, verFinanceiro, verIntegracoes],
    enabled: Boolean(cliente),
    queryFn: async ({ signal }) => {
      const sem = () => Promise.reject(new Error('sem acesso'))
      const [semana, atrasadas, pubs, fin, clientes, automacoes, statusIntegracoes, agenda] = await Promise.allSettled([
        verAtividades ? buscarJson<{ atividades: Item[] }>(cliente, `/atividades?situacao=abertas&de=${hoje}&ate=${somarDias(hoje, 6)}`, signal) : sem(),
        verAtividades ? buscarJson<{ atividades: Item[] }>(cliente, `/atividades?situacao=abertas&ate=${somarDias(hoje, -1)}`, signal) : sem(),
        verPublicacoes ? buscarJson<{ total: number; destinadas_a_clientes?: number }>(cliente, '/publicacoes-oab?status=nao_tratada&pagina=1&tamanho=1', signal) : sem(),
        verFinanceiro ? buscarJson<{ inadimplencia: ResumoInadimplencia }>(cliente, `/lancamentos/resumo?hoje=${hoje}`, signal) : sem(),
        verFinanceiro ? buscarJson<{ clientes: { id: string; nome?: string }[] }>(cliente, '/clientes', signal) : sem(),
        verPublicacoes ? buscarJson<{ rotinas: NonNullable<Resumo['rotinas']> }>(cliente, '/automacoes', signal) : sem(),
        verIntegracoes ? buscarJson<{ google: boolean; asaas: boolean }>(cliente, '/integracoes/status', signal) : sem(),
        verIntegracoes ? buscarJson<{ conectado: boolean }>(cliente, '/integracoes/calendar/status', signal) : sem(),
      ])
      const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)
      const resultado: Resumo = {
        semana: ok(semana)?.atividades ?? null, atrasadas: ok(atrasadas)?.atividades ?? null,
        publicacoes: ok(pubs)?.total ?? null, deClientes: ok(pubs)?.destinadas_a_clientes ?? 0, inadimplencia: ok(fin)?.inadimplencia ?? null,
        clientes: Object.fromEntries((ok(clientes)?.clientes ?? []).map(c => [c.id, c.nome ?? ''])),
        rotinas: ok(automacoes)?.rotinas ?? null,
        integracoes: ok(statusIntegracoes) && typeof ok(statusIntegracoes)?.google === 'boolean'
          ? { google: ok(statusIntegracoes)!.google, asaas: ok(statusIntegracoes)!.asaas === true, agendaPessoal: ok(statusIntegracoes)!.google && ok(agenda) ? ok(agenda)!.conectado === true : null }
          : null,
      }
      const quiseram = [verAtividades, verAtividades, verPublicacoes, verFinanceiro].filter(Boolean).length
      const vieram = [resultado.semana, resultado.atrasadas, resultado.publicacoes, resultado.inadimplencia].filter(x => x !== null).length
      return { dados: resultado, parcial: vieram < quiseram }
    },
  })
  const dados = consulta.data?.dados ?? null
  const carregando = consulta.isLoading
  const erro = consulta.data?.parcial ? 'Parte do resumo não pôde ser carregada. Os números abaixo podem estar incompletos.' : ''

  const prazos = dados?.semana?.filter(a => a.tipo === 'prazo') ?? []
  const audiencias = dados?.semana?.filter(a => a.tipo === 'audiencia') ?? []
  const proximos = [...(dados?.semana ?? [])].filter(a => a.tipo === 'prazo' || a.tipo === 'audiencia')
    .sort((a, b) => `${a.data}${a.hora ?? '99'}`.localeCompare(`${b.data}${b.hora ?? '99'}`)).slice(0, 8)
  const inad = dados?.inadimplencia
  const riscos = dados ? montarRiscos({
    hoje, semana: dados.semana, atrasadas: dados.atrasadas, publicacoes: dados.publicacoes, deClientes: dados.deClientes,
    rotinas: dados.rotinas, integracoes: dados.integracoes,
  }) : []
  // Fonte pedida e que não veio: não dá para afirmar "nada exige atenção".
  const incompleto = Boolean(erro) || (dados !== null && ((verPublicacoes && dados.rotinas === null) || (verIntegracoes && dados.integracoes === null)))
  const irDestino = (d: Destino) => irPara(d.aba, d.payload)

  type Cartao = { chave: string; titulo: string; valor: string; legenda: string; alerta?: boolean; vazio: boolean; ir: () => void }
  const cartoes: Cartao[] = []
  if (dados?.semana) cartoes.push(
    { chave: 'prazos', titulo: 'Prazos da semana', valor: String(prazos.length), legenda: audiencias.length ? `${audiencias.length} audiência(s) também` : 'próximos 7 dias', vazio: !prazos.length, ir: () => irPara('agenda') },
  )
  if (dados?.atrasadas) cartoes.push(
    { chave: 'atrasadas', titulo: 'Atividades atrasadas', valor: String(dados.atrasadas.length), legenda: dados.atrasadas.filter(a => a.tipo === 'prazo').length ? `${dados.atrasadas.filter(a => a.tipo === 'prazo').length} são prazos` : 'em aberto', alerta: dados.atrasadas.length > 0, vazio: !dados.atrasadas.length, ir: () => irPara('atividades') },
  )
  if (dados?.publicacoes !== null && dados?.publicacoes !== undefined) cartoes.push(
    { chave: 'publicacoes', titulo: 'Publicações por revisar', valor: String(dados.publicacoes), legenda: dados.deClientes ? `❗ ${dados.deClientes} de clientes` : 'recebidas e ainda não tratadas', alerta: dados.publicacoes > 0, vazio: !dados.publicacoes, ir: () => irPara('publicacoes-oab') },
  )
  if (inad) cartoes.push(
    { chave: 'vencidos', titulo: 'Vencidos a receber', valor: formatarMoeda(inad.total_vencido), legenda: inad.quantidade ? `${inad.quantidade} lançamento(s) de ${inad.clientes_inadimplentes} cliente(s)` : 'tudo em dia', alerta: inad.total_vencido > 0, vazio: !inad.total_vencido, ir: () => irPara('financeiro', { aba: 'inadimplencia' }) },
  )

  return (
    <div className="home">
      <CabecalhoPagina
        sobretitulo={agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        titulo="Escritório" abas={abas}
        descricao="Como está o escritório hoje: prazos, publicações a revisar e valores vencidos."
        acoes={<Button size="2" variant="soft" color="gray" disabled={consulta.isFetching} onClick={() => void consulta.refetch()}><RefreshCw size={14} aria-hidden="true" />Atualizar</Button>}
      />
      {!cliente && <Text as="p" size="2" color="gray">Conecte-se na aba Acesso para ver o resumo do escritório.</Text>}
      {erro && <Callout.Root color="amber" size="1" role="status"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && !dados && <Carregamento tipo="detalhe" descricao="Carregando o resumo…" />}
      {dados && !cartoes.length && !carregando && <Text as="p" size="2" color="gray">Seu perfil não tem acesso às áreas que compõem este resumo.</Text>}
      {dados && !carregando && (cartoes.length > 0 || riscos.length > 0) && <CentralRisco riscos={riscos} incompleto={incompleto} onIr={irDestino} />}
      {cartoes.length > 0 && (
        <div className="home-resumo" role="list" aria-label="Resumo do escritório" aria-busy={carregando}>
          {cartoes.map(c => (
            <button key={c.chave} type="button" role="listitem" className={`home-metrica${c.vazio ? ' home-metrica--zero' : ''}${c.alerta ? ' home-metrica-atrasadas' : ''}`} onClick={c.ir}>
              <span className="home-metrica-titulo">{c.titulo}</span>
              <span className="home-metrica-num">{c.valor}</span>
              <span className="home-metrica-desc">{c.legenda}</span>
            </button>
          ))}
        </div>
      )}

      {dados?.semana && (
        <section aria-labelledby="esc-proximos">
          <Flex align="center" justify="between" mb="2">
            <Heading as="h2" size="3" id="esc-proximos">Prazos e audiências dos próximos 7 dias</Heading>
            <Button size="1" variant="ghost" onClick={() => irPara('agenda')}>Abrir agenda</Button>
          </Flex>
          {proximos.length === 0
            ? <Text as="p" size="2" color="gray" role="status">Nenhum prazo ou audiência nos próximos 7 dias.</Text>
            : <ul className="esc-lista">
                {proximos.map(a => (
                  <li key={`${a.caso_id}:${a.id}`}>
                    <span className="esc-data">{a.data === hoje ? 'Hoje' : dataCurta(a.data ?? '')}{a.hora ? ` · ${a.hora.slice(0, 5)}` : ''}</span>
                    <div>
                      <Flex gap="2" align="center" wrap="wrap">
                        <Badge color={COR_TIPO[a.tipo] ?? 'gray'} variant="soft">{ROTULO_TIPO[a.tipo] ?? a.tipo}</Badge>
                        <button type="button" className="esc-link" onClick={() => irPara('casos', { id: a.caso_id, aba: 'atividades', atividadeId: a.id })}>{a.titulo}</button>
                      </Flex>
                      <Text as="p" size="2" color="gray">{a.caso?.titulo ? formatarNomeExibicao(a.caso.titulo) : 'Processo'}{a.responsavel ? ` · ${a.responsavel}` : ''}</Text>
                    </div>
                  </li>
                ))}
              </ul>}
        </section>
      )}

      {inad && inad.clientes.length > 0 && (
        <section aria-labelledby="esc-devedores">
          <Flex align="center" justify="between" mb="2">
            <Heading as="h2" size="3" id="esc-devedores">Maiores valores vencidos</Heading>
            <Button size="1" variant="ghost" onClick={() => irPara('financeiro', { aba: 'inadimplencia' })}>Ver inadimplência</Button>
          </Flex>
          <ul className="esc-lista">
            {inad.clientes.slice(0, 5).map(c => (
              <li key={c.cliente_id}>
                <span className="esc-data esc-alerta">{formatarMoeda(c.valor)}</span>
                <div>
                  <Text size="2" weight="medium">{formatarNomeExibicao(dados?.clientes[c.cliente_id] ?? '') || 'Cliente'}</Text>
                  <Text as="p" size="2" color="gray">{c.quantidade} lançamento(s) · {c.maior_atraso} dias de atraso</Text>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
