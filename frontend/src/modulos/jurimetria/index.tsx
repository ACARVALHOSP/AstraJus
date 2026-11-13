import CampoData from '../../CampoData'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import { useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { Badge, Button, Callout, Card, Checkbox, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import Paginacao, { POR_PAGINA } from '../../Paginacao'
import { baixarCsv, type ColunaCsv } from '../../utils/csv'
import { chaveParaData, contarDesfechos, ehAtipico, histograma, intervaloWilson, resumirValores, serieMensal, valoresDeCondenacao } from './estatisticas'
import { GraficoDesfechos, GraficoHistograma, GraficoSerieMensal } from './graficos'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { formatarNumeroCNJ, formatarPercentual, formatarReais, isoParaDdMmAaaa } from '../../utils/formatadores'

type Analise = 'benchmark_valor' | 'perfil_magistrado'

// Quantas páginas do CJPG buscar (10 sentenças por página), descritas em sentenças.
const QUANTIDADES: [number, string][] = [[1, '10 sentenças (mais rápido)'], [3, '30 sentenças'], [5, '50 sentenças'], [10, '100 sentenças'], [15, '150 sentenças (mais lento)']]

const TITULO_ANALISE: Record<Analise, string> = {
  benchmark_valor: 'Quanto se costuma conceder',
  perfil_magistrado: 'Como este juiz costuma decidir',
}

const ROTULO_DESFECHO: Record<string, [string, string]> = {
  procedente: ['Procedente', 'green'],
  parcial: ['Parcialmente procedente', 'teal'],
  improcedente: ['Improcedente', 'red'],
  acordo: ['Acordo homologado', 'blue'],
  extinto: ['Extinto sem mérito', 'gray'],
}

const ROTULO_TAXA: Record<string, string> = {
  taxa_procedente: 'Procedente',
  taxa_parcial: 'Parcialmente procedente',
  taxa_improcedente: 'Improcedente',
  taxa_acordo: 'Acordo homologado',
  taxa_extinto: 'Extinto sem mérito',
}

type ItemResultado = {
  desfecho?: string
  valor_condenacao?: number | null
  numero_processo?: string
  classe?: string
  assunto?: string
  magistrado?: string
  vara?: string
  comarca?: string
  data_disponibilizacao?: string
  trecho?: string
}

type Agregado = {
  procedentes_ou_parciais: number
  com_valor_extraido: number
  mediana?: number
  outliers?: number
  p25?: number
  p75?: number
  aviso?: string
}

type Perfil = Record<string, number | number[] | string | null | undefined> & {
  valor_mediano_indenizacao?: number | null
  valor_medio_indenizacao?: number
  total_classificados?: number
  com_valor_extraido?: number
  aviso?: string
}

type RespostaJurimetria = {
  erro?: boolean
  mensagem?: string
  avisos?: string[]
  total_servidor?: number
  buscados?: number
  agregado?: Agregado
  perfil?: Perfil
  resultados?: ItemResultado[]
}


export default function Jurimetria() {
  const { cliente } = useCliente()
  const [termo, setTermo] = useState('')
  const [magistrado, setMagistrado] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [paginas, setPaginas] = useState(1)

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaJurimetria | null>(null)
  const [analiseAtual, setAnaliseAtual] = useState<Analise | null>(null)

  async function executar(analise: Analise) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    const comuns = {
      termo: termo.trim() || null,
      magistrado_nome: magistrado.trim() || null,
      magistrado_codigo: null,
      data_inicio: isoParaDdMmAaaa(dataInicio),
      data_fim: isoParaDdMmAaaa(dataFim),
      paginas: paginas || 1,
      vara_codigo: null,
      classe_codigo: null,
      assunto_codigo: null,
    }
    if (analise === 'perfil_magistrado' && !comuns.magistrado_nome) {
      setErro('Informe o magistrado.')
      return
    }
    setConsultando(true)
    setErro(null)
    setResultado(null)
    setAnaliseAtual(analise)
    try {
      const dados = (await cliente.chamarFerramenta(
        analise === 'perfil_magistrado' ? 'perfil_decisorio_magistrado' : 'consultar_jurimetria_cjpg',
        comuns,
      )) as RespostaJurimetria
      setResultado(dados)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível concluir a consulta. Tente de novo.')
    } finally {
      setConsultando(false)
    }
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>, analise: Analise) {
    evento.preventDefault()
    executar(analise)
  }

  return (
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Jurimetria"
        descricao="Números das sentenças de 1º grau do TJSP para responder a duas perguntas: quanto se costuma conceder e como um juiz costuma decidir."
      />
      <form onSubmit={(e) => aoEnviar(e, 'benchmark_valor')}>
        <Flex direction="column" gap="5">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="jur-termo">Assunto</label>
            <TextField.Root id="jur-termo" placeholder="Ex.: dano moral por negativação indevida" autoComplete="off" value={termo} onChange={(e) => setTermo(e.target.value)} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="jur-magistrado">Juiz (opcional)</label>
            <TextField.Root id="jur-magistrado" placeholder="Nome do juiz ou juíza" autoComplete="off" value={magistrado} onChange={(e) => setMagistrado(e.target.value)} />
            <Text size="1" color="gray">Necessário para &quot;Como este juiz costuma decidir?&quot;. Na outra pergunta, limita as sentenças a esse juiz.</Text>
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="jur-data-inicio">Sentenças publicadas de</label>
              <CampoData id="jur-data-inicio" value={dataInicio} onChange={v => setDataInicio(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="jur-data-fim">até</label>
              <CampoData id="jur-data-fim" value={dataFim} onChange={v => setDataFim(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" id="jur-quantidade-rotulo">Analisar até</label>
              <Select.Root value={String(paginas)} onValueChange={v => setPaginas(Number(v))}>
                <Select.Trigger aria-labelledby="jur-quantidade-rotulo" style={{ width: '100%' }} />
                <Select.Content>
                  {QUANTIDADES.map(([n, rotulo]) => <Select.Item key={n} value={String(n)}>{rotulo}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <div className="aj-acoes-linha">
            <Button size="2" type="submit" disabled={consultando}>
              Quanto se costuma conceder?
            </Button>
            <Button size="2" variant="soft" disabled={consultando} onClick={() => executar('perfil_magistrado')}>
              Como este juiz costuma decidir?
            </Button>
          </div>
        </Flex>
      </form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="cartoes" descricao="Buscando sentenças no TJSP; quanto mais sentenças, mais demora…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {resultado?.erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{resultado.mensagem}</Callout.Text>
          </Callout.Root>
        )}
        {!consultando && resultado && !resultado.erro && analiseAtual && (
          <Flex direction="column" gap="5">
            <Heading as="h3" size="4">Resultado: {TITULO_ANALISE[analiseAtual]}</Heading>
            {(resultado.avisos ?? []).map((aviso, i) => (
              <Callout.Root key={i} color="yellow" size="1">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{aviso}</Callout.Text>
              </Callout.Root>
            ))}
            <Text size="2">
              {resultado.total_servidor != null ? `${resultado.total_servidor.toLocaleString('pt-BR')} sentenças encontradas; ` : ''}
              {resultado.buscados} analisadas nesta consulta.
            </Text>
            <PainelResultado resultado={resultado} analise={analiseAtual} />
            {!resultado.resultados?.length && (
              <Callout.Root color="blue" size="1">
                <Callout.Text>Nenhum resultado. Tente ampliar os filtros ou o termo de busca.</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        )}
      </div>
      <details className="aj-sobre-fonte">
        <summary>Como funciona</summary>
        <Text as="p" size="2" color="gray">
          As duas perguntas usam a busca de sentenças de 1º grau do TJSP (CJPG). &quot;Quanto se costuma conceder?&quot;
          lê os valores das sentenças encontradas e mostra a mediana e a faixa mais comum. &quot;Como este juiz costuma
          decidir?&quot; conta os resultados das sentenças do juiz informado. A busca do tribunal devolve no máximo cerca
          de 10.000 sentenças por consulta; para estudos maiores, divida por período.
        </Text>
      </details>
    </Flex>
  )
}

type Ordenacao = 'recentes' | 'maior_valor' | 'menor_valor' | 'desfecho'

const ROTULO_ORDENACAO: Record<Ordenacao, string> = {
  recentes: 'Mais recentes primeiro',
  maior_valor: 'Maior valor primeiro',
  menor_valor: 'Menor valor primeiro',
  desfecho: 'Por desfecho',
}

const ORDEM_DESFECHO = ['procedente', 'parcial', 'acordo', 'improcedente', 'extinto']

const COLUNAS_CSV = (consideradas: Set<number>, atipicas: Set<number>, indices: Map<ItemResultado, number>): ColunaCsv<ItemResultado>[] => [
  { titulo: 'Processo', valor: i => formatarNumeroCNJ(i.numero_processo) },
  { titulo: 'Desfecho', valor: i => (i.desfecho && ROTULO_DESFECHO[i.desfecho]?.[0]) || 'Não classificado' },
  { titulo: 'Valor da condenação', valor: i => i.valor_condenacao },
  { titulo: 'Classe', valor: i => i.classe },
  { titulo: 'Assunto', valor: i => i.assunto },
  { titulo: 'Magistrado', valor: i => i.magistrado },
  { titulo: 'Vara', valor: i => i.vara },
  { titulo: 'Comarca', valor: i => i.comarca },
  { titulo: 'Data de disponibilização', valor: i => i.data_disponibilizacao },
  { titulo: 'Valor atípico', valor: i => (atipicas.has(indices.get(i) ?? -1) ? 'Sim' : 'Não') },
  { titulo: 'Considerada nos cálculos', valor: i => (consideradas.has(indices.get(i) ?? -1) ? 'Sim' : 'Não') },
]

function avisoLocal(n: number, rotulo: string): string | undefined {
  if (n < 5) return `Amostra muito pequena (menos de 5 ${rotulo}) - interprete com muita cautela.`
  if (n < 30) return `Amostra pequena (menos de 30 ${rotulo}) - os números são indicativos, não conclusivos.`
  return undefined
}

function PainelResultado({ resultado, analise }: { resultado: RespostaJurimetria; analise: Analise }) {
  const itens = useMemo(() => resultado.resultados ?? [], [resultado])
  const [desconsideradas, setDesconsideradas] = useState<Set<number>>(new Set())
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('recentes')
  const [pagina, setPagina] = useState(1)

  const indices = useMemo(() => new Map(itens.map((item, i) => [item, i])), [itens])
  // Valores atípicos são medidos sobre todas as sentenças buscadas, para não mudarem ao desconsiderar.
  const atipicas = useMemo(() => {
    const resumoTotal = resumirValores(valoresDeCondenacao(itens))
    return new Set(
      itens
        .map((item, i) => ((item.desfecho === 'procedente' || item.desfecho === 'parcial') && item.valor_condenacao != null && ehAtipico(item.valor_condenacao, resumoTotal) ? i : -1))
        .filter(i => i >= 0),
    )
  }, [itens])
  const consideradas = useMemo(() => new Set(itens.map((_, i) => i).filter(i => !desconsideradas.has(i))), [itens, desconsideradas])
  const itensConsiderados = useMemo(() => itens.filter((_, i) => consideradas.has(i)), [itens, consideradas])

  const { contagens, classificados } = useMemo(() => contarDesfechos(itensConsiderados), [itensConsiderados])
  const valores = useMemo(() => valoresDeCondenacao(itensConsiderados), [itensConsiderados])
  const resumoValores = useMemo(() => resumirValores(valores), [valores])
  const faixas = useMemo(() => histograma(valores), [valores])
  const pontos = useMemo(() => serieMensal(itensConsiderados), [itensConsiderados])

  const recalculado = desconsideradas.size > 0
  const agregado: Agregado | undefined = recalculado && analise === 'benchmark_valor'
    ? {
        procedentes_ou_parciais: contagens.procedente + contagens.parcial,
        com_valor_extraido: valores.length,
        mediana: resumoValores?.mediana,
        p25: resumoValores?.p25,
        p75: resumoValores?.p75,
        aviso: avisoLocal(valores.length, 'valores extraídos'),
      }
    : resultado.agregado
  const perfil: Perfil | undefined = recalculado && analise === 'perfil_magistrado'
    ? {
        total_classificados: classificados,
        com_valor_extraido: valores.length,
        valor_mediano_indenizacao: resumoValores?.mediana ?? null,
        aviso: avisoLocal(classificados, 'decisões classificadas'),
        ...Object.fromEntries(Object.keys(ROTULO_TAXA).flatMap(chave => {
          const desfecho = chave.replace('taxa_', '') as keyof typeof contagens
          const ic = intervaloWilson(contagens[desfecho], classificados)
          return [[chave, classificados ? contagens[desfecho] / classificados : null], [chave.replace('taxa_', 'ic_'), ic]]
        })),
      }
    : resultado.perfil

  const ordenadas = useMemo(() => {
    const lista = itens.map((item, i) => ({ item, i }))
    const valorDe = (x: { item: ItemResultado }) => x.item.valor_condenacao
    if (ordenacao === 'recentes') lista.sort((a, b) => chaveParaData(b.item.data_disponibilizacao) - chaveParaData(a.item.data_disponibilizacao))
    else if (ordenacao === 'desfecho') lista.sort((a, b) => ORDEM_DESFECHO.indexOf(a.item.desfecho ?? '') - ORDEM_DESFECHO.indexOf(b.item.desfecho ?? ''))
    else {
      const sinal = ordenacao === 'maior_valor' ? -1 : 1
      lista.sort((a, b) => {
        const va = valorDe(a)
        const vb = valorDe(b)
        if (va == null && vb == null) return 0
        if (va == null) return 1 // sem valor sempre no fim
        if (vb == null) return -1
        return sinal * (va - vb)
      })
    }
    return lista
  }, [itens, ordenacao])
  const paginaAtual = Math.min(pagina, Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA)))
  const visiveis = ordenadas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  function alternar(i: number) {
    setDesconsideradas(atual => {
      const novo = new Set(atual)
      if (novo.has(i)) novo.delete(i)
      else novo.add(i)
      return novo
    })
  }

  if (itens.length === 0) return null
  return (
    <Flex direction="column" gap="5">
      {recalculado && (
        <Callout.Root color="blue" size="1">
          <Callout.Text>Números e gráficos recalculados sem {desconsideradas.size} sentença(s) desconsiderada(s).</Callout.Text>
        </Callout.Root>
      )}
      {agregado && <ResumoAgregado agregado={agregado} />}
      {perfil && <ResumoPerfil perfil={perfil} />}
      <Flex direction="column" gap="5">
        <GraficoDesfechos contagens={contagens} total={classificados} />
        <GraficoHistograma faixas={faixas} resumo={resumoValores} />
        <GraficoSerieMensal pontos={pontos} />
      </Flex>
      <Flex align="end" gap="3" wrap="wrap">
        <div className="form-campo">
          <label className="form-campo-label" id="jur-ordenacao-rotulo">Ordenar sentenças</label>
          <Select.Root value={ordenacao} onValueChange={v => { setOrdenacao(v as Ordenacao); setPagina(1) }}>
            <Select.Trigger aria-labelledby="jur-ordenacao-rotulo" />
            <Select.Content>
              {(Object.keys(ROTULO_ORDENACAO) as Ordenacao[]).map(o => <Select.Item key={o} value={o}>{ROTULO_ORDENACAO[o]}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        <Button size="2" variant="soft" disabled={atipicas.size === 0} onClick={() => setDesconsideradas(new Set([...desconsideradas, ...atipicas]))}>
          Desconsiderar valores atípicos ({atipicas.size})
        </Button>
        <Button size="2" variant="soft" color="gray" disabled={!recalculado} onClick={() => setDesconsideradas(new Set())}>
          Considerar todas
        </Button>
        <Button size="2" variant="soft" color="gray" onClick={() => baixarCsv('jurimetria', COLUNAS_CSV(consideradas, atipicas, indices), itens)}>
          <Download size={14} aria-hidden /> Exportar CSV
        </Button>
      </Flex>
      {visiveis.map(({ item, i }) => (
        <CartaoJurimetria key={i} item={item} considerada={consideradas.has(i)} atipico={atipicas.has(i)} onAlternar={() => alternar(i)} />
      ))}
      <Paginacao pagina={paginaAtual} total={ordenadas.length} onPagina={setPagina} nome="sentenças" />
    </Flex>
  )
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="aj-form-grade">{children}</div>
}

function CeluaResumo({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <Card variant="surface">
      <Flex direction="column" gap="1">
        <Text size="5" weight="bold">{valor}</Text>
        <Text size="2" color="gray">{rotulo}</Text>
        {detalhe && <Text size="1" color="gray">{detalhe}</Text>}
      </Flex>
    </Card>
  )
}

function ResumoAgregado({ agregado }: { agregado: Agregado }) {
  return (
    <Flex direction="column" gap="3">
      <Grade>
        <CeluaResumo rotulo="Procedentes/parciais" valor={String(agregado.procedentes_ou_parciais)} />
        <CeluaResumo rotulo="Sentenças com valor identificado" valor={String(agregado.com_valor_extraido)} />
        {agregado.mediana !== undefined && (
          <>
            <CeluaResumo rotulo="Valor típico (mediana)" valor={formatarReais(agregado.mediana)} />
            <CeluaResumo rotulo="1 em cada 4 sentenças fica abaixo de" valor={formatarReais(agregado.p25)} />
            <CeluaResumo rotulo="3 em cada 4 sentenças ficam abaixo de" valor={formatarReais(agregado.p75)} />
          </>
        )}
      </Grade>
      {agregado.aviso && (
        <Callout.Root color="yellow" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{agregado.aviso}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}

function ResumoPerfil({ perfil }: { perfil: Perfil }) {
  return (
    <Flex direction="column" gap="3">
      <Grade>
        {Object.entries(ROTULO_TAXA).map(([chave, rotulo]) => {
          const ic = perfil[chave.replace('taxa_', 'ic_')]
          const faixa = Array.isArray(ic) && ic.length === 2
            ? `Margem de erro: ${formatarPercentual(ic[0])} a ${formatarPercentual(ic[1])}`
            : undefined
          return <CeluaResumo key={chave} rotulo={rotulo} valor={formatarPercentual(perfil[chave] as number | undefined)} detalhe={faixa} />
        })}
        <CeluaResumo rotulo="Valor típico de indenização (mediana)" valor={formatarReais(perfil.valor_mediano_indenizacao ?? perfil.valor_medio_indenizacao)} />
        <CeluaResumo rotulo="Decisões classificadas" valor={String(perfil.total_classificados ?? '-')} />
        <CeluaResumo rotulo="Sentenças com valor identificado" valor={String(perfil.com_valor_extraido ?? '-')} />
      </Grade>
      {typeof perfil.aviso === 'string' && perfil.aviso && (
        <Callout.Root color="yellow" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{perfil.aviso}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}

function CartaoJurimetria({ item, considerada, atipico, onAlternar }: { item: ItemResultado; considerada: boolean; atipico: boolean; onAlternar: () => void }) {
  const [rotuloDesfecho, corDesfecho] = (item.desfecho && ROTULO_DESFECHO[item.desfecho]) || ['Não classificado', 'gray']
  return (
    <Card variant="surface" style={considerada ? undefined : { opacity: 0.6 }}>
      <Flex direction="column" gap="3">
        <Flex gap="2" align="center" wrap="wrap">
          <Badge color={corDesfecho as 'gray'}>{rotuloDesfecho}</Badge>
          {item.valor_condenacao != null && <Badge color="purple">{formatarReais(item.valor_condenacao)}</Badge>}
          {atipico && <Badge color="amber">Valor atípico</Badge>}
          <Text as="label" size="2" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Checkbox checked={considerada} onCheckedChange={onAlternar} aria-label={`Considerar o processo ${formatarNumeroCNJ(item.numero_processo) || 'sem número'} nos cálculos`} />
            Considerar nos cálculos
          </Text>
        </Flex>
        <Heading as="h3" size="3">{formatarNumeroCNJ(item.numero_processo) || 'Número não identificado'}</Heading>
        <Text size="2">
          {item.classe ?? '?'} / {item.assunto ?? '?'}
        </Text>
        <Text size="2">
          {item.magistrado ?? '?'} · {item.vara ?? '?'} · {item.comarca ?? '?'} · {item.data_disponibilizacao ?? '?'}
        </Text>
        {item.trecho && (
          <details>
            <summary>Trecho</summary>
            <Text as="p" size="2" mt="2">{item.trecho}</Text>
          </details>
        )}
      </Flex>
    </Card>
  )
}
