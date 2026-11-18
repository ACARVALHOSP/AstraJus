import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Lightbulb } from 'lucide-react'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { usePerfil } from '../../api/PerfilContext'
import { buscarJson, enviarJson, requisitar } from '../../api/rest'
import { ErroMCP } from '../../api/mcpClient'
import { formatarDataSimples, isoLocal } from '../../utils/formatadores'
import type { PublicacaoOab } from '../publicacoes-oab/dados'
import { calcularVencimento, type Sugestao } from './regrasPrazo'

/** Evento do processo que pode disparar uma regra de prazo. `data` é AAAA-MM-DD. */
type Evento = {
  origem: 'publicacao' | 'movimento'
  id: string
  texto: string
  data: string
}
type Item = { evento: Evento; sugestao: Sugestao }

type CapaProcesso = {
  tribunal?: string | null
  cidade?: string | null
  grau?: string | null
  movimentos?: Array<{
    codigo?: number | string | null
    nome?: string
    dataHora?: string
    grau?: string
    complementosTabelados?: Array<{ nome?: string }>
  }> | null
}

const DIAS_DA_JANELA = 30
const MAX_EVENTOS = 10

/** AAAA-MM-DD a partir do formato do DJEN/DataJud; vazio quando não é uma data reconhecível. */
function dataIso(valor?: string | null): string {
  const bruto = String(valor ?? '').trim()
  const compacta = /^(\d{4})(\d{2})(\d{2})/.exec(bruto)
  const iso = compacta ? `${compacta[1]}-${compacta[2]}-${compacta[3]}` : bruto.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ''
}

/** Publicações e movimentos dos últimos 30 dias, no máximo os 10 mais recentes de cada origem. */
function eventosRecentes(publicacoes: PublicacaoOab[], capas: CapaProcesso[], limite: string): Evento[] {
  const publicados: Evento[] = publicacoes
    .map(p => ({
      origem: 'publicacao' as const,
      id: p.hash,
      texto: String(p.dados?.texto ?? p.dados?.teor ?? p.dados?.conteudo ?? '').replace(/\s+/g, ' ').trim(),
      data: dataIso(p.dados?.data_disponibilizacao),
    }))
    .filter(e => e.id && e.data && e.data >= limite)
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, MAX_EVENTOS)

  const vistos = new Set<string>()
  const movimentos: Evento[] = []
  for (const capa of capas) {
    for (const m of capa.movimentos ?? []) {
      const data = dataIso(m.dataHora)
      if (!data || data < limite) continue
      const nome = (m.nome ?? '').trim()
      const complementos = (m.complementosTabelados ?? []).map(c => (c.nome ?? '').trim()).filter(Boolean)
      const id = `${data}|${m.codigo ?? ''}|${nome}`
      if (vistos.has(id)) continue
      vistos.add(id)
      movimentos.push({ origem: 'movimento', id, texto: [nome, ...complementos].filter(Boolean).join(' '), data })
    }
  }
  movimentos.sort((a, b) => b.data.localeCompare(a.data))
  return [...publicados, ...movimentos.slice(0, MAX_EVENTOS)]
}

function chaveDoItem(item: Item) {
  return `${item.evento.origem}|${item.evento.id}|${item.sugestao.regra.id}`
}

function ehConflito(erro: unknown): boolean {
  return erro instanceof ErroMCP && erro.status === 409
}

/** Termos entre aspas, com vírgulas e "e" antes do último. */
function listaDeTermos(termos: string[]): string {
  const aspas = termos.map(t => `“${t}”`)
  if (aspas.length === 1) return aspas[0]
  return `${aspas.slice(0, -1).join(', ')} e ${aspas[aspas.length - 1]}`
}

function fraseDaSugestao({ evento, sugestao }: Item): string {
  const termos = sugestao.termos.length ? listaDeTermos(sugestao.termos) : 'uma regra cadastrada'
  const contagem = sugestao.tipo.contagem === 'uteis'
    ? (sugestao.tipo.dias === 1 ? 'dia útil' : 'dias úteis')
    : (sugestao.tipo.dias === 1 ? 'dia corrido' : 'dias corridos')
  const naOrigem = evento.origem === 'publicacao' ? 'publicação' : 'movimentação'
  return `A regra “${sugestao.regra.nome}” sugere o prazo “${sugestao.tipo.nome}” (${sugestao.tipo.dias} ${contagem}) `
    + `por causa de ${termos} na ${naOrigem} de ${formatarDataSimples(evento.data)}. Nada é criado sem a sua revisão.`
}

/** Faixa no processo: cada publicação/movimento recente pode casar com regras de prazo.
 *  Nada é criado sem revisão. Recurso complementar: sem permissão, erro ou lista vazia, não aparece. */
