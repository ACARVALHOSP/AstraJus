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
  Pagination,
  Stack,
  Tag,
  TextInput,
  Tile,
  Tooltip,
} from '@carbon/react'
import { Filter, Information } from '@carbon/icons-react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarDdMmAaaa } from '../utils/formatadores'
import { CartaoJurisprudencia } from './jurisprudencia/CartaoJurisprudencia'
import { SkeletonJurisprudencia } from './jurisprudencia/SkeletonJurisprudencia'
import type { ResultadoJurisprudencia } from './jurisprudencia/tipos'

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

type FacetaItem = {
  id: string
  label: string
  quantidade?: string
}

type RespostaJurisprudencia = {
  erro?: boolean
  mensagem?: string
  total_servidor?: number
  pagina?: number
  tamanho_pagina?: number
  resultados?: ResultadoJurisprudencia[]
  comarcas_disponiveis?: Array<{ comarca?: string; quantidade?: string }>
  relatores_disponiveis?: Array<{ relator?: string; quantidade?: string }>
  classes_disponiveis?: Array<{ classe?: string; quantidade?: string }>
  orgaos_disponiveis?: Array<{ orgao_julgador?: string; quantidade?: string }>
}

function normalizarFacetas(
  lista?: Array<Record<string, unknown>>,
  chavePrincipal = 'descricao',
): FacetaItem[] {
  if (!lista || !Array.isArray(lista)) return []
  return lista
    .map((item) => {
      const valor = String(item[chavePrincipal] ?? item.descricao ?? '').trim()
      const quantidade = item.quantidade !== undefined ? String(item.quantidade).trim() : ''
      return {
        id: valor,
        label: valor,
        quantidade,
      }
    })
    .filter((f) => Boolean(f.id))
}

