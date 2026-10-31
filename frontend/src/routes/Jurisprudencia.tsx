import Carregamento from '../Carregamento'
import { useRef, useState, type FormEvent } from 'react'
import {
  Button,
  Column,
  DatePicker,
  DatePickerInput,
  Dropdown,
  FilterableMultiSelect,
  Form,
  Grid,
  InlineNotification,
  Stack,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarDataSimples, formatarDdMmAaaa } from '../utils/formatadores'

type BuscarEm = 'ementa' | 'inteiro_teor' | 'ambos'
type OpcaoBuscarEm = { id: BuscarEm; label: string }

const OPCOES_BUSCAR_EM: OpcaoBuscarEm[] = [
  { id: 'ementa', label: 'Ementa' },
  { id: 'inteiro_teor', label: 'Inteiro teor' },
  { id: 'ambos', label: 'Ementa e inteiro teor' },
]

type Ordenacao = 'recente' | 'antiga' | 'relevancia'
type OpcaoOrdenacao = { id: Ordenacao; label: string }

const OPCOES_ORDENACAO: OpcaoOrdenacao[] = [
  { id: 'recente', label: 'Mais recente' },
  { id: 'antiga', label: 'Mais antiga' },
  { id: 'relevancia', label: 'Relevância' },
]

type ComarcaDisponivel = { comarca: string; quantidade: string }

type ResultadoJurisprudencia = {
  cdJurisprudencia?: number
  cdAcordao?: number
  classe?: string
  relator?: string
  comarca?: string
  orgao_julgador?: string
  data_julgamento?: string
  ementa?: string
  trecho_destacado_html?: string | null
  segredo_justica?: boolean
  pdf_url?: string | null
}

type RespostaJurisprudencia = {
  erro?: boolean
  mensagem?: string
  total_servidor?: number
  pagina?: number
  tamanho_pagina?: number
  resultados?: ResultadoJurisprudencia[]
  comarcas_disponiveis?: ComarcaDisponivel[]
}

type FiltrosAtivos = {
  relator: string
  classe: string
  comarcas: string[]
  orgaoJulgador: string
  dataInicio: string
  dataFim: string
}