export default function SugestaoPrazos({ casoId, onAplicado }: { casoId: string; onAplicado: () => void }) {
  const { cliente } = useCliente()
  const { podeEditar } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const permitido = podeEditar('atividades')
  const [revisando, setRevisando] = useState<Item | null>(null)
  const [dispensando, setDispensando] = useState('')

  const consulta = useQuery({
    queryKey: ['regras-caso', cliente?.token, casoId],
    enabled: Boolean(cliente) && permitido,
    queryFn: async ({ signal }): Promise<Item[]> => {
      if (!cliente) return []
      const api = `/casos/${encodeURIComponent(casoId)}`
      const [caso, publicacoes] = await Promise.allSettled([
        buscarJson<{ processos?: string[] }>(cliente, api, signal),
        buscarJson<{ publicacoes?: PublicacaoOab[] }>(cliente, `${api}/publicacoes`, signal),
      ])
      const numeros = caso.status === 'fulfilled' ? caso.value.processos ?? [] : []
      // A capa traz o código do movimento e os complementos que alimentam as regras por palavra-chave.
      const capas = await Promise.allSettled(numeros.map(n =>
        buscarJson<CapaProcesso>(cliente, `${api}/processos/${encodeURIComponent(n)}/capa`, signal)))
      const limite = isoLocal(new Date(Date.now() - DIAS_DA_JANELA * 86_400_000))
      const eventos = eventosRecentes(
        publicacoes.status === 'fulfilled' ? publicacoes.value.publicacoes ?? [] : [],
        capas.flatMap(c => (c.status === 'fulfilled' ? [c.value] : [])),
        limite,
      )
      // Leitura: usa requisitar para não disparar avisarDadosAlterados a cada consulta de sugestões.
      const respostas = await Promise.allSettled(eventos.map(async evento => {
        const resposta = await requisitar(cliente, `${api}/regras-prazo/sugestoes`, {
          metodo: 'POST', corpo: { origem: evento.origem, id: evento.id, texto: evento.texto }, signal,
        })
        const dados = await resposta.json() as { sugestoes?: Sugestao[] }
        return dados.sugestoes ?? []
      }))
      const itens: Item[] = []
      respostas.forEach((resposta, indice) => {
        if (resposta.status !== 'fulfilled') return
        for (const sugestao of resposta.value) itens.push({ evento: eventos[indice], sugestao })
      })
      return itens
    },
  })

  const atualizar = () => queryClient.invalidateQueries({ queryKey: ['regras-caso'] })

  async function dispensar(item: Item) {
    const chave = chaveDoItem(item)
    setDispensando(chave)
    try {
      await enviarJson(
        cliente,
        `/casos/${encodeURIComponent(casoId)}/regras-prazo/${encodeURIComponent(item.sugestao.regra.id)}/dispensar`,
        { origem: item.evento.origem, origem_id: item.evento.id },
      )
      avisar({ texto: `Sugestão da regra “${item.sugestao.regra.nome}” dispensada neste processo.` })
    } catch (e) {
      if (ehConflito(e)) {
        setRevisando(null)
        avisar({ tipo: 'info', texto: 'Outra pessoa já decidiu esta sugestão.' })
      } else {
        avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível dispensar a sugestão.' })
      }
    } finally {
      setDispensando('')
      void atualizar()
    }
  }

  const sugestoes = consulta.data ?? []
  if (!permitido || (!sugestoes.length && !revisando)) return null

  return (
    <Flex direction="column" gap="2" mb="3">
      {sugestoes.map(item => {
        const chave = chaveDoItem(item)
        return (
          <Callout.Root key={chave} color="blue" size="1" role="status">
            <Callout.Icon><Lightbulb size={16} /></Callout.Icon>
            <Callout.Text>
              <Flex direction="column" gap="2" align="start">
                <span>{fraseDaSugestao(item)}</span>
                <Flex gap="2" wrap="wrap">
                  <Button size="1" onClick={() => setRevisando(item)}
                    aria-label={`Revisar e aplicar o prazo “${item.sugestao.tipo.nome}” sugerido pela regra “${item.sugestao.regra.nome}”`}>
                    Revisar e aplicar
                  </Button>
                  <Button size="1" variant="soft" color="gray" disabled={dispensando === chave}
                    aria-label={`Dispensar a sugestão da regra “${item.sugestao.regra.nome}”`}
                    onClick={() => void dispensar(item)}>
                    Dispensar
                  </Button>
                </Flex>
              </Flex>
            </Callout.Text>
          </Callout.Root>
        )
      })}
      {revisando && (
        <RevisarPrazo
          key={chaveDoItem(revisando)}
          casoId={casoId}
          item={revisando}
          onClose={() => setRevisando(null)}
          onCriado={() => {
            setRevisando(null)
            void atualizar()
            onAplicado()
          }}
        />
      )}
    </Flex>
  )
}

