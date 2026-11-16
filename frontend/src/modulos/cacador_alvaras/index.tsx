import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Search } from 'lucide-react'
import { Badge, Button, Callout, Card, Flex, Select, Text } from '@radix-ui/themes'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { ErroMCP } from '../../api/mcpClient'
import { formatarNumeroCNJ, formatarReais, isoParaDdMmAaaa } from '../../utils/formatadores'

type Situacao = 'expedido' | 'determinado' | 'providencia_parte' | 'indeferido' | 'mencao'

type Alvara = {
  hash: string
  numero_processo: string | null
  tribunal: string
  orgao: string
  data: string
  situacao: Situacao
  confianca: number
  faixa: 'alta' | 'revisar' | 'baixa'
  valor: number | null
  origem: 'jev' | 'regex'
  fallback_motivo?: string
  trechos?: string[]
}

type Lista = { alvaras: Alvara[]; resumo: Record<string, number>; situacoes: Record<string, string>; jev_disponivel: boolean }
type Rodada = { analisadas: number; encontradas: number; via_jev: number; via_regex: number; falhas_jev: number; motivo_fallback: string | null }

const ROTULO: Record<Situacao, [string, 'green' | 'blue' | 'amber' | 'red' | 'gray']> = {
  expedido: ['Expedido', 'green'],
  determinado: ['Determinado', 'blue'],
  providencia_parte: ['Aguarda dados da parte', 'amber'],
  indeferido: ['Indeferido', 'red'],
  mencao: ['Apenas citado', 'gray'],
}

export default function CacadorAlvaras() {
  const { cliente } = useCliente()
  const [situacao, setSituacao] = useState('todas')
  const [lista, setLista] = useState<Lista | null>(null)
  const [rodada, setRodada] = useState<Rodada | null>(null)
  const [erro, setErro] = useState('')
  const [cacando, setCacando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const filtro = situacao === 'todas' ? '' : `?situacao=${situacao}`
      setLista(await buscarJson<Lista>(cliente, `/alvaras/cacador${filtro}`))
      setErro('')
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível carregar os alvarás.')
    }
  }, [cliente, situacao])

  useEffect(() => { void carregar() }, [carregar])

  async function cacar() {
    setCacando(true)
    try {
      setRodada(await enviarJson<Rodada>(cliente, '/alvaras/cacador/cacar', { limite: 300 }))
      await carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível caçar alvarás agora.')
    } finally {
      setCacando(false)
    }
  }

  return (
    <Flex direction="column" gap="4">
      <CabecalhoPagina
        titulo="Caçador de alvarás"
        descricao="Procura nas publicações recebidas alvarás e levantamentos de valores. São sugestões para leitura: confira sempre o texto da publicação."
        acoes={<Button onClick={cacar} loading={cacando}><Search size={16} aria-hidden="true" /> Caçar agora</Button>}
      />
      {erro && <Callout.Root color="red" role="alert"><Callout.Icon><AlertTriangle size={16} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {lista && !lista.jev_disponivel && (
        <Callout.Root color="gray"><Callout.Text>Sem integração OpenRouter ativa: a busca usa só regras de texto (regex). Com a integração, o Jev refina a situação e o valor.</Callout.Text></Callout.Root>
      )}
      {rodada && (
        <Callout.Root color={rodada.falhas_jev ? 'amber' : 'green'} role="status">
          <Callout.Text>
            {rodada.analisadas} publicação(ões) analisada(s), {rodada.encontradas} com alvará ({rodada.via_jev} pelo Jev, {rodada.via_regex} por regex).
            {rodada.falhas_jev > 0 && ` O Jev falhou em ${rodada.falhas_jev} e o regex assumiu: ${rodada.motivo_fallback ?? ''}`}
          </Callout.Text>
        </Callout.Root>
      )}
      <Flex gap="3" align="center">
        <Text size="2" color="gray" as="label" htmlFor="filtro-situacao">Situação</Text>
        <Select.Root value={situacao} onValueChange={setSituacao}>
          <Select.Trigger id="filtro-situacao" />
          <Select.Content>
            <Select.Item value="todas">Todas{lista ? ` (${Object.values(lista.resumo).reduce((a, b) => a + b, 0)})` : ''}</Select.Item>
            {(Object.keys(ROTULO) as Situacao[]).map((s) => (
              <Select.Item key={s} value={s}>{ROTULO[s][0]}{lista?.resumo[s] ? ` (${lista.resumo[s]})` : ''}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      {!lista && !erro ? <Carregamento tipo="cartoes" descricao="Carregando alvarás…" /> : lista && lista.alvaras.length === 0 ? (
        <Text color="gray">Nenhum alvará encontrado ainda. Use “Caçar agora” para analisar as publicações recebidas.</Text>
      ) : (
        <Flex direction="column" gap="3">
          {lista?.alvaras.map((a) => (
            <Card key={a.hash}>
              <Flex direction="column" gap="2">
                <Flex gap="2" align="center" wrap="wrap">
                  <Badge color={ROTULO[a.situacao][1]}>{ROTULO[a.situacao][0]}</Badge>
                  <Badge variant="soft" color={a.origem === 'jev' ? 'violet' : 'gray'} title={a.fallback_motivo}>{a.origem === 'jev' ? 'Jev' : a.fallback_motivo ? 'Regex (Jev falhou)' : 'Regex'}</Badge>
                  {a.faixa === 'alta' ? null : <Badge variant="outline" color="amber">Revisar</Badge>}
                  {a.valor != null && <Text weight="bold">{formatarReais(a.valor)}</Text>}
                </Flex>
                <Text size="2" color="gray">
                  {a.numero_processo ? formatarNumeroCNJ(a.numero_processo) : 'Sem número'} · {a.tribunal}{a.orgao ? ` · ${a.orgao}` : ''}{a.data ? ` · ${isoParaDdMmAaaa(a.data)}` : ''}
                </Text>
                {a.trechos?.[0] && <Text size="2" as="p">“…{a.trechos[0]}…”</Text>}
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  )
}