function mesclarFacetas(existentes: FacetaItem[], novas: FacetaItem[]): FacetaItem[] {
  const mapa = new Map<string, FacetaItem>()
  for (const item of existentes) {
    mapa.set(item.id, item)
  }
  for (const item of novas) {
    mapa.set(item.id, item)
  }
  return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

export default function Jurisprudencia() {
  const { cliente } = useCliente()
  const [termo, setTermo] = useState('')
  const [termoTocado, setTermoTocado] = useState(false)
  const [buscarEm, setBuscarEm] = useState<BuscarEm>('ementa')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('recente')
  const [pagina, setPagina] = useState(1)

  // Filtros selecionados pelo usuário (multiselect)
  const [relatoresSelecionados, setRelatoresSelecionados] = useState<string[]>([])
  const [classesSelecionadas, setClassesSelecionadas] = useState<string[]>([])
  const [comarcasSelecionadas, setComarcasSelecionadas] = useState<string[]>([])
  const [orgaosSelecionados, setOrgaosSelecionados] = useState<string[]>([])

  // Opções de facetas acumuladas (mantém as opções disponíveis mesmo ao aplicar filtros restritivos)
  const [opcoesRelatores, setOpcoesRelatores] = useState<FacetaItem[]>([])
  const [opcoesClasses, setOpcoesClasses] = useState<FacetaItem[]>([])
  const [opcoesComarcas, setOpcoesComarcas] = useState<FacetaItem[]>([])
  const [opcoesOrgaos, setOpcoesOrgaos] = useState<FacetaItem[]>([])

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaJurisprudencia | null>(null)

  // Descarta respostas de pesquisas superadas
  const requisicaoAtual = useRef(0)

  async function executar(
    paginaAlvo: number,
    filtrosSobrescritos?: {
      relatores?: string[]
      classes?: string[]
      comarcas?: string[]
      orgaos?: string[]
    },
  ) {
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

    const rels = filtrosSobrescritos?.relatores ?? relatoresSelecionados
    const clas = filtrosSobrescritos?.classes ?? classesSelecionadas
    const coms = filtrosSobrescritos?.comarcas ?? comarcasSelecionadas
    const orgs = filtrosSobrescritos?.orgaos ?? orgaosSelecionados

    try {
      const dados = (await cliente.chamarFerramenta('consultar_jurisprudencia_tjsp', {
        termo: termo.trim(),
        buscar_em: buscarEm,
        data_julgamento_inicio: dataInicio || null,
        data_julgamento_fim: dataFim || null,
        relatores: rels.length > 0 ? rels : null,
        classes: clas.length > 0 ? clas : null,
        comarcas: coms.length > 0 ? coms : null,
        orgaos_julgadores: orgs.length > 0 ? orgs : null,
        ordenacao,
        pagina: paginaAlvo,
      })) as RespostaJurisprudencia

      if (idRequisicao !== requisicaoAtual.current) return
      setResultado(dados)

      // Atualiza e acumula as opções autocompletáveis com as facetas pré-baixadas do consumível
      const novasRelatores = normalizarFacetas(dados.relatores_disponiveis, 'relator')
      const novasClasses = normalizarFacetas(dados.classes_disponiveis, 'classe')
      const novasComarcas = normalizarFacetas(dados.comarcas_disponiveis, 'comarca')
      const novasOrgaos = normalizarFacetas(dados.orgaos_disponiveis, 'orgao_julgador')

      setOpcoesRelatores((anteriores) => mesclarFacetas(anteriores, novasRelatores))
      setOpcoesClasses((anteriores) => mesclarFacetas(anteriores, novasClasses))
      setOpcoesComarcas((anteriores) => mesclarFacetas(anteriores, novasComarcas))
      setOpcoesOrgaos((anteriores) => mesclarFacetas(anteriores, novasOrgaos))
    } catch (e) {
      if (idRequisicao !== requisicaoAtual.current) return
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
    } finally {
      if (idRequisicao === requisicaoAtual.current) setConsultando(false)
    }
  }

  function aoEnviarBuscaPrincipal(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Nova busca reseta os filtros para que o usuário veja o panorama geral e as novas facetas
    setRelatoresSelecionados([])
    setClassesSelecionadas([])
    setComarcasSelecionadas([])
    setOrgaosSelecionados([])
    executar(1, { relatores: [], classes: [], comarcas: [], orgaos: [] })
  }

  function aplicarFiltros() {
    executar(1)
  }

  function limparTodosFiltros() {
    setRelatoresSelecionados([])
    setClassesSelecionadas([])
    setComarcasSelecionadas([])
    setOrgaosSelecionados([])
    executar(1, { relatores: [], classes: [], comarcas: [], orgaos: [] })
  }

  function removerFiltro(tipo: 'relator' | 'classe' | 'comarca' | 'orgao', valor: string) {
    if (tipo === 'relator') {
      const novos = relatoresSelecionados.filter((x) => x !== valor)
      setRelatoresSelecionados(novos)
      executar(1, { relatores: novos })
    } else if (tipo === 'classe') {
      const novos = classesSelecionadas.filter((x) => x !== valor)
      setClassesSelecionadas(novos)
      executar(1, { classes: novos })
    } else if (tipo === 'comarca') {
      const novos = comarcasSelecionadas.filter((x) => x !== valor)
      setComarcasSelecionadas(novos)
      executar(1, { comarcas: novos })
    } else if (tipo === 'orgao') {
      const novos = orgaosSelecionados.filter((x) => x !== valor)
      setOrgaosSelecionados(novos)
      executar(1, { orgaos: novos })
    }
  }

  const temFiltrosAtivos =
    relatoresSelecionados.length > 0 ||
    classesSelecionadas.length > 0 ||
    comarcasSelecionadas.length > 0 ||
    orgaosSelecionados.length > 0

  return (
    <Stack gap={6}>
      <div>
        <h1>Jurisprudência</h1>
        <p>
          Consulta a acórdãos da base &quot;Jurisprudência Selecionada&quot; do TJSP. Os resultados vêm direto do tribunal —
          nada é digitado manualmente. Integração não oficial (sem API pública documentada), sujeita a mudanças sem
          aviso do tribunal.
        </p>
      </div>

      {/* Formulário Principal de Pesquisa */}
      <Form onSubmit={aoEnviarBuscaPrincipal}>
        <Stack gap={5}>
          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={6} lg={11}>
              <TextInput
                id="juris-termo"
                labelText={<LabelTermoComAjuda />}
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

          <Grid narrow fullWidth className="aj-layout-62">
            <Column sm={4} md={4} lg={8}>
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
            </Column>

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
            {consultando ? 'Pesquisando…' : 'Pesquisar'}
          </Button>
        </Stack>
      </Form>

      <div aria-live="polite">
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && (
          <InlineNotification kind="error" title="Erro" subtitle={resultado.mensagem} lowContrast hideCloseButton />
        )}

        {/* Skeleton durante a consulta */}
        {consultando && <SkeletonJurisprudencia />}

        {/* Resultados e Painel de Filtros */}
        {!consultando && resultado && !resultado.erro && (
          <Stack gap={6}>
            {/* Painel de Filtros Autocompletáveis / Multi-select */}
            <Tile>
              <Stack gap={4}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <strong>Filtrar jurisprudência por Relator, Classe, Comarca e Órgão</strong>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      kind="primary"
                      size="sm"
                      renderIcon={Filter}
                      disabled={consultando}
                      onClick={aplicarFiltros}
                    >
                      Aplicar filtros
                    </Button>
                    {temFiltrosAtivos && (
                      <Button kind="ghost" size="sm" disabled={consultando} onClick={limparTodosFiltros}>
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                </div>

                <Grid narrow fullWidth className="aj-layout-62">
                  <Column sm={4} md={4} lg={4}>
                    <FilterableMultiSelect<FacetaItem>
                      id="juris-filtro-relator"
                      titleText="Relator(a)"
                      placeholder={opcoesRelatores.length ? 'Buscar relator(a)…' : 'Disponível após pesquisa'}
                      items={opcoesRelatores}
                      itemToString={(item) => (item ? `${item.label}${item.quantidade ? ` (${item.quantidade})` : ''}` : '')}
                      selectedItems={opcoesRelatores.filter((r) => relatoresSelecionados.includes(r.id))}
                      onChange={({ selectedItems }) => setRelatoresSelecionados((selectedItems ?? []).map((r) => r.id))}
                    />
                  </Column>

                  <Column sm={4} md={4} lg={4}>
                    <FilterableMultiSelect<FacetaItem>
                      id="juris-filtro-classe"
                      titleText="Classe"
                      placeholder={opcoesClasses.length ? 'Buscar classe…' : 'Disponível após pesquisa'}
                      items={opcoesClasses}
                      itemToString={(item) => (item ? `${item.label}${item.quantidade ? ` (${item.quantidade})` : ''}` : '')}
                      selectedItems={opcoesClasses.filter((c) => classesSelecionadas.includes(c.id))}
                      onChange={({ selectedItems }) => setClassesSelecionadas((selectedItems ?? []).map((c) => c.id))}
                    />
                  </Column>

                  <Column sm={4} md={4} lg={4}>
                    <FilterableMultiSelect<FacetaItem>
                      id="juris-filtro-comarca"
                      titleText="Comarca"
                      placeholder={opcoesComarcas.length ? 'Buscar comarca…' : 'Disponível após pesquisa'}
                      items={opcoesComarcas}
                      itemToString={(item) => (item ? `${item.label}${item.quantidade ? ` (${item.quantidade})` : ''}` : '')}
                      selectedItems={opcoesComarcas.filter((c) => comarcasSelecionadas.includes(c.id))}
                      onChange={({ selectedItems }) => setComarcasSelecionadas((selectedItems ?? []).map((c) => c.id))}
                    />
                  </Column>

                  <Column sm={4} md={4} lg={4}>
                    <FilterableMultiSelect<FacetaItem>
                      id="juris-filtro-orgao"
                      titleText="Órgão julgador"
                      placeholder={opcoesOrgaos.length ? 'Buscar órgão…' : 'Disponível após pesquisa'}
                      items={opcoesOrgaos}
                      itemToString={(item) => (item ? `${item.label}${item.quantidade ? ` (${item.quantidade})` : ''}` : '')}
                      selectedItems={opcoesOrgaos.filter((o) => orgaosSelecionados.includes(o.id))}
                      onChange={({ selectedItems }) => setOrgaosSelecionados((selectedItems ?? []).map((o) => o.id))}
                    />
                  </Column>
                </Grid>
              </Stack>
            </Tile>

            {/* Sumário e Tags de Filtros Ativos */}
            <Stack gap={3}>
              <p>
                <strong>{resultado.total_servidor ?? 0}</strong> acórdãos encontrados
              </p>

              {temFiltrosAtivos && (
                <div className="aj-layout-48" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  {relatoresSelecionados.map((rel) => (
                    <Tag key={rel} type="teal" size="sm" onClose={() => removerFiltro('relator', rel)} filter>
                      Relator: {rel}
                    </Tag>
                  ))}
                  {classesSelecionadas.map((cls) => (
                    <Tag key={cls} type="purple" size="sm" onClose={() => removerFiltro('classe', cls)} filter>
                      Classe: {cls}
                    </Tag>
                  ))}
                  {comarcasSelecionadas.map((com) => (
                    <Tag key={com} type="blue" size="sm" onClose={() => removerFiltro('comarca', com)} filter>
                      Comarca: {com}
                    </Tag>
                  ))}
                  {orgaosSelecionados.map((org) => (
                    <Tag key={org} type="cyan" size="sm" onClose={() => removerFiltro('orgao', org)} filter>
                      Órgão: {org}
                    </Tag>
                  ))}
                </div>
              )}
            </Stack>

            {/* Lista de Acórdãos */}
            <Stack gap={4}>
              {(resultado.resultados ?? []).map((item, i) => (
                <CartaoJurisprudencia key={item.cdJurisprudencia ?? i} item={item} />
              ))}

              {(!resultado.resultados || resultado.resultados.length === 0) && (
                <InlineNotification
                  kind="info"
                  title="Nenhum acórdão encontrado"
                  subtitle="Tente ampliar o termo de busca ou remover alguns dos filtros selecionados."
                  lowContrast
                  hideCloseButton
                />
              )}
            </Stack>

            {/* Paginação oficial Carbon */}
            {resultado.total_servidor && resultado.total_servidor > 0 ? (
              <Pagination
                id="juris-paginacao"
                size="md"
                page={pagina}
                pageSize={resultado.tamanho_pagina || 10}
                pageSizes={[resultado.tamanho_pagina || 10]}
                totalItems={resultado.total_servidor}
                disabled={consultando}
                itemsPerPageText="Itens por página:"
                backwardText="Página anterior"
                forwardText="Próxima página"
                pageNumberText="Página"
                pageSelectLabelText={() => 'Selecionar página'}
                pageRangeText={(_, totalPags) => `de ${totalPags} página(s)`}
                itemRangeText={(min, max, totalItens) =>
                  totalItens ? `${min}-${max} de ${totalItens} acórdãos` : '0 acórdãos'
                }
                onChange={({ page }) => {
                  if (!consultando && page !== pagina) {
                    executar(page)
                  }
                }}
              />
            ) : null}
          </Stack>
        )}
      </div>
    </Stack>
  )
}

const OPERADORES_BUSCA: { operador: string; exemplo: string }[] = [
  { operador: 'OU', exemplo: 'dano OU prejuízo' },
  { operador: 'NÃO', exemplo: 'dano NÃO moral' },
  { operador: '"frase exata"', exemplo: '"dano moral"' },
  { operador: '*', exemplo: 'indeniz*' },
  { operador: '?', exemplo: 'indeniza??o' },
]

function LabelTermoComAjuda() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      Pesquisa por termos (obrigatório)
      <Tooltip
        autoAlign
        align="top"
        label={
          <div>
            <p>Operadores de busca suportados pelo TJSP:</p>
            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
              {OPERADORES_BUSCA.map(({ operador, exemplo }) => (
                <li key={operador}>
                  <strong>{operador}</strong> — ex.: {exemplo}
                </li>
              ))}
            </ul>
          </div>
        }
      >
        <button
          type="button"
          aria-label="Operadores de busca suportados"
          style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
        >
          <Information size={16} />
        </button>
      </Tooltip>
    </span>
  )
}
