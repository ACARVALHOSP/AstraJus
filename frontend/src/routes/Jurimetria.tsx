import CampoData from '../CampoData'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, Callout, Card, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarNumeroCNJ, formatarPercentual, formatarReais, isoParaDdMmAaaa } from '../utils/formatadores'

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
        {Object.entries(ROTULO_TAXA).map(([chave, rotulo]) => (
          <CeluaResumo key={chave} rotulo={rotulo} valor={formatarPercentual(perfil[chave])} />
        ))}
        <CeluaResumo rotulo="Valor médio de indenização" valor={formatarReais(perfil.valor_medio_indenizacao)} />
        <CeluaResumo rotulo="Decisões classificadas" valor={String(perfil.total_classificados ?? '-')} />
        <CeluaResumo rotulo="Sentenças com valor identificado" valor={String(perfil.com_valor_extraido ?? '-')} />
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