export default function Jurisprudencia() {
  const { cliente } = useCliente()
  const [termo, setTermo] = useState('')
  const [termoTocado, setTermoTocado] = useState(false)
  const [buscarEm, setBuscarEm] = useState<BuscarEm>('ementa')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [relator, setRelator] = useState('')
  const [classe, setClasse] = useState('')
  const [comarcasSelecionadas, setComarcasSelecionadas] = useState<string[]>([])
  const [orgaoJulgador, setOrgaoJulgador] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('recente')
  const [pagina, setPagina] = useState(1)
  const [filtrosAtivos, setFiltrosAtivos] = useState<FiltrosAtivos | null>(null)

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaJurisprudencia | null>(null)
  // Opções de comarca só existem após a primeira busca: a própria API do TJSP só devolve as
  // facetas (com contagem) na resposta de uma pesquisa já feita.
  const [comarcasDisponiveis, setComarcasDisponiveis] = useState<ComarcaDisponivel[]>([])

  // Descarta respostas de pesquisas superadas: um clique rápido em "Próxima"/"Anterior" não
  // deve deixar uma página antiga sobrescrever o resultado de uma busca mais recente.
  const requisicaoAtual = useRef(0)

  async function executar(paginaAlvo: number) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    if (!termo.trim()) {
      setTermoTocado(true)
      setErro('Informe o termo de pesquisa.')
      return
    }
    const idRequisicao = ++requisicaoAtual.current
    setConsultando(true)
    setErro(null)
    setPagina(paginaAlvo)
    try {
      const dados = (await cliente.chamarFerramenta('consultar_jurisprudencia_tjsp', {
        termo: termo.trim(),
        buscar_em: buscarEm,
        data_julgamento_inicio: dataInicio || null,
        data_julgamento_fim: dataFim || null,
        relator: relator.trim() || null,
        classe: classe.trim() || null,
        comarcas: comarcasSelecionadas,
        orgao_julgador: orgaoJulgador.trim() || null,
        ordenacao,
        pagina: paginaAlvo,
      })) as RespostaJurisprudencia
      if (idRequisicao !== requisicaoAtual.current) return
      setResultado(dados)
      setComarcasDisponiveis(dados.comarcas_disponiveis ?? [])
      setFiltrosAtivos({ relator: relator.trim(), classe: classe.trim(), comarcas: comarcasSelecionadas, orgaoJulgador: orgaoJulgador.trim(), dataInicio, dataFim })
    } catch (e) {
      if (idRequisicao !== requisicaoAtual.current) return
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
    } finally {
      if (idRequisicao === requisicaoAtual.current) setConsultando(false)
    }
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    executar(1)
  }

  const totalPaginas = resultado?.total_servidor
    ? Math.ceil(resultado.total_servidor / (resultado.tamanho_pagina || 10))
    : 0

  const tagsFiltros = filtrosAtivos
    ? [
        filtrosAtivos.relator && `Relator(a): ${filtrosAtivos.relator}`,
        filtrosAtivos.classe && `Classe: ${filtrosAtivos.classe}`,
        filtrosAtivos.comarcas.length > 0 && `Comarca(s): ${filtrosAtivos.comarcas.join(', ')}`,
        filtrosAtivos.orgaoJulgador && `Órgão julgador: ${filtrosAtivos.orgaoJulgador}`,
        (filtrosAtivos.dataInicio || filtrosAtivos.dataFim) &&
          `Julgamento: ${filtrosAtivos.dataInicio || '…'} a ${filtrosAtivos.dataFim || '…'}`,
      ].filter((v): v is string => Boolean(v))
    : []

  return (
    <Stack gap={6}>
      <div>
        <h1>Jurisprudência</h1>
        <p>
          Consulta a acórdãos da base "Jurisprudência Selecionada" do TJSP. Os resultados vêm direto do tribunal —
          nada é digitado manualmente. Integração não oficial (sem API pública documentada), sujeita a mudanças sem
          aviso do tribunal.
        </p>
      </div>
      <Form onSubmit={aoEnviar}>
        <Stack gap={5}>
          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={6} lg={11}>
              <TextInput
                id="juris-termo"
                labelText="Pesquisa por termos (obrigatório)"
                placeholder="Ex.: danos morais, rescisão contratual, guarda compartilhada"
                autoComplete="off"
                required
                invalid={termoTocado && !termo.trim()}
                invalidText="Informe o termo de pesquisa."
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onBlur={() => setTermoTocado(true)}
              />
            </Column>
            <Column sm={4} md={2} lg={5}>
              <Dropdown<OpcaoBuscarEm>
                id="juris-buscar-em"
                titleText="Buscar em"
                label="Buscar em"
                items={OPCOES_BUSCAR_EM}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={OPCOES_BUSCAR_EM.find((o) => o.id === buscarEm)}
                onChange={({ selectedItem }) => setBuscarEm(selectedItem?.id ?? 'ementa')}
              />
            </Column>
          </Grid>
          <DatePicker
            datePickerType="range"
            dateFormat="d/m/Y"
            onChange={(datas: Date[]) => {
              const [inicio, fim] = datas
              setDataInicio(inicio ? formatarDdMmAaaa(inicio) : '')
              setDataFim(fim ? formatarDdMmAaaa(fim) : '')
            }}
          >
            <DatePickerInput id="juris-data-inicio" labelText="Julgamento - início" placeholder="dd/mm/aaaa" />
            <DatePickerInput id="juris-data-fim" labelText="Julgamento - fim" placeholder="dd/mm/aaaa" />
          </DatePicker>
          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={4} lg={8}>
              <TextInput
                id="juris-relator"
                labelText="Relator(a)"
                autoComplete="off"
                value={relator}
                onChange={(e) => setRelator(e.target.value)}
              />
            </Column>
            <Column sm={4} md={4} lg={8}>
              <TextInput
                id="juris-classe"
                labelText="Classe"
                autoComplete="off"
                value={classe}
                onChange={(e) => setClasse(e.target.value)}
              />
            </Column>
          </Grid>
          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={4} lg={8}>
              <FilterableMultiSelect
                id="juris-comarcas"
                titleText="Comarca"
                placeholder={comarcasDisponiveis.length ? 'Selecione uma ou mais comarcas' : 'Disponível após a primeira pesquisa'}
                items={comarcasDisponiveis}
                itemToString={(item) => (item ? `${item.comarca} (${item.quantidade})` : '')}
                selectedItems={comarcasDisponiveis.filter((c) => comarcasSelecionadas.includes(c.comarca))}
                onChange={({ selectedItems }) => setComarcasSelecionadas((selectedItems ?? []).map((c) => c.comarca))}
              />
            </Column>
            <Column sm={4} md={4} lg={8}>
              <TextInput
                id="juris-orgao"
                labelText="Órgão julgador"
                autoComplete="off"
                value={orgaoJulgador}
                onChange={(e) => setOrgaoJulgador(e.target.value)}
              />
            </Column>
          </Grid>
          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={4} lg={8}>
              <Dropdown<OpcaoOrdenacao>
                id="juris-ordenacao"
                titleText="Ordenar por"
                label="Ordenar por"
                items={OPCOES_ORDENACAO}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={OPCOES_ORDENACAO.find((o) => o.id === ordenacao)}
                onChange={({ selectedItem }) => setOrdenacao(selectedItem?.id ?? 'recente')}
              />
            </Column>
          </Grid>
          <Button type="submit" disabled={consultando}>
            Pesquisar
          </Button>
        </Stack>
      </Form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="cartoes" descricao="Consultando a jurisprudência do TJSP…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && <InlineNotification kind="error" title="Erro" subtitle={resultado.mensagem} lowContrast hideCloseButton />}
        {!consultando && resultado && !resultado.erro && (
          <Stack gap={5}>
            <Stack gap={3}>
              <p>
                <strong>{resultado.total_servidor ?? 0}</strong> acórdãos encontrados
                {totalPaginas > 1 && ` — página ${resultado.pagina} de ${totalPaginas}`}
              </p>
              {tagsFiltros.length > 0 && (
                <div className="aj-layout-48">
                  {tagsFiltros.map((texto) => (
                    <Tag key={texto} type="gray" size="sm">
                      {texto}
                    </Tag>
                  ))}
                </div>
              )}
            </Stack>
            {(resultado.resultados ?? []).map((item, i) => (
              <CartaoJurisprudencia key={item.cdJurisprudencia ?? i} item={item} />
            ))}
            {!resultado.resultados?.length && (
              <InlineNotification kind="info" title="Nenhum resultado" subtitle="Tente ampliar os filtros ou o termo de busca." lowContrast hideCloseButton />
            )}
            {totalPaginas > 1 && (
              <div className="aj-layout-48">
                <Button kind="secondary" size="sm" disabled={consultando || pagina <= 1} onClick={() => executar(pagina - 1)}>
                  « Anterior
                </Button>
                <Button kind="secondary" size="sm" disabled={consultando || pagina >= totalPaginas} onClick={() => executar(pagina + 1)}>
                  Próxima »
                </Button>
              </div>
            )}
          </Stack>
        )}
      </div>
    </Stack>
  )
}

