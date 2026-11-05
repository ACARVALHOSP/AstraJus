import Carregamento from '../Carregamento'
import { useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarNumeroCNJ, formatarPercentual, formatarReais } from '../utils/formatadores'

type Analise = 'benchmark_valor' | 'perfil_magistrado'

const TITULO_ANALISE: Record<Analise, string> = {
  benchmark_valor: 'Benchmark de valor',
  perfil_magistrado: 'Perfil do magistrado',
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
  p25?: number
  p75?: number
  aviso?: string
}

type Perfil = Record<string, number | undefined> & {
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

const CONCEITOS_FUTUROS = [
  {
    titulo: 'Due diligence de parte adversa',
    texto: 'Histórico de ações de uma empresa ou pessoa como parte ré: quantidade de processos, teses de defesa usadas e taxa de derrota.',
    dados: 'Dados: busca pelo nome da parte no inteiro teor.',
  },
  {
    titulo: 'Comparação entre comarcas/varas',
    texto:
      'Para a mesma tese jurídica, compara valor de condenação e taxa de procedência entre comarcas diferentes — útil para decidir onde ajuizar quando há competência concorrente.',
    dados: 'Dados: mesma busca repetida variando o filtro de comarca.',
  },
  {
    titulo: 'Rastreamento de tese ao longo do tempo',
    texto:
      'Frequência de uso de uma expressão jurídica (uma súmula, "dano moral in re ipsa" etc.) em janelas de tempo sucessivas, para detectar mudança de entendimento antes de virar tendência visível.',
    dados: 'Dados: mesma busca textual repetida em intervalos de data sucessivos.',
  },
  {
    titulo: 'Ranking de litigância habitual',
    texto: 'Para um assunto específico, conta quantas vezes cada réu aparece nos resultados — identifica quem mais litiga e, cruzando com o desfecho, quem mais perde.',
    dados: 'Dados: busca por assunto + contagem de ocorrências do campo "Requerido".',
  },
  {
    titulo: 'Tempo de tramitação por classe/vara',
    texto: 'Estima a duração média de processos comparando o ano de distribuição (embutido no número do processo) com a data de disponibilização da sentença.',
    dados: 'Dados: já disponíveis nos campos retornados pela busca — não exige extração extra.',
  },
  {
    titulo: 'Taxa de "jurisprudência defensiva"',
    texto: 'Proporção de processos extintos sem resolução de mérito frente aos julgados no mérito, por vara — indicador de quão disposta uma vara está a discutir o fundo da questão.',
    dados: 'Dados: busca por vara + classificação do texto da sentença (extinção vs. mérito).',
  },
]

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
      data_inicio: dataInicio || null,
      data_fim: dataFim || null,
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
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
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
      <div>
        <Heading as="h1" size="6">Jurimetria</Heading>
        <Text as="p" size="2" color="gray" mt="1">
          Preencha os filtros abaixo e escolha a análise - todas usam a mesma busca no CJPG (julgados de 1º grau do
          TJSP). As demais ideias ao final ainda são só conceitos de próximos passos.
        </Text>
      </div>
      <form onSubmit={(e) => aoEnviar(e, 'benchmark_valor')}>
        <Flex direction="column" gap="5">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="jur-termo">Pesquisa livre</label>
            <TextField.Root id="jur-termo" placeholder="ex.: dano moral" autoComplete="off" value={termo} onChange={(e) => setTermo(e.target.value)} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="jur-magistrado">Magistrado</label>
            <TextField.Root id="jur-magistrado" placeholder="digite o nome…" autoComplete="off" value={magistrado} onChange={(e) => setMagistrado(e.target.value)} />
            <Text size="1" color="gray">O nome entra automaticamente entre aspas na pesquisa livre. Obrigatório para o perfil do magistrado.</Text>
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="jur-data-inicio">Data de disponibilização - início</label>
              <TextField.Root id="jur-data-inicio" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="jur-data-fim">Data de disponibilização - fim</label>
              <TextField.Root id="jur-data-fim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="jur-paginas">Páginas a buscar (10 resultados cada)</label>
              <TextField.Root id="jur-paginas" type="number" min={1} max={15} value={paginas} onChange={(e) => setPaginas(Number(e.target.value) || 1)} />
            </div>
          </div>
          <div className="aj-acoes-linha">
            <Button size="2" type="submit" disabled={consultando}>
              Benchmark de valor
            </Button>
            <Button size="2" variant="soft" disabled={consultando} onClick={() => executar('perfil_magistrado')}>
              Perfil do magistrado
            </Button>
          </div>
        </Flex>
      </form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="cartoes" descricao="Consultando o CJPG — pode levar alguns segundos por página pedida…" />}
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
              Total no servidor: {resultado.total_servidor ?? '?'} | Buscados nesta consulta: {resultado.buscados}
            </Text>
            {resultado.agregado && <ResumoAgregado agregado={resultado.agregado} />}
            {resultado.perfil && <ResumoPerfil perfil={resultado.perfil} />}
            {(resultado.resultados ?? []).map((item, i) => (
              <CartaoJurimetria key={i} item={item} />
            ))}
            {!resultado.resultados?.length && (
              <Callout.Root color="blue" size="1">
                <Callout.Text>Nenhum resultado. Tente ampliar os filtros ou o termo de busca.</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        )}
      </div>
      <details>
        <summary>Análises futuras em estudo ({CONCEITOS_FUTUROS.length} conceitos)</summary>
        <Flex direction="column" gap="4" mt="3">
          <Text as="p" size="2">Ainda são só conceitos de próximos passos, não funcionalidades disponíveis.</Text>
          {CONCEITOS_FUTUROS.map((c) => (
            <Card key={c.titulo} variant="surface">
              <Flex direction="column" gap="2">
                <Badge color="gray" size="1" style={{ alignSelf: 'flex-start' }}>Conceito</Badge>
                <Heading as="h4" size="2">{c.titulo}</Heading>
                <Text as="p" size="2">{c.texto}</Text>
                <Text as="p" size="2" color="gray">{c.dados}</Text>
              </Flex>
            </Card>
          ))}
        </Flex>
      </details>
      <Text as="p" size="2" color="gray">
        Limitação conhecida: cada consulta ao CJPG tem um teto de ~10.000 resultados (limite do próprio índice de busca
        do TJSP). Estudos em maior volume exigem fatiar a consulta por data ou comarca em várias buscas.
      </Text>
    </Flex>
  )
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="aj-form-grade">{children}</div>
}

function CeluaResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card variant="surface">
      <Flex direction="column" gap="1">
        <Text size="5" weight="bold">{valor}</Text>
        <Text size="2" color="gray">{rotulo}</Text>
      </Flex>
    </Card>
  )
}

function ResumoAgregado({ agregado }: { agregado: Agregado }) {
  return (
    <Flex direction="column" gap="3">
      <Grade>
        <CeluaResumo rotulo="Procedentes/parciais" valor={String(agregado.procedentes_ou_parciais)} />
        <CeluaResumo rotulo="Com valor extraído" valor={String(agregado.com_valor_extraido)} />
        {agregado.mediana !== undefined && (
          <>
            <CeluaResumo rotulo="Mediana" valor={formatarReais(agregado.mediana)} />
            <CeluaResumo rotulo="P25" valor={formatarReais(agregado.p25)} />
            <CeluaResumo rotulo="P75" valor={formatarReais(agregado.p75)} />
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
        {Object.entries(ROTULO_TAXA).map(([chave, rotulo]) => (
          <CeluaResumo key={chave} rotulo={rotulo} valor={formatarPercentual(perfil[chave])} />
        ))}
        <CeluaResumo rotulo="Valor médio de indenização" valor={formatarReais(perfil.valor_medio_indenizacao)} />
        <CeluaResumo rotulo="Decisões classificadas" valor={String(perfil.total_classificados ?? '-')} />
        <CeluaResumo rotulo="Com valor extraído" valor={String(perfil.com_valor_extraido ?? '-')} />
      </Grade>
      {perfil.aviso && (
        <Callout.Root color="yellow" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{perfil.aviso}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}

function CartaoJurimetria({ item }: { item: ItemResultado }) {
  const [rotuloDesfecho, corDesfecho] = (item.desfecho && ROTULO_DESFECHO[item.desfecho]) || ['Não classificado', 'gray']
  return (
    <Card variant="surface">
      <Flex direction="column" gap="3">
        <Flex gap="2">
          <Badge color={corDesfecho as 'gray'}>{rotuloDesfecho}</Badge>
          {item.valor_condenacao != null && <Badge color="purple">{formatarReais(item.valor_condenacao)}</Badge>}
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
