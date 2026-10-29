import Carregamento from '../Carregamento'
import { useState, type FormEvent } from 'react'
import {
  Accordion,
  AccordionItem,
  Button,
  DatePicker,
  DatePickerInput,
  Form,
  InlineNotification,
  NumberInput,
  Stack,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarDdMmAaaa, formatarNumeroCNJ, formatarPercentual, formatarReais } from '../utils/formatadores'

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
    <Stack gap={6}>
      <div>
        <h1>Jurimetria</h1>
        <p>
          Preencha os filtros abaixo e escolha a análise - todas usam a mesma busca no CJPG (julgados de 1º grau do
          TJSP). As demais ideias ao final ainda são só conceitos de próximos passos.
        </p>
      </div>
      <Form onSubmit={(e) => aoEnviar(e, 'benchmark_valor')}>
        <Stack gap={5}>
          <TextInput
            id="jur-termo"
            labelText="Pesquisa livre"
            placeholder="ex.: dano moral"
            autoComplete="off"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          <TextInput
            id="jur-magistrado"
            labelText="Magistrado"
            placeholder="digite o nome…"
            helperText="O nome entra automaticamente entre aspas na pesquisa livre. Obrigatório para o perfil do magistrado."
            autoComplete="off"
            value={magistrado}
            onChange={(e) => setMagistrado(e.target.value)}
          />
          <DatePicker
            datePickerType="range"
            dateFormat="d/m/Y"
            onChange={(datas: Date[]) => {
              const [inicio, fim] = datas
              setDataInicio(inicio ? formatarDdMmAaaa(inicio) : '')
              setDataFim(fim ? formatarDdMmAaaa(fim) : '')
            }}
          >
            <DatePickerInput id="jur-data-inicio" labelText="Data de disponibilização - início" placeholder="dd/mm/aaaa" />
            <DatePickerInput id="jur-data-fim" labelText="Data de disponibilização - fim" placeholder="dd/mm/aaaa" />
          </DatePicker>
          <NumberInput
            id="jur-paginas"
            label="Páginas a buscar (10 resultados cada)"
            min={1}
            max={15}
            value={paginas}
            onChange={(_e, { value }) => setPaginas(Number(value) || 1)}
          />
          <div className="aj-layout-49">
            <Button type="submit" disabled={consultando}>
              Benchmark de valor
            </Button>
            <Button kind="secondary" disabled={consultando} onClick={() => executar('perfil_magistrado')}>
              Perfil do magistrado
            </Button>
          </div>
        </Stack>
      </Form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="cartoes" descricao="Consultando o CJPG — pode levar alguns segundos por página pedida…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && <InlineNotification kind="error" title="Erro" subtitle={resultado.mensagem} lowContrast hideCloseButton />}
        {!consultando && resultado && !resultado.erro && analiseAtual && (
          <Stack gap={5}>
            <h3>Resultado: {TITULO_ANALISE[analiseAtual]}</h3>
            {(resultado.avisos ?? []).map((aviso, i) => (
              <InlineNotification key={i} kind="warning" title="Busca parcial" subtitle={aviso} lowContrast hideCloseButton />
            ))}
            <p>
              Total no servidor: {resultado.total_servidor ?? '?'} | Buscados nesta consulta: {resultado.buscados}
            </p>
            {resultado.agregado && <ResumoAgregado agregado={resultado.agregado} />}
            {resultado.perfil && <ResumoPerfil perfil={resultado.perfil} />}
            {(resultado.resultados ?? []).map((item, i) => (
              <CartaoJurimetria key={i} item={item} />
            ))}
            {!resultado.resultados?.length && (
              <InlineNotification kind="info" title="Nenhum resultado" subtitle="Tente ampliar os filtros ou o termo de busca." lowContrast hideCloseButton />
            )}
          </Stack>
        )}
      </div>
      <Accordion>
        <AccordionItem title={`Análises futuras em estudo (${CONCEITOS_FUTUROS.length} conceitos)`}>
          <p>Ainda são só conceitos de próximos passos, não funcionalidades disponíveis.</p>
          <Stack gap={4}>
            {CONCEITOS_FUTUROS.map((c) => (
              <Tile key={c.titulo}>
                <Tag type="gray" size="sm">
                  Conceito
                </Tag>
                <h4>{c.titulo}</h4>
                <p>{c.texto}</p>
                <p>{c.dados}</p>
              </Tile>
            ))}
          </Stack>
        </AccordionItem>
      </Accordion>
      <p>
        Limitação conhecida: cada consulta ao CJPG tem um teto de ~10.000 resultados (limite do próprio índice de busca
        do TJSP). Estudos em maior volume exigem fatiar a consulta por data ou comarca em várias buscas.
      </p>
    </Stack>
  )
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="aj-layout-50">{children}</div>
}

function CeluaResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Tile className="aj-layout-51">
      <div className="aj-layout-52">{valor}</div>
      <div>{rotulo}</div>
    </Tile>
  )
}

function ResumoAgregado({ agregado }: { agregado: Agregado }) {
  return (
    <Stack gap={3}>
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
      {agregado.aviso && <InlineNotification kind="warning" title="Amostra pequena" subtitle={agregado.aviso} lowContrast hideCloseButton />}
    </Stack>
  )
}

function ResumoPerfil({ perfil }: { perfil: Perfil }) {
  return (
    <Stack gap={3}>
      <Grade>
        {Object.entries(ROTULO_TAXA).map(([chave, rotulo]) => (
          <CeluaResumo key={chave} rotulo={rotulo} valor={formatarPercentual(perfil[chave])} />
        ))}
        <CeluaResumo rotulo="Valor médio de indenização" valor={formatarReais(perfil.valor_medio_indenizacao)} />
        <CeluaResumo rotulo="Decisões classificadas" valor={String(perfil.total_classificados ?? '-')} />
        <CeluaResumo rotulo="Com valor extraído" valor={String(perfil.com_valor_extraido ?? '-')} />
      </Grade>
      {perfil.aviso && <InlineNotification kind="warning" title="Amostra pequena" subtitle={perfil.aviso} lowContrast hideCloseButton />}
    </Stack>
  )
}

function CartaoJurimetria({ item }: { item: ItemResultado }) {
  const [rotuloDesfecho, corDesfecho] = (item.desfecho && ROTULO_DESFECHO[item.desfecho]) || ['Não classificado', 'gray']
  return (
    <Tile>
      <Stack gap={3}>
        <div>
          <Tag type={corDesfecho as 'gray'}>{rotuloDesfecho}</Tag>{' '}
          {item.valor_condenacao != null && <Tag type="purple">{formatarReais(item.valor_condenacao)}</Tag>}
        </div>
        <h3>{formatarNumeroCNJ(item.numero_processo) || 'Número não identificado'}</h3>
        <p>
          {item.classe ?? '?'} / {item.assunto ?? '?'}
        </p>
        <p>
          {item.magistrado ?? '?'} · {item.vara ?? '?'} · {item.comarca ?? '?'} · {item.data_disponibilizacao ?? '?'}
        </p>
        {item.trecho && (
          <Accordion>
            <AccordionItem title="Trecho">
              <p>{item.trecho}</p>
            </AccordionItem>
          </Accordion>
        )}
      </Stack>
    </Tile>
  )
}
