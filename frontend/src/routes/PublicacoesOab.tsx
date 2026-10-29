import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  DatePicker,
  DatePickerInput,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { buscarJson, enviarJson } from '../api/rest'
import { formatarDataSimples, formatarDdMmAaaa, formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'
import { formatarData } from '../utils/listasRapidas'

type DadosDjen = {
  data_disponibilizacao?: string
  tipoComunicacao?: string
  siglaTribunal?: string
  nomeOrgao?: string
  nomeClasse?: string
  numeroprocessocommascara?: string
  texto?: string
  link?: string
  destinatarios?: Array<{ nome?: string; polo?: string }>
  destinatarioadvogados?: Array<{ nome?: string; numero_oab?: string; uf_oab?: string }>
}

type PublicacaoOab = {
  hash: string
  status: 'nao_tratada' | 'tratada' | 'arquivada'
  criado_em?: string
  numero_processo?: string
  nome_pesquisado?: string
  dados?: DadosDjen
}

const ROTULO_STATUS: Record<string, string> = { nao_tratada: 'Não tratada', tratada: 'Tratada', arquivada: 'Arquivada' }
const TAG_STATUS: Record<string, 'red' | 'green' | 'gray'> = { nao_tratada: 'red', tratada: 'green', arquivada: 'gray' }
const TAMANHO_PAGINA = 20

export default function PublicacoesOab() {
  const { cliente } = useCliente()
  const [filtroStatus, setFiltroStatus] = useState('')
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [publicacoes, setPublicacoes] = useState<PublicacaoOab[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [aplicandoLote, setAplicandoLote] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const query = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO_PAGINA) })
      if (filtroStatus) query.set('status', filtroStatus)
      const dados = await buscarJson<{ publicacoes: PublicacaoOab[]; total?: number; pagina?: number }>(
        cliente,
        `/publicacoes-oab?${query}`,
      )
      setPublicacoes(dados.publicacoes ?? [])
      setTotal(dados.total ?? dados.publicacoes?.length ?? 0)
      if (dados.pagina) setPagina(dados.pagina)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao carregar.')
      setPublicacoes(null)
    } finally {
      setCarregando(false)
    }
  }, [cliente, filtroStatus, pagina])

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroStatus, pagina])

  function aoMudarFiltro(valor: string) {
    setFiltroStatus(valor)
    setPagina(1)
  }

  async function alterarStatus(pub: PublicacaoOab, novoStatus: string) {
    const anterior = pub.status
    setPublicacoes((atual) => atual?.map((p) => (p.hash === pub.hash ? { ...p, status: novoStatus as PublicacaoOab['status'] } : p)) ?? null)
    try {
      await enviarJson(cliente, '/publicacoes-oab/status', { hashes: [pub.hash], status: novoStatus })
    } catch (e) {
      setPublicacoes((atual) => atual?.map((p) => (p.hash === pub.hash ? { ...p, status: anterior } : p)) ?? null)
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar status.')
    }
  }

  function alternarSelecao(hash: string, marcado: boolean) {
    setSelecionadas((atual) => {
      const novo = new Set(atual)
      if (marcado) novo.add(hash)
      else novo.delete(hash)
      return novo
    })
  }

  async function aplicarStatusLote(novoStatus: string) {
    const hashes = [...selecionadas]
    if (!hashes.length) return
    setAplicandoLote(true)
    try {
      await enviarJson(cliente, '/publicacoes-oab/status', { hashes, status: novoStatus })
      setSelecionadas(new Set())
      carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao atualizar em lote.')
    } finally {
      setAplicandoLote(false)
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANHO_PAGINA))

  return (
    <Stack gap={6}>
      <div>
        <h2>Publicações monitoradas</h2>
      </div>
      <Accordion>
        <AccordionItem title="Como funciona a captura">
          <p>As publicações dos monitoramentos por OAB são capturadas a cada 24 horas. Os avisos por e-mail, quando configurados, são verificados a cada 6 horas.</p>
          <p>Para criar um monitoramento, abra "Consultar publicações", informe a OAB, consulte e clique em "Criar monitoramento por e-mail".</p>
          <p>Para consultar um período agora e adicionar os resultados à lista, use "Capturar publicações por OAB" abaixo.</p>
        </AccordionItem>
        <AccordionItem title="O que significa cada status">
          <p>
            <strong>Não tratada</strong>: ainda não revisada.
          </p>
          <p>
            <strong>Tratada</strong>: revisada, com as providências necessárias tomadas.
          </p>
          <p>
            <strong>Arquivada</strong>: dispensada sem ação.
          </p>
        </AccordionItem>
      </Accordion>
      <CapturaManual onCapturado={carregar} />
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Select id="pub-oab-filtro-status" labelText="Status" value={filtroStatus} onChange={(e) => aoMudarFiltro(e.target.value)}>
          <SelectItem value="" text="Todos" />
          <SelectItem value="nao_tratada" text="Não tratada" />
          <SelectItem value="tratada" text="Tratada" />
          <SelectItem value="arquivada" text="Arquivada" />
        </Select>
        <Button kind="ghost" size="sm" onClick={carregar} disabled={carregando}>
          Atualizar lista
        </Button>
      </div>
      {selecionadas.size > 0 && (
        <div className="clientes-lote-barra" role="group" aria-label="Ações nas publicações selecionadas" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong role="status">{selecionadas.size} selecionada(s)</strong>
          <Button size="sm" kind="ghost" disabled={aplicandoLote} onClick={() => aplicarStatusLote('nao_tratada')}>
            Marcar como Não tratada
          </Button>
          <Button size="sm" kind="ghost" disabled={aplicandoLote} onClick={() => aplicarStatusLote('tratada')}>
            Marcar como Tratada
          </Button>
          <Button size="sm" kind="ghost" disabled={aplicandoLote} onClick={() => aplicarStatusLote('arquivada')}>
            Marcar como Arquivada
          </Button>
          <Button size="sm" kind="ghost" disabled={aplicandoLote} onClick={() => setSelecionadas(new Set())}>
            Cancelar seleção
          </Button>
        </div>
      )}
      <div aria-live="polite">
        {carregando && <InlineLoading description="Carregando…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && publicacoes && publicacoes.length === 0 && (
          <InlineNotification
            kind="info"
            title={filtroStatus ? 'Nenhuma publicação com este status' : 'Nenhuma publicação encontrada'}
            subtitle={filtroStatus ? 'Selecione Todos no filtro de status para ver as demais publicações.' : 'Use a captura manual para adicionar publicações à lista.'}
            lowContrast
            hideCloseButton
          />
        )}
        {!carregando && publicacoes && publicacoes.length > 0 && (
          <Stack gap={4}>
            {publicacoes.map((p) => (
              <CartaoPubOab
                key={p.hash}
                p={p}
                selecionada={selecionadas.has(p.hash)}
                onAlterarStatus={(status) => alterarStatus(p, status)}
                onAlterarSelecao={(marcado) => alternarSelecao(p.hash, marcado)}
              />
            ))}
          </Stack>
        )}
      </div>
      {total > TAMANHO_PAGINA && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Button kind="ghost" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            « Anterior
          </Button>
          <span>
            Página {pagina} de {totalPaginas}
          </span>
          <Button kind="ghost" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima »
          </Button>
        </div>
      )}
    </Stack>
  )
}

