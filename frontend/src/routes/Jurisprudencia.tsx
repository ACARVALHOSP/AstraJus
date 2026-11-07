import CampoData from '../CampoData'
import CabecalhoPagina from '../CabecalhoPagina'
import { useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  
  Popover,
  Select,
  Text,
  TextField,
  Checkbox,
} from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { CartaoJurisprudencia } from './jurisprudencia/CartaoJurisprudencia'
import { SkeletonJurisprudencia } from './jurisprudencia/SkeletonJurisprudencia'
import type { ResultadoJurisprudencia } from './jurisprudencia/tipos'

type BuscarEm = 'ementa' | 'inteiro_teor' | 'ambos'

const OPCOES_BUSCAR_EM: Array<{ id: BuscarEm; label: string }> = [
  { id: 'ementa', label: 'Ementa' },
  { id: 'inteiro_teor', label: 'Inteiro teor' },
  { id: 'ambos', label: 'Ementa e inteiro teor' },
]

type Ordenacao = 'recente' | 'antiga' | 'relevancia'

const OPCOES_ORDENACAO: Array<{ id: Ordenacao; label: string }> = [
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

const OPERADORES_BUSCA: { operador: string; exemplo: string }[] = [
  { operador: 'OU', exemplo: 'dano OU prejuízo' },
  { operador: 'NÃO', exemplo: 'dano NÃO moral' },
  { operador: '"frase exata"', exemplo: '"dano moral"' },
  { operador: '*', exemplo: 'indeniz*' },
  { operador: '?', exemplo: 'indeniza??o' },
]

function FiltroMultiplo({
  rotulo,
  opcoes,
  selecionados,
  onChange,
}: {
  rotulo: string
  opcoes: FacetaItem[]
  selecionados: string[]
  onChange: (novos: string[]) => void
}) {
  const [filtro, setFiltro] = useState('')
  const filtrados = opcoes.filter((o) => o.label.toLowerCase().includes(filtro.toLowerCase()))

  function alternar(id: string, marcado: boolean) {
    onChange(marcado ? [...selecionados, id] : selecionados.filter((x) => x !== id))
  }

  return (
    <div className="form-campo">
      <label className="form-campo-label">{rotulo}</label>
      <Popover.Root>
        <Popover.Trigger>
          <Button variant="outline" color="gray" size="2" style={{ width: '100%', justifyContent: 'space-between' }}>
            {selecionados.length ? `${selecionados.length} selecionado(s)` : opcoes.length ? 'Selecionar…' : 'Disponível após pesquisa'}
          </Button>
        </Popover.Trigger>
        <Popover.Content style={{ width: 260 }}>
          <Flex direction="column" gap="2">
            <TextField.Root placeholder={`Buscar ${rotulo.toLowerCase()}…`} value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            <div className="aj-multiselect-lista">
              {filtrados.length === 0 && <Text size="2" color="gray">Nenhuma opção.</Text>}
              {filtrados.map((o) => (
                <Text as="label" size="2" key={o.id}>
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={selecionados.includes(o.id)}
                      onCheckedChange={(checked) => alternar(o.id, Boolean(checked))}
                    />
                    {o.label}{o.quantidade ? ` (${o.quantidade})` : ''}
                  </Flex>
                </Text>
              ))}
            </div>
          </Flex>
        </Popover.Content>
      </Popover.Root>
    </div>
  )
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

  const [relatoresSelecionados, setRelatoresSelecionados] = useState<string[]>([])
  const [classesSelecionadas, setClassesSelecionadas] = useState<string[]>([])
  const [comarcasSelecionadas, setComarcasSelecionadas] = useState<string[]>([])
  const [orgaosSelecionados, setOrgaosSelecionados] = useState<string[]>([])

  const [opcoesRelatores, setOpcoesRelatores] = useState<FacetaItem[]>([])
  const [opcoesClasses, setOpcoesClasses] = useState<FacetaItem[]>([])
  const [opcoesComarcas, setOpcoesComarcas] = useState<FacetaItem[]>([])
  const [opcoesOrgaos, setOpcoesOrgaos] = useState<FacetaItem[]>([])

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaJurisprudencia | null>(null)

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
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível concluir a consulta. Tente de novo.')
    } finally {
      if (idRequisicao === requisicaoAtual.current) setConsultando(false)
    }
  }

  function aoEnviarBuscaPrincipal(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
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

  const tamanhoPagina = resultado?.tamanho_pagina || 10
  const total = resultado?.total_servidor ?? 0
  const temPaginacao = total > 0

  return (
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Jurisprudência"
        descricao='Acórdãos da base "Jurisprudência Selecionada" do TJSP, consultados direto no site do tribunal.'
      />

      <form onSubmit={aoEnviarBuscaPrincipal}>
        <Flex direction="column" gap="5">
          <div className="aj-form-grade">
            <div className="form-campo" style={{ gridColumn: 'span 2' }}>
              <label className="form-campo-label" htmlFor="juris-termo">
                Pesquisa por termos (obrigatório)
              </label>
              <TextField.Root
                id="juris-termo"
                placeholder="Ex.: danos morais, rescisão contratual, guarda compartilhada"
                autoComplete="off"
                required
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onBlur={() => setTermoTocado(true)}
              />
              {termoTocado && !termo.trim()
                ? <Text size="1" color="red">Informe o termo de pesquisa.</Text>
                : <Text size="1" color="gray">Use aspas para expressão exata, OU, NÃO e *. <LabelAjuda /></Text>}
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="juris-buscar-em">Buscar em</label>
              <Select.Root value={buscarEm} onValueChange={(v) => setBuscarEm(v as BuscarEm)}>
                <Select.Trigger id="juris-buscar-em" style={{ width: '100%' }} />
                <Select.Content>
                  {OPCOES_BUSCAR_EM.map((o) => (
                    <Select.Item key={o.id} value={o.id}>{o.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="juris-data-inicio">Julgamento - início</label>
              <CampoData id="juris-data-inicio" value={dataInicio} onChange={v => setDataInicio(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="juris-data-fim">Julgamento - fim</label>
              <CampoData id="juris-data-fim" value={dataFim} onChange={v => setDataFim(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="juris-ordenacao">Ordenar por</label>
              <Select.Root value={ordenacao} onValueChange={(v) => setOrdenacao(v as Ordenacao)}>
                <Select.Trigger id="juris-ordenacao" style={{ width: '100%' }} />
                <Select.Content>
                  {OPCOES_ORDENACAO.map((o) => (
                    <Select.Item key={o.id} value={o.id}>{o.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div>
            <Button size="2" type="submit" disabled={consultando}>
              {consultando ? 'Pesquisando…' : 'Pesquisar'}
            </Button>
          </div>
        </Flex>
      </form>

      <div aria-live="polite">
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

        {consultando && <SkeletonJurisprudencia />}

        {!consultando && resultado && !resultado.erro && (
          <Flex direction="column" gap="6">
            <Card variant="surface">
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center" wrap="wrap" gap="2">
                  <Text weight="bold">Filtrar jurisprudência por Relator, Classe, Comarca e Órgão</Text>
                  <Flex gap="2">
                    <Button size="1" disabled={consultando} onClick={aplicarFiltros}>
                      Aplicar filtros
                    </Button>
                    {temFiltrosAtivos && (
                      <Button variant="ghost" size="1" disabled={consultando} onClick={limparTodosFiltros}>
                        Limpar filtros
                      </Button>
                    )}
                  </Flex>
                </Flex>

                <div className="aj-form-grade">
                  <FiltroMultiplo rotulo="Relator(a)" opcoes={opcoesRelatores} selecionados={relatoresSelecionados} onChange={setRelatoresSelecionados} />
                  <FiltroMultiplo rotulo="Classe" opcoes={opcoesClasses} selecionados={classesSelecionadas} onChange={setClassesSelecionadas} />
                  <FiltroMultiplo rotulo="Comarca" opcoes={opcoesComarcas} selecionados={comarcasSelecionadas} onChange={setComarcasSelecionadas} />
                  <FiltroMultiplo rotulo="Órgão julgador" opcoes={opcoesOrgaos} selecionados={orgaosSelecionados} onChange={setOrgaosSelecionados} />
                </div>
              </Flex>
            </Card>

            <Flex direction="column" gap="3">
              <Text size="2">
                <Text weight="bold">{resultado.total_servidor ?? 0}</Text> acórdãos encontrados
              </Text>

              {temFiltrosAtivos && (
                <div className="aj-tags-filtro">
                  {relatoresSelecionados.map((rel) => (
                    <Badge key={rel} color="teal" style={{ cursor: 'pointer' }} onClick={() => removerFiltro('relator', rel)}>
                      Relator: {rel} ✕
                    </Badge>
                  ))}
                  {classesSelecionadas.map((cls) => (
                    <Badge key={cls} color="purple" style={{ cursor: 'pointer' }} onClick={() => removerFiltro('classe', cls)}>
                      Classe: {cls} ✕
                    </Badge>
                  ))}
                  {comarcasSelecionadas.map((com) => (
                    <Badge key={com} color="blue" style={{ cursor: 'pointer' }} onClick={() => removerFiltro('comarca', com)}>
                      Comarca: {com} ✕
                    </Badge>
                  ))}
                  {orgaosSelecionados.map((org) => (
                    <Badge key={org} color="cyan" style={{ cursor: 'pointer' }} onClick={() => removerFiltro('orgao', org)}>
                      Órgão: {org} ✕
                    </Badge>
                  ))}
                </div>
              )}
            </Flex>

            <Flex direction="column" gap="4">
              {(resultado.resultados ?? []).map((item, i) => (
                <CartaoJurisprudencia key={item.cdJurisprudencia ?? i} item={item} />
              ))}

              {(!resultado.resultados || resultado.resultados.length === 0) && (
                <Callout.Root color="blue" size="1">
                  <Callout.Icon><Info size={14} /></Callout.Icon>
                  <Callout.Text>Nenhum acórdão encontrado. Tente ampliar o termo de busca ou remover alguns dos filtros selecionados.</Callout.Text>
                </Callout.Root>
              )}
            </Flex>

            {temPaginacao && (
              <nav aria-label="Páginas de jurisprudência" className="aj-paginacao">
                <Button variant="soft" color="gray" size="2" aria-label="Página anterior" disabled={consultando || pagina <= 1} onClick={() => executar(pagina - 1)}>
                  Anterior
                </Button>
                <Text size="2">Página {pagina} — {total} acórdãos</Text>
                <Button variant="soft" color="gray" size="2" aria-label="Próxima página" disabled={consultando || pagina * tamanhoPagina >= total} onClick={() => executar(pagina + 1)}>
                  Próxima
                </Button>
              </nav>
            )}
          </Flex>
        )}
      </div>
      <details className="aj-sobre-fonte">
        <summary>Sobre esta fonte</summary>
        <Text as="p" size="2" color="gray">
          O TJSP não oferece um serviço oficial para esta consulta: os resultados vêm da página pública de
          jurisprudência do tribunal. Se o tribunal mudar essa página, a busca pode parar de funcionar até ser ajustada.
        </Text>
      </details>
    </Flex>
  )
}

function LabelAjuda() {
  // Abre ao clicar (e não ao passar o mouse), para funcionar também no celular.
  return (
    <Popover.Root>
      <Popover.Trigger>
        <button type="button" className="aj-link-ajuda">Ver exemplos</button>
      </Popover.Trigger>
      <Popover.Content size="1" maxWidth="320px">
        <Text as="p" size="2" weight="bold" mb="2">Operadores de busca do TJSP</Text>
        {OPERADORES_BUSCA.map(({ operador, exemplo }) => (
          <Text as="p" size="2" key={operador}>
            <Text weight="bold">{operador}</Text> — ex.: {exemplo}
          </Text>
        ))}
      </Popover.Content>
    </Popover.Root>
  )
}