function CartaoJurisprudencia({ item }: { item: ResultadoJurisprudencia }) {
  const atribuicoes: { rotulo: string; valor: string }[] = [
    item.relator && { rotulo: 'Relator(a)', valor: item.relator },
    item.comarca && { rotulo: 'Comarca', valor: item.comarca },
    item.orgao_julgador && { rotulo: 'Órgão julgador', valor: item.orgao_julgador },
  ].filter((v): v is { rotulo: string; valor: string } => Boolean(v))

  return (
    <Tile>
      <Stack gap={3}>
        <div className="aj-layout-48">
          <Tag type="blue">TJSP</Tag>
          {item.classe && <Tag type="gray">{item.classe}</Tag>}
          {item.segredo_justica && <Tag type="red">Segredo de justiça</Tag>}
          <div style={{ flex: '1 1 auto' }} />
          <span>Julgado em {formatarDataSimples(item.data_julgamento)}</span>
        </div>
        {item.trecho_destacado_html ? (
          <p className="juris-trecho" dangerouslySetInnerHTML={{ __html: item.trecho_destacado_html }} />
        ) : (
          item.ementa && <p>{item.ementa}</p>
        )}
        {atribuicoes.length > 0 && (
          <p>
            {atribuicoes.map(({ rotulo, valor }, i) => (
              <span key={rotulo}>
                {i > 0 && ' · '}
                <strong>{rotulo}:</strong> {valor}
              </span>
            ))}
          </p>
        )}
        {item.pdf_url && (
          <a href={item.pdf_url} target="_blank" rel="noreferrer">
            Baixar PDF da ementa
          </a>
        )}
      </Stack>
    </Tile>
  )
}