function CartaoPubOab({
  p,
  selecionada,
  onAlterarStatus,
  onAlterarSelecao,
}: {
  p: PublicacaoOab
  selecionada: boolean
  onAlterarStatus: (status: string) => void
  onAlterarSelecao: (marcado: boolean) => void
}) {
  const d = p.dados ?? {}
  const destinatarios = (d.destinatarios ?? []).map((x) => formatarNomeExibicao(x.nome)).filter(Boolean)
  const advogados = (d.destinatarioadvogados ?? []).map((a) => `${formatarNomeExibicao(a.nome)} OAB ${a.numero_oab ?? '?'}/${a.uf_oab ?? '?'}`)

  return (
    <Tile>
      <Stack gap={3}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Checkbox
              id={`selecionar-${p.hash}`}
              labelText=""
              hideLabel
              checked={selecionada}
              onChange={(_e, { checked }) => onAlterarSelecao(checked)}
            />
            <Tag type="blue">{(d.siglaTribunal ?? '?').toUpperCase()}</Tag>{' '}
            {d.tipoComunicacao && <Tag type="teal">{d.tipoComunicacao}</Tag>}{' '}
            <Tag type={TAG_STATUS[p.status] ?? 'gray'}>{ROTULO_STATUS[p.status] ?? p.status}</Tag>
          </div>
          <Select
            id={`status-${p.hash}`}
            labelText=""
            hideLabel
            size="sm"
            value={p.status}
            onChange={(e) => onAlterarStatus(e.target.value)}
          >
            <SelectItem value="nao_tratada" text="Não tratada" />
            <SelectItem value="tratada" text="Tratada" />
            <SelectItem value="arquivada" text="Arquivada" />
          </Select>
        </div>
        <h3>{d.nomeClasse ?? 'Classe não informada'}</h3>
        <p>Processo: {formatarNumeroCNJ(d.numeroprocessocommascara ?? p.numero_processo) || 'não informado'}</p>
        <p>
          {d.nomeOrgao ?? 'Órgão não informado'} · divulgado em {formatarDataSimples(d.data_disponibilizacao)} · capturado em{' '}
          {formatarData(p.criado_em)}
        </p>
        {p.nome_pesquisado && <p>Referência: {formatarNomeExibicao(p.nome_pesquisado)}</p>}
        {destinatarios.length > 0 && <p>Partes: {destinatarios.join(' · ')}</p>}
        {advogados.length > 0 && <p>Advogados: {advogados.join(' · ')}</p>}
        {d.texto && (
          <Accordion>
            <AccordionItem title="Texto da publicação">
              <p>{d.texto}</p>
            </AccordionItem>
          </Accordion>
        )}
        {d.link && (
          <div>
            <a href={d.link} target="_blank" rel="noopener noreferrer">
              Ver no sistema do tribunal
            </a>
          </div>
        )}
      </Stack>
    </Tile>
  )
}

