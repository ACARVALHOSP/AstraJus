import TabelaResponsiva from '../../TabelaResponsiva'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Button, Checkbox, Column, DataTable, Grid, InlineNotification, OverflowMenu, OverflowMenuItem, Pagination, Select, SelectItem, Stack, Table, TableBatchAction, TableBatchActions, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, TableSelectAll, TableSelectRow, TableToolbar, TableToolbarContent, Toggletip, ToggletipButton, ToggletipContent, useTheme } from '@carbon/react'
import { Archive } from '@carbon/icons-react'
import { Checkmark } from '@carbon/icons-react'
import { ChevronDown } from '@carbon/icons-react'
import { ChevronRight } from '@carbon/icons-react'
import { Launch } from '@carbon/icons-react'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { useNavegacao } from '../../api/NavegacaoContext'
import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'
import { traduzirTabela } from '../../utils/tabela'
import TextoTabela from '../../TextoTabela'
import Carregamento from '../../Carregamento'
import { catalogoColunas, CHAVE_COLUNAS, lerPreferencias, nomePublicacao, numeroPublicacao, ROTULO_STATUS, urlPublicacao, type PublicacaoOab } from './dados'
import ProcessoPublicacao from './ProcessoPublicacao'
import AtividadePublicacao from './AtividadePublicacao'
import './publicacoes.scss'

