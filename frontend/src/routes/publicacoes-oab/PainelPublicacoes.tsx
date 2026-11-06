import TabelaResponsiva from '../../TabelaResponsiva'
import AcoesTabela from '../../AcoesTabela'
import TextoTabela from '../../TextoTabela'
import Carregamento from '../../Carregamento'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Archive, Check, ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react'
import { Button, Callout, Card, Checkbox, Flex, Heading, IconButton, Popover, Select, Text } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { useNavegacao } from '../../api/NavegacaoContext'
import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'
import { catalogoColunas, CHAVE_COLUNAS, lerPreferencias, nomePublicacao, numeroPublicacao, ROTULO_STATUS, urlPublicacao, type PublicacaoOab } from './dados'
import ProcessoPublicacao from './ProcessoPublicacao'
import AtividadePublicacao from './AtividadePublicacao'
import './publicacoes.scss'

type RespostaLista = { publicacoes: PublicacaoOab[]; total: number; pagina: number; campos_djen?: string[]; hashes_disponiveis?: string[] }
type ResultadoStatus = { hashes_atualizados: string[]; hashes_falharam: string[] }

export default function PainelPublicacoes({ Captura }: { Captura: ComponentType<{ onCapturado: () => void }> }) {
  const { cliente } = useCliente(), { irPara, consumirPayload, versaoNavegacao } = useNavegacao()
  const [status, setStatus] = useState(''), [pagina, setPagina] = useState(1), [tamanho, setTamanho] = useState(5)
  useEffect(() => {
    const destino = consumirPayload<{ status?: string }>('publicacoes-oab')
    if (destino?.status === 'nao_tratada') { setStatus('nao_tratada'); setPagina(1) }
  }, [consumirPayload, versaoNavegacao])
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
  const algumasPagina = publicacoes.some(p => selecionadas.has(p.hash)) && !todasPagina
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
  function ordenarPor(chave: string) {
    if (ocupada) return
    setOrdem(o => ({ chave, asc: o?.chave === chave ? !o.asc : true }))
  }
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho))

  return (
    <Flex direction="column" gap="6" className="oab-painel">
      <div>
        <Heading as="h1" size="6">Publicações monitoradas</Heading>
        <Text as="p" size="2" color="gray" mt="1">Revise as publicações capturadas pelos monitoramentos por OAB.</Text>
      </div>
      <Callout.Root color="blue" size="1">
        <Callout.Icon><Info size={14} /></Callout.Icon>
        <Callout.Text>
          A captura dos monitoramentos por OAB ocorre a cada 24 horas. Os avisos por e-mail são verificados a cada 6 horas.
          Não tratada: aguarda revisão, mesmo quando vinculada a um processo. Tratada: revisão confirmada ou atividade criada.
          Arquivada: dispensada, preservando dados e vínculos. É possível reabrir.
        </Callout.Text>
      </Callout.Root>
      <fieldset className="oab-captura" disabled={ocupada || lote}><Captura onCapturado={carregar} /></fieldset>
      <section aria-label="Lista de publicações" aria-busy={carregando || operacao}>
        <Flex direction="column" gap="3">
          {lote ? (
            <Card variant="surface">
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Text size="2">{selecionadas.size} selecionada(s)</Text>
                <Flex gap="2">
                  <Button size="1" disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'tratada', true)}>
                    <Check size={14} /> Marcar como tratada
                  </Button>
                  <Button size="1" variant="soft" disabled={ocupada} onClick={() => mudarStatus([...selecionadas], 'arquivada', true)}>
                    <Archive size={14} /> Arquivar
                  </Button>
                  <Button size="1" variant="ghost" disabled={operacao} onClick={() => setSelecionadas(new Set())}>Cancelar</Button>
                </Flex>
              </Flex>
            </Card>
          ) : (
            <div className="aj-acoes-linha">
              <div className="form-campo" style={{ minWidth: 180 }}>
                <Select.Root value={status || '__todos__'} disabled={ocupada} onValueChange={(v) => { const novo = v === '__todos__' ? '' : v; setStatus(novo); setPagina(1); setSelecionadas(new Set()); setMensagem('') }}>
                  <Select.Trigger placeholder="Status" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__todos__">Todos</Select.Item>
                    {Object.entries(ROTULO_STATUS).map(([v, r]) => <Select.Item key={v} value={v}>{r}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
              </div>
              <Button size="1" variant="ghost" disabled={ocupada} onClick={carregar}>Atualizar lista</Button>
              <Popover.Root>
                <Popover.Trigger>
                  <Button size="1" variant="outline" color="gray" disabled={ocupada}>Colunas</Button>
                </Popover.Trigger>
                <Popover.Content style={{ width: 280 }}>
                  <Text size="1" weight="bold" mb="2">Colunas visíveis</Text>
                  <div className="aj-multiselect-lista" onPointerDown={e => { if ((e.target as HTMLElement).closest('label')) e.preventDefault() }}>
                    {catalogo.map(c => (
                      <Text as="label" size="2" key={c.key}>
                        <Flex gap="2" align="center">
                          <Checkbox
                            checked={Boolean(c.obrigatoria || preferencias.includes(c.key))}
                            disabled={c.obrigatoria}
                            onCheckedChange={(checked) => escolherColuna(c.key, Boolean(checked))}
                          />
                          {c.header}{c.obrigatoria ? ' — sempre visível' : ''}
                        </Flex>
                      </Text>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Root>
            </div>
          )}

          <TabelaResponsiva principais={['Processo']}>
            <table aria-label="Publicações monitoradas">
              <thead>
                <tr>
                  <th aria-label="Detalhes" />
                  <th className="tabela-controle">
                    <Checkbox
                      aria-label="Selecionar publicações desta página"
                      checked={todasPagina ? true : algumasPagina ? 'indeterminate' : false}
                      disabled={ocupada || !publicacoes.length}
                      onCheckedChange={() => { if (ocupada) return; setSelecionadas(s => { const novo = new Set(s); for (const p of publicacoes) { if (todasPagina) novo.delete(p.hash); else novo.add(p.hash) } return novo }) }}
                    />
                  </th>
                  {colunas.map(c => (
                    <th key={c.key}>
                      <Button variant="ghost" size="1" color="gray" disabled={ocupada} onClick={() => ordenarPor(c.key)} style={{ padding: '0 4px' }}>
                        {c.header}{ordem?.chave === c.key ? (ordem.asc ? ' ↑' : ' ↓') : ''}
                      </Button>
                    </th>
                  ))}
                  <th className="tabela-acoes">Ações</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(p => {
                  const expandida = expandidas.has(p.hash), link = urlPublicacao(p), bloqueada = ocupada || lote
                  return (
                    <Fragment key={p.hash}>
                      <tr>
                        <td>
                          <Button
                            variant="ghost" size="1"
                            aria-expanded={expandida} aria-controls={`oab-detalhes-${p.hash}`}
                            aria-label={`${expandida ? 'Recolher' : 'Expandir'} publicação ${p.hash}`}
                            onClick={() => setExpandidas(s => { const novo = new Set(s); if (novo.has(p.hash)) novo.delete(p.hash); else novo.add(p.hash); return novo })}
                          >
                            {expandida ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </Button>
                        </td>
                        <td className="tabela-controle">
                          <Checkbox aria-label={`Selecionar publicação ${p.hash}`} checked={selecionadas.has(p.hash)} disabled={ocupada} onCheckedChange={() => alternar(p.hash)} />
                        </td>
                        {colunas.map(c => (
                          <td key={c.key} className={`oab-celula oab-celula-${c.key.split(':')[0]}`}>
                            {c.key === 'processo' || c.key === 'tribunal' ? c.valor(p) : <TextoTabela texto={c.valor(p)} />}
                          </td>
                        ))}
                        <td className="tabela-acoes">
                          <Flex gap="1" justify="end">
                            <IconButton
                              variant="ghost" size="1" color="gray"
                              aria-label={link ? `Abrir publicação DJEN ${p.hash} em nova aba` : 'Publicação sem link DJEN disponível'}
                              disabled={bloqueada || !link}
                              onClick={() => { if (!bloqueada && link) window.open(link, '_blank', 'noopener,noreferrer') }}
                            >
                              <ExternalLink size={14} />
                            </IconButton>
                            <AcoesTabela rotulo={`publicação ${p.hash}`} acoes={[
                              { texto: p.caso_id ? 'Abrir processo' : 'Criar / vincular processo', desabilitada: bloqueada || (!p.caso_id && numeroPublicacao(p).length !== 20), executar: () => abrirAcao('processo', p) },
                              { texto: p.caso_id ? 'Criar atividade' : 'Criar atividade (vincule um processo)', desabilitada: bloqueada || !p.caso_id, executar: () => abrirAcao('atividade', p) },
                              { texto: 'Marcar como tratada', desabilitada: bloqueada || p.status === 'tratada', executar: () => mudarStatus([p.hash], 'tratada') },
                              { texto: 'Arquivar', desabilitada: bloqueada || p.status === 'arquivada', executar: () => mudarStatus([p.hash], 'arquivada') },
                              ...(p.status !== 'nao_tratada' ? [{ texto: 'Reabrir como não tratada', desabilitada: bloqueada, executar: () => mudarStatus([p.hash], 'nao_tratada') }] : []),
                            ]} />
                          </Flex>
                        </td>
                      </tr>
                      {expandida && (
                        <tr id={`oab-detalhes-${p.hash}`}>
                          <td colSpan={colunas.length + 3}>
                            <Flex direction="column" gap="3">
                              <Text weight="bold">{nomePublicacao(p)}</Text>
                              <Text as="p" size="2">{[p.dados?.siglaTribunal, p.dados?.nomeOrgao, p.dados?.tipoComunicacao].filter(Boolean).join(' · ')}</Text>
                              <Text as="p" size="2">Divulgado: {formatarDataSimples(p.dados?.data_disponibilizacao) || '—'} · Capturado: {formatarDataSimples(p.criado_em) || '—'} · Status: {ROTULO_STATUS[p.status]}</Text>
                              {p.nome_pesquisado && <Text as="p" size="2">Referência: {formatarNomeExibicao(p.nome_pesquisado)}</Text>}
                              {p.dados?.destinatarioadvogados?.length ? <Text as="p" size="2">Advogados: {p.dados.destinatarioadvogados.map(a => `${formatarNomeExibicao(a.nome)} OAB ${a.numero_oab || '?'}/${a.uf_oab || '?'}`).join('; ')}</Text> : null}
                              <Text as="p" size="2" className="oab-inteiro-teor">{p.dados?.texto || 'Inteiro teor não disponibilizado.'}</Text>
                            </Flex>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </TabelaResponsiva>

          {carregando && <Carregamento tipo="tabela" descricao="Carregando publicações…" />}
          {!carregando && !erro && !publicacoes.length && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>{status ? 'Nenhuma publicação encontrada. Altere o filtro para ver outras publicações.' : 'Nenhuma publicação encontrada. Use a captura por OAB para adicionar publicações.'}</Callout.Text>
            </Callout.Root>
          )}

          <nav aria-label="Páginas de publicações monitoradas" className="aj-paginacao">
            <Select.Root value={String(tamanho)} disabled={ocupada} onValueChange={(v) => { const novo = Number(v); if (novo !== tamanho) { setTamanho(novo); setPagina(1); setSelecionadas(new Set()) } }}>
              <Select.Trigger />
              <Select.Content>
                {[5, 10, 20].map(n => <Select.Item key={n} value={String(n)}>{n} por página</Select.Item>)}
              </Select.Content>
            </Select.Root>
            <Button variant="ghost" size="1" disabled={ocupada || pagina <= 1} onClick={() => setPagina(p => p - 1)}>Página anterior</Button>
            <Text size="2">Página {pagina} de {totalPaginas}</Text>
            <Button variant="ghost" size="1" disabled={ocupada || pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>Próxima página</Button>
            <Text size="2" color="gray">{total ? `${total} publicações` : '0 publicações'}</Text>
          </nav>
        </Flex>
      </section>
      <div aria-live="polite">
        {mensagem && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>{mensagem}</Callout.Text>
          </Callout.Root>
        )}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
      </div>
      {erro && <Button variant="soft" size="1" disabled={ocupada} onClick={carregar} style={{ alignSelf: 'flex-start' }}>Tentar atualizar novamente</Button>}
      {modal?.tipo === 'processo' && <ProcessoPublicacao publicacao={modal.p} onClose={() => { setModal(null); void carregar() }} onConcluido={m => { setMensagem(m); setModal(null); void carregar() }} />}
      {modal?.tipo === 'atividade' && <AtividadePublicacao publicacao={modal.p} onClose={() => setModal(null)} onConcluido={m => { setMensagem(m); setModal(null); void carregar() }} />}
    </Flex>
  )
}