/** Revisão da sugestão: título e vencimento calculado pelo calendário forense do tribunal. */
function RevisarPrazo({ casoId, item, onClose, onCriado }: {
  casoId: string; item: Item; onClose: () => void; onCriado: () => void
}) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const [titulo, setTitulo] = useState(item.sugestao.tipo.nome.slice(0, 200))
  const [vencimento, setVencimento] = useState('')
  const [calculando, setCalculando] = useState(true)
  const [estimativa, setEstimativa] = useState<{ aConfirmar: boolean; fonte: string } | null>(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Tribunal e município da capa do primeiro número do processo (mesma origem usada em AtividadePublicacao).
  const capa = useQuery({
    queryKey: ['caso-capa-prazo', cliente?.token, casoId],
    enabled: Boolean(cliente),
    queryFn: async ({ signal }): Promise<{ tribunal: string; municipio: string }> => {
      if (!cliente) return { tribunal: '', municipio: '' }
      const api = `/casos/${encodeURIComponent(casoId)}`
      const caso = await buscarJson<{ processos?: string[] }>(cliente, api, signal)
      const numero = (caso.processos ?? [])[0]
      if (!numero) return { tribunal: '', municipio: '' }
      const dados = await buscarJson<{ tribunal?: string | null; cidade?: string | null }>(
        cliente, `${api}/processos/${encodeURIComponent(numero)}/capa`, signal)
      return { tribunal: dados.tribunal ?? '', municipio: dados.cidade ?? '' }
    },
  })

  useEffect(() => {
    // Espera a capa para não calcular duas vezes (primeiro sem feriados locais, depois com eles).
    if (!cliente || capa.isLoading) return
    let ativo = true
    setCalculando(true)
    setEstimativa(null)
    calcularVencimento(cliente, {
      base: item.evento.data,
      tipo: item.sugestao.tipo,
      tribunal: capa.data?.tribunal ?? '',
      municipio: capa.data?.municipio ?? '',
    }).then(resultado => {
      if (!ativo) return
      setVencimento(resultado.data)
      setEstimativa({ aConfirmar: resultado.aConfirmar, fonte: resultado.fonte })
    }).catch((e: unknown) => {
      if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível calcular o vencimento.')
    }).finally(() => {
      if (ativo) setCalculando(false)
    })
    return () => { ativo = false }
  }, [cliente, capa.isLoading, capa.data, item])

  const invalido = !titulo.trim() || titulo.length > 200 || !vencimento || calculando

  async function criar() {
    if (salvando || invalido) return
    setSalvando(true)
    setErro('')
    try {
      await enviarJson(
        cliente,
        `/casos/${encodeURIComponent(casoId)}/regras-prazo/${encodeURIComponent(item.sugestao.regra.id)}/aplicar`,
        { origem: item.evento.origem, origem_id: item.evento.id, titulo: titulo.trim(), data: vencimento },
      )
      avisar({ texto: `Prazo “${titulo.trim()}” criado.` })
      void queryClient.invalidateQueries({ queryKey: ['regras-caso'] })
      onCriado()
    } catch (e) {
      if (ehConflito(e)) {
        void queryClient.invalidateQueries({ queryKey: ['regras-caso'] })
        avisar({ tipo: 'info', texto: 'Outra pessoa já decidiu esta sugestão.' })
        onClose()
        return
      }
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o prazo.')
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Criar prazo pela regra “{item.sugestao.regra.nome}”</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Sugerido a partir da {item.evento.origem === 'publicacao' ? 'publicação' : 'movimentação'} de{' '}
          {formatarDataSimples(item.evento.data)}. Confira o vencimento antes de criar.
        </Dialog.Description>
        <Flex gap="3" mt="4" wrap="wrap">
          <Flex direction="column" gap="1" style={{ flex: '1 1 18rem' }}>
            <Text as="label" size="1" color="gray" htmlFor="regra-prazo-titulo">Título</Text>
            <TextField.Root id="regra-prazo-titulo" value={titulo} maxLength={200} disabled={salvando}
              onChange={e => setTitulo(e.target.value)} aria-label="Título do prazo" />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="regra-prazo-vencimento">Vencimento</Text>
            <TextField.Root id="regra-prazo-vencimento" type="date" value={vencimento} disabled={salvando || calculando}
              onChange={e => setVencimento(e.target.value)} aria-label="Vencimento do prazo" />
          </Flex>
        </Flex>
        {calculando && <Text as="p" size="1" color="gray" mt="3" role="status">Calculando…</Text>}
        {estimativa?.aConfirmar && (
          <Callout.Root color="yellow" size="1" mt="3">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>Data estimada: confira feriados e suspensões do tribunal. {estimativa.fonte}.</Callout.Text>
          </Callout.Root>
        )}
        {erro && (
          <Callout.Root color="red" size="1" mt="3" role="alert">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={salvando || invalido} onClick={() => void criar()}>
            {salvando ? 'Criando…' : 'Criar prazo'}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
