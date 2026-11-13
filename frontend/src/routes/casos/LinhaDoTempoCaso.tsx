import Carregamento from '../../Carregamento'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Callout, Text } from '@radix-ui/themes'
import { AlertTriangle, CheckSquare, Info, Link2, Newspaper, Scale } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { useNomePessoa } from '../../api/consultas'
import { consultaAtividades, consultaMovimentacoes, consultaPublicacoes, consultaVinculos } from './consultasCaso'
import {
  eventosAtividades, eventosMovimentacoes, eventosPublicacoes, eventosVinculos, isoLocalDe, montarLinha, rotuloDia,
  TIPOS, type Evento, type TipoEvento,
} from './linhaDoTempo'
import './linha-do-tempo.scss'

const ICONE: Record<TipoEvento, typeof Scale> = { movimentacao: Scale, publicacao: Newspaper, atividade: CheckSquare, vinculo: Link2 }
const POR_PAGINA = 40
const SEM_DADOS: never[] = []

/** Tudo o que já aconteceu no processo, em ordem, numa lista só. Somente consulta: as ações ficam nas abas de origem. */
export default function LinhaDoTempoCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const nomePessoa = useNomePessoa()
  const habilitada = Boolean(cliente)
  const mov = useQuery({ ...consultaMovimentacoes(cliente, casoId), enabled: habilitada })
  const pub = useQuery({ ...consultaPublicacoes(cliente, casoId), enabled: habilitada })
  const ati = useQuery({ ...consultaAtividades(cliente, casoId), enabled: habilitada })
  const vin = useQuery({ ...consultaVinculos(cliente, casoId), enabled: habilitada })
  const [hoje] = useState(() => isoLocalDe(new Date()))
  const [tipos, setTipos] = useState<Set<TipoEvento>>(() => new Set(TIPOS.map(t => t.id)))
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(POR_PAGINA)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  const eventos = useMemo<Evento[]>(() => [
    ...eventosMovimentacoes(mov.data?.movimentos ?? SEM_DADOS),
    ...eventosPublicacoes(pub.data?.publicacoes ?? SEM_DADOS, pub.data?.atividades ?? SEM_DADOS),
    ...eventosAtividades(ati.data?.atividades ?? SEM_DADOS, nomePessoa),
    ...eventosVinculos(vin.data ?? SEM_DADOS),
  ], [mov.data, pub.data, ati.data, vin.data, nomePessoa])
  const linha = useMemo(() => montarLinha(eventos, { tipos, busca, hoje, limite }), [eventos, tipos, busca, hoje, limite])

  const fontes = [
    { nome: 'movimentações', q: mov }, { nome: 'publicações', q: pub }, { nome: 'atividades', q: ati }, { nome: 'vínculos', q: vin },
  ]
  const falhas = fontes.filter(f => f.q.isError)
  const carregando = fontes.some(f => f.q.isLoading)
  const alternar = (t: TipoEvento) => setTipos(atual => { const n = new Set(atual); if (n.has(t)) n.delete(t); else n.add(t); return n })
  const alternarDetalhe = (id: string) => setAbertos(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (carregando && !eventos.length) return <Carregamento tipo="texto" descricao="Montando a linha do tempo…" />

  return (
    <div className="linha-tempo">
      {falhas.length > 0 && (
        <Callout.Root color="amber" size="1" role="alert">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>
            Não foi possível carregar {falhas.map(f => f.nome).join(', ')}. A linha do tempo está incompleta.{' '}
            <Button variant="ghost" size="1" onClick={() => falhas.forEach(f => void f.q.refetch())}>Tentar de novo</Button>
          </Callout.Text>
        </Callout.Root>
      )}

      <div className="linha-tempo__filtros" role="group" aria-label="Filtrar por tipo">
        {TIPOS.map(t => (
          <button key={t.id} type="button" className={`linha-tempo__chip k-${t.id}`} aria-pressed={tipos.has(t.id)} onClick={() => { alternar(t.id); setLimite(POR_PAGINA) }}>
            <span className="linha-tempo__ponto" aria-hidden="true" />{t.rotulo}<span className="linha-tempo__n">{linha.contagem[t.id]}</span>
          </button>
        ))}
        <input className="linha-tempo__busca" type="search" value={busca} placeholder="Buscar na linha do tempo" aria-label="Buscar na linha do tempo"
          onChange={e => { setBusca(e.target.value); setLimite(POR_PAGINA) }} />
      </div>

      {linha.grupos.length === 0 ? (
        <Callout.Root color="gray" size="1" role="status">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>{eventos.length ? 'Nada encontrado. Tire um filtro ou mude a busca.' : 'Ainda não há eventos neste processo.'}</Callout.Text>
        </Callout.Root>
      ) : (
        <div aria-live="polite">
          {linha.grupos.map(g => (
            <section key={g.dia} aria-label={rotuloDia(g.dia, hoje)}>
              <h3 className="linha-tempo__dia">{rotuloDia(g.dia, hoje)}</h3>
              {g.eventos.map(e => {
                const Icone = ICONE[e.tipo]
                const aberto = abertos.has(e.id)
                return (
                  <article key={e.id} className={`linha-tempo__item k-${e.tipo}`}>
                    <div className="linha-tempo__icone" aria-hidden="true"><Icone size={18} /></div>
                    <div className="linha-tempo__cartao">
                      <div className="linha-tempo__topo">
                        <span className="linha-tempo__tipo">{TIPOS.find(t => t.id === e.tipo)?.singular}</span>
                        {e.hora && <span className="linha-tempo__quando">{e.hora}</span>}
                      </div>
                      <div className="linha-tempo__titulo">{e.titulo}</div>
                      {e.selos.length > 0 && <div className="linha-tempo__selos">{e.selos.map(s => <Badge key={s.texto} color={s.cor} variant="soft">{s.texto}</Badge>)}</div>}
                      {e.detalhe && <Text as="p" size="2" color="gray">{e.detalhe}</Text>}
                      {e.texto && aberto && <p className="linha-tempo__texto">{e.texto}</p>}
                      {e.texto && (
                        <button type="button" className="linha-tempo__ver" aria-expanded={aberto} onClick={() => alternarDetalhe(e.id)}>
                          {aberto ? 'Ocultar detalhes' : 'Ver detalhes'}
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </section>
          ))}
        </div>
      )}

      <div className="linha-tempo__rodape">
        <Text size="1" color="gray">{linha.mostrados} de {linha.total} eventos</Text>
        {linha.mostrados < linha.total && <Button variant="soft" size="1" onClick={() => setLimite(l => l + POR_PAGINA)}>Mostrar mais antigos</Button>}
      </div>
      {linha.futurosOcultos > 0 && (
        <Text as="p" size="1" color="gray">
          {linha.futurosOcultos === 1 ? '1 atividade com data futura não aparece' : `${linha.futurosOcultos} atividades com data futura não aparecem`} aqui: veja na aba Atividades.
        </Text>
      )}
    </div>
  )
}