type RespostaLista = { publicacoes: PublicacaoOab[]; total: number; pagina: number; campos_djen?: string[]; hashes_disponiveis?: string[] }
type ResultadoStatus = { hashes_atualizados: string[]; hashes_falharam: string[] }
export default function PainelPublicacoes({ Captura }: { Captura: ComponentType<{ onCapturado: () => void }> }) {
  const { cliente } = useCliente(), { irPara } = useNavegacao()
  const { theme } = useTheme()
  const [status, setStatus] = useState(''), [pagina, setPagina] = useState(1), [tamanho, setTamanho] = useState(5)
  const [publicacoes, setPublicacoes] = useState<PublicacaoOab[]>([]), [total, setTotal] = useState(0)
  const [campos, setCampos] = useState<string[]>([]), [preferencias, setPreferencias] = useState(lerPreferencias)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set()), [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true), [operacao, setOperacao] = useState(false)
  const [erro, setErro] = useState(''), [mensagem, setMensagem] = useState('')
  const [modal, setModal] = useState<{ tipo: 'processo' | 'atividade'; p: PublicacaoOab } | null>(null)
  const [ordem, setOrdem] = useState<{ chave: string; asc: boolean } | null>(null)
  const trava = useRef(false), sequencia = useRef(0)
  const catalogo = useMemo(() => catalogoColunas(campos), [campos])
  const colunas = catalogo.filter(c => c.obrigatoria || preferencias.includes(c.key))
  const carregar = useCallback(async () => {
    const pedido = ++sequencia.current
    if (!cliente) { setCarregando(false); return }
    setCarregando(true); setErro('')
    try {
      const query = new URLSearchParams({ pagina: String(pagina), tamanho: String(tamanho), ...(status ? { status } : {}) })
      const dados = await buscarJson<RespostaLista>(cliente, `/publicacoes-oab?${query}`)
      if (pedido !== sequencia.current) return
      setPublicacoes(dados.publicacoes ?? []); setTotal(dados.total ?? 0)
      setCampos([...new Set([...(dados.campos_djen ?? []), ...(dados.publicacoes ?? []).flatMap(p => Object.keys(p.dados ?? {}))])])
      if (dados.pagina && dados.pagina !== pagina) setPagina(dados.pagina)
      if (dados.hashes_disponiveis) {
        const disponiveis = new Set(dados.hashes_disponiveis)
        setSelecionadas(s => new Set([...s].filter(id => disponiveis.has(id))))
        setExpandidas(s => new Set([...s].filter(id => disponiveis.has(id))))
      }
    } catch (e) { if (pedido === sequencia.current) setErro((e as Error).message) }
    finally { if (pedido === sequencia.current) setCarregando(false) }
  }, [cliente, pagina, tamanho, status])
  useEffect(() => {
    // The request synchronizes the list with the server; invalidate it on cleanup.
    const controle = sequencia
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
    return () => { controle.current++ }
  }, [carregar])
  const ocupada = carregando || operacao || modal !== null
  const lote = selecionadas.size > 0
  const linhas = useMemo(() => {
    if (!ordem) return publicacoes
    const coluna = catalogo.find(c => c.key === ordem.chave)
    if (!coluna) return publicacoes
    const valor = (p: PublicacaoOab) => ordem.chave === 'divulgado' ? p.dados?.data_disponibilizacao || '' : ordem.chave === 'capturado' ? p.criado_em || '' : coluna.valor(p)
    return [...publicacoes].sort((a, b) => valor(a).localeCompare(valor(b), 'pt-BR', { numeric: true }) * (ordem.asc ? 1 : -1))
  }, [publicacoes, catalogo, ordem])
  const todasPagina = publicacoes.length > 0 && publicacoes.every(p => selecionadas.has(p.hash))
  const cabecalhos = colunas.map(c => ({ key: c.key, header: c.header }))
  const dadosTabela = linhas.map(p => ({ id: p.hash, ...Object.fromEntries(colunas.map(c => [c.key, c.valor(p)])) }))
  function alternar(id: string) {
    if (ocupada || trava.current) return
    setSelecionadas(s => { const novo = new Set(s); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo })
  }
  async function mudarStatus(hashes: string[], novo: PublicacaoOab['status'], emLote = false) {
    if (trava.current || ocupada || !hashes.length || (!emLote && lote)) return
    trava.current = true; setOperacao(true); setErro(''); setMensagem('')
    try {
      // The backend limits request bodies to 4096 bytes. Keep each batch below that.
      const r: ResultadoStatus = { hashes_atualizados: [], hashes_falharam: [] }
      for (let inicio = 0; inicio < hashes.length; inicio += 30) {
        const bloco = hashes.slice(inicio, inicio + 30)
        try {
          const parcial = await enviarJson<ResultadoStatus>(cliente, '/publicacoes-oab/status', { hashes: bloco, status: novo })
          if (!Array.isArray(parcial.hashes_atualizados) || !Array.isArray(parcial.hashes_falharam)) throw new Error('Resposta de status incompleta. Atualize a lista antes de repetir.')
          r.hashes_atualizados.push(...parcial.hashes_atualizados); r.hashes_falharam.push(...parcial.hashes_falharam)
        } catch (e) {
          r.hashes_falharam.push(...hashes.slice(inicio)); setErro((e as Error).message); break
        }
      }
      const sucessos = new Set(r.hashes_atualizados)
      setSelecionadas(s => new Set([...s].filter(h => !sucessos.has(h))))
      setMensagem(`${sucessos.size} publicação(ões) atualizada(s) para ${ROTULO_STATUS[novo].toLowerCase()}.`)
      if (r.hashes_falharam.length) setMensagem(`${sucessos.size} atualizada(s); ${r.hashes_falharam.length} falharam. As falhas permanecem selecionadas quando disponíveis.`)
      await carregar()
    } catch (e) { setErro((e as Error).message) }
    finally { trava.current = false; setOperacao(false) }
  }
  function escolherColuna(chave: string, checked: boolean) {
    const validas = preferencias.filter(k => catalogo.some(c => c.key === k))
    const novas = checked ? [...new Set([...validas, chave])] : validas.filter(k => k !== chave)
    setPreferencias(novas)
    try { localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(novas)) } catch { setMensagem('Preferências aplicadas nesta sessão; armazenamento indisponível.') }
  }
  function abrirAcao(tipo: 'processo' | 'atividade', p: PublicacaoOab) {
    if (ocupada || lote || trava.current) return
    if (tipo === 'processo' && p.caso_id) { irPara('casos', { id: p.caso_id }); return }
    setModal({ tipo, p })
  }
  return <Grid narrow fullWidth className="oab-painel">
    <Column sm={4} md={8} lg={16}>
    <Stack gap={6}>
    <div><h1>Publicações monitoradas</h1><p>Revise as publicações capturadas pelos monitoramentos por OAB.</p></div>
    <details className="oab-ajuda"><summary>Sobre a captura e os status</summary><Stack gap={3}>
      <p>A captura dos monitoramentos por OAB ocorre a cada 24 horas. Os avisos por e-mail são verificados a cada 6 horas.</p>
      <p>Não tratada: aguarda revisão. Tratada: revisada ou com processo/atividade criado. Arquivada: dispensada, preservando dados e vínculos. É possível reabrir.</p>
    </Stack></details>
    <fieldset className="oab-captura" disabled={ocupada || lote}><Captura onCapturado={carregar} /></fieldset>
    <section aria-label="Lista de publicações" aria-busy={carregando || operacao}>
      <DataTable rows={dadosTabela} headers={cabecalhos} size="md" isSortable>
      {({ getTableProps }) => <TableContainer className="oab-table oab-lista" title="Publicações" description={`${total} registro(s). Ordenação aplicada à página atual.`}>
        <div className="oab-toolbar-area"><TableToolbar size="lg" aria-label="Ferramentas das publicações">
          <TableBatchActions shouldShowBatchActions={lote} totalSelected={selecionadas.size} onCancel={() => { if (!operacao) setSelecionadas(new Set()) }} translateWithId={traduzirTabela}>
            <TableBatchAction renderIcon={Checkmark} tabIndex={lote ? 0 : -1} disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'tratada', true)}>Marcar como tratada</TableBatchAction>
            <TableBatchAction renderIcon={Archive} tabIndex={lote ? 0 : -1} disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'arquivada', true)}>Arquivar</TableBatchAction>
          </TableBatchActions>
          {!lote && <TableToolbarContent className="oab-toolbar">
            <Select id="pub-oab-filtro-status" size="sm" labelText="Status" value={status} disabled={ocupada} onChange={e => { setStatus(e.target.value); setPagina(1); setSelecionadas(new Set()); setMensagem('') }}>
              <SelectItem value="" text="Todos" />{Object.entries(ROTULO_STATUS).map(([v, r]) => <SelectItem key={v} value={v} text={r} />)}
            </Select>
            <Button kind="ghost" size="sm" disabled={ocupada} onClick={carregar}>Atualizar lista</Button>
            <Toggletip align="bottom-right" highContrast={false} className="oab-colunas">
              <ToggletipButton label="Colunas" disabled={ocupada}>Colunas</ToggletipButton>
              <ToggletipContent className="oab-colunas-conteudo"><fieldset><legend>Colunas visíveis</legend><div className="oab-colunas-opcoes" onPointerDown={e => { if ((e.target as HTMLElement).closest('label')) e.preventDefault() }}>{catalogo.map(c => <Checkbox key={c.key} id={`oab-coluna-${encodeURIComponent(c.key)}`} labelText={`${c.header}${c.obrigatoria ? ' — sempre visível' : ''}`} checked={Boolean(c.obrigatoria || preferencias.includes(c.key))} disabled={c.obrigatoria} onChange={(_, { checked }) => escolherColuna(c.key, checked)} />)}</div></fieldset></ToggletipContent>
            </Toggletip>
          </TableToolbarContent>}
        </TableToolbar></div>
        <TabelaResponsiva principais={['Processo']}><Table {...getTableProps()} aria-label="Publicações monitoradas">
          <TableHead><TableRow>
            <TableHeader scope="col">Detalhes</TableHeader>
            <TableSelectAll id="oab-todas" name="oab-todas" aria-label="Selecionar publicações desta página" checked={todasPagina} indeterminate={!todasPagina && publicacoes.some(p => selecionadas.has(p.hash))} disabled={ocupada || !publicacoes.length} onSelect={() => { if (ocupada) return; setSelecionadas(s => { const novo = new Set(s); for (const p of publicacoes) { if (todasPagina) novo.delete(p.hash); else novo.add(p.hash) } return novo }) }} />
            {colunas.map(c => <TableHeader key={c.key} scope="col" isSortable isSortHeader={ordem?.chave === c.key} sortDirection={ordem?.chave === c.key ? ordem.asc ? 'ASC' : 'DESC' : 'NONE'} translateWithId={() => `Ordenar ${c.header} em ordem ${ordem?.chave === c.key && ordem.asc ? 'decrescente' : 'crescente'} nesta página`} onClick={() => { if (!ocupada) setOrdem(o => ({ chave: c.key, asc: o?.chave === c.key ? !o.asc : true })) }}>{c.header}</TableHeader>)}
            <TableHeader scope="col">Ações</TableHeader>
          </TableRow></TableHead>
          <TableBody>{linhas.map(p => {
            const expandida = expandidas.has(p.hash), link = urlPublicacao(p), bloqueada = ocupada || lote
            return <Fragment key={p.hash}>
              <TableRow isSelected={selecionadas.has(p.hash)}>
                <TableCell><Button kind="ghost" size="sm" hasIconOnly renderIcon={expandida ? ChevronDown : ChevronRight} iconDescription={`${expandida ? 'Recolher' : 'Expandir'} publicação ${p.hash}`} aria-expanded={expandida} aria-controls={`oab-detalhes-${p.hash}`} onClick={() => setExpandidas(s => { const novo = new Set(s); if (novo.has(p.hash)) novo.delete(p.hash); else novo.add(p.hash); return novo })} /></TableCell>
                <TableSelectRow id={`oab-selecao-${p.hash}`} name={`oab-selecao-${p.hash}`} aria-label={`Selecionar publicação ${p.hash}`} checked={selecionadas.has(p.hash)} disabled={ocupada} onSelect={() => alternar(p.hash)} />
                {colunas.map(c => <TableCell key={c.key} className={`oab-celula oab-celula-${c.key.split(':')[0]}`}>{c.key === 'processo' || c.key === 'tribunal' ? c.valor(p) : <TextoTabela texto={c.valor(p)} />}</TableCell>)}
                <TableCell><div className="oab-acoes">
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={Launch} iconDescription={link ? `Abrir publicação DJEN ${p.hash} em nova aba` : 'Publicação sem link DJEN disponível'} disabled={bloqueada || !link} onClick={() => { if (!bloqueada && link) window.open(link, '_blank', 'noopener,noreferrer') }} />
                  <OverflowMenu menuOptionsClass={`acoes-tabela-menu--${theme} oab-menu`} key={bloqueada ? 'bloqueado' : 'disponivel'} disabled={bloqueada} flipped size="sm" aria-label={`Ações da publicação ${p.hash}`} iconDescription={`Ações da publicação ${p.hash}`}>
                    <OverflowMenuItem itemText={p.caso_id ? 'Abrir processo' : 'Criar / vincular processo'} disabled={bloqueada || (!p.caso_id && numeroPublicacao(p).length !== 20)} onClick={() => abrirAcao('processo', p)} />
                    <OverflowMenuItem itemText={p.caso_id ? 'Criar atividade' : 'Criar atividade (vincule um processo)'} disabled={bloqueada || !p.caso_id} onClick={() => abrirAcao('atividade', p)} />
                    <OverflowMenuItem itemText="Marcar como tratada" disabled={bloqueada || p.status === 'tratada'} onClick={() => mudarStatus([p.hash], 'tratada')} />
                    <OverflowMenuItem itemText="Arquivar" disabled={bloqueada || p.status === 'arquivada'} onClick={() => mudarStatus([p.hash], 'arquivada')} />
                    {p.status !== 'nao_tratada' && <OverflowMenuItem itemText="Reabrir como não tratada" disabled={bloqueada} onClick={() => mudarStatus([p.hash], 'nao_tratada')} />}
                  </OverflowMenu>
                </div></TableCell>
              </TableRow>
              <TableRow hidden={!expandida} id={`oab-detalhes-${p.hash}`}><TableCell colSpan={colunas.length + 3}><Stack gap={3}>
                <strong>{nomePublicacao(p)}</strong>
                <p>{[p.dados?.siglaTribunal, p.dados?.nomeOrgao, p.dados?.tipoComunicacao].filter(Boolean).join(' · ')}</p>
                <p>Divulgado: {formatarDataSimples(p.dados?.data_disponibilizacao) || '—'} · Capturado: {formatarDataSimples(p.criado_em) || '—'} · Status: {ROTULO_STATUS[p.status]}</p>
                {p.nome_pesquisado && <p>Referência: {formatarNomeExibicao(p.nome_pesquisado)}</p>}
                {p.dados?.destinatarioadvogados?.length ? <p>Advogados: {p.dados.destinatarioadvogados.map(a => `${formatarNomeExibicao(a.nome)} OAB ${a.numero_oab || '?'}/${a.uf_oab || '?'}`).join('; ')}</p> : null}
                <p className="oab-inteiro-teor">{p.dados?.texto || 'Inteiro teor não disponibilizado.'}</p>
              </Stack></TableCell></TableRow>
            </Fragment>
          })}</TableBody>
        </Table></TabelaResponsiva>
      </TableContainer>}
      </DataTable>
      {carregando && <Carregamento tipo="tabela" descricao="Carregando publicações…" />}
      {!carregando && !erro && !publicacoes.length && <InlineNotification kind="info" title="Nenhuma publicação encontrada" subtitle={status ? 'Altere o filtro para ver outras publicações.' : 'Use a captura por OAB para adicionar publicações.'} hideCloseButton lowContrast />}
      <Pagination id="oab-paginacao" size="sm" page={pagina} pageSize={tamanho} pageSizes={[5, 10, 20]} totalItems={total} disabled={ocupada} itemsPerPageText="Itens por página:" backwardText="Página anterior" forwardText="Próxima página" pageNumberText="Página" pageSelectLabelText={() => 'Selecionar página'} pageRangeText={(_, totalPaginas) => `de ${totalPaginas} página(s)`} itemRangeText={(min, max, totalItens) => totalItens ? `${min}–${max} de ${totalItens} publicações` : '0 publicações'} onChange={({ page, pageSize }) => { if (ocupada) return; if (pageSize !== tamanho) { setTamanho(pageSize); setPagina(1); setSelecionadas(new Set()) } else setPagina(page) }} />
    </section>
    <div aria-live="polite">{mensagem && <InlineNotification kind="info" title="Resultado da operação" subtitle={mensagem} lowContrast hideCloseButton />}{erro && <InlineNotification kind="error" title="Não foi possível concluir" subtitle={erro} lowContrast hideCloseButton />}</div>
    {erro && <Button kind="tertiary" size="sm" disabled={ocupada} onClick={carregar}>Tentar atualizar novamente</Button>}
    {modal?.tipo === 'processo' && <ProcessoPublicacao publicacao={modal.p} onClose={() => { setModal(null); void carregar() }} onConcluido={m => { setMensagem(m); setModal(null); void carregar() }} />}
    {modal?.tipo === 'atividade' && <AtividadePublicacao publicacao={modal.p} onClose={() => setModal(null)} onConcluido={m => { setMensagem(m); setModal(null); void carregar() }} />}
    </Stack>
    </Column>
  </Grid>
}