function CapturaManual({ onCapturado }: { onCapturado: () => void }) {
  const { cliente } = useCliente()
  const [numeroOab, setNumeroOab] = useState('')
  const [ufOab, setUfOab] = useState('')
  const [nome, setNome] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setStatus('Consultando o DJEN…')
    try {
      const resultado = (await enviarJson(cliente, '/publicacoes-oab/capturar-manual', {
        numero_oab: numeroOab.trim(),
        uf_oab: ufOab.trim(),
        nome: nome.trim(),
        data_inicio: dataInicio,
        data_fim: dataFim,
      })) as { encontradas: number; novas: number }
      setStatus(
        `${resultado.encontradas} ${resultado.encontradas === 1 ? 'publicação encontrada' : 'publicações encontradas'} no DJEN. ` +
          `${resultado.novas} ${resultado.novas === 1 ? 'nova publicação adicionada' : 'novas publicações adicionadas'} à lista.`,
      )
      onCapturado()
    } catch (e) {
      setStatus(e instanceof ErroMCP ? e.message : 'Falha inesperada.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Accordion>
      <AccordionItem title="Capturar publicações por OAB">
        <form onSubmit={aoEnviar}>
          <Stack gap={5}>
            <TextInput
              id="pub-oab-manual-numero"
              labelText="Número da OAB"
              placeholder="Ex.: 330659"
              autoComplete="off"
              required
              value={numeroOab}
              onChange={(e) => setNumeroOab(e.target.value)}
            />
            <TextInput
              id="pub-oab-manual-uf"
              labelText="UF da OAB (opcional)"
              placeholder="Ex.: SP"
              maxLength={2}
              autoComplete="off"
              value={ufOab}
              onChange={(e) => setUfOab(e.target.value)}
            />
            <TextInput
              id="pub-oab-manual-nome"
              labelText="Nome para identificar os registros (opcional)"
              placeholder="Ex.: Maria Silva"
              helperText="Identifica os registros na lista; não filtra a consulta no DJEN."
              autoComplete="off"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
            <DatePicker
              datePickerType="range"
              dateFormat="Y-m-d"
              onChange={(datas: Date[]) => {
                const [inicio, fim] = datas
                setDataInicio(inicio ? isoDeData(inicio) : '')
                setDataFim(fim ? isoDeData(fim) : '')
              }}
            >
              <DatePickerInput id="pub-oab-manual-data-inicio" labelText="Data inicial" placeholder="aaaa-mm-dd" />
              <DatePickerInput id="pub-oab-manual-data-fim" labelText="Data final" placeholder="aaaa-mm-dd" />
            </DatePicker>
            <div>
              <Button type="submit" size="sm" disabled={enviando}>
                Capturar agora
              </Button>
            </div>
            {status && <p role="status">{status}</p>}
          </Stack>
        </form>
      </AccordionItem>
    </Accordion>
  )
}

function isoDeData(data: Date): string {
  const [dia, mes, ano] = formatarDdMmAaaa(data).split('/')
  return `${ano}-${mes}-${dia}`
}
