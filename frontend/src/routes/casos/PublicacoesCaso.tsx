import { useAvisos } from '../../Avisos'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import TabelaResponsiva from '../../TabelaResponsiva'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertDialog, Badge, Button, Callout, Flex, IconButton, Text } from '@radix-ui/themes'
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import {
  advogadosPublicacao, COR_STATUS, corTipo, dataCaptura, dataDivulgacao, nomePublicacao, ROTULO_STATUS, urlPublicacao, type PublicacaoOab,
} from '../publicacoes-oab/dados'
import AtividadePublicacao from '../publicacoes-oab/AtividadePublicacao'
import '../publicacoes-oab/publicacoes.scss'

type AtividadeResumo = { id: string | number; titulo: string; origem_djen_hash?: string | null }
type Status = PublicacaoOab['status']

function resumoTexto(p: PublicacaoOab) {
  const texto = String(p.dados?.texto || p.dados?.teor || p.dados?.conteudo || '').replace(/\s+/g, ' ').trim()
  return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto || 'Inteiro teor não disponibilizado.'
}

export default function PublicacoesCaso({ casoId, onAlterado }: { casoId: string; onAlterado?: () => void }) {
  const { cliente } = useCliente()
  const estreita = useEstreita()
  const [carregando, setCarregando] = useState(true)
  const [operando, setOperando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { avisar } = useAvisos()
  const [publicacoes, setPublicacoes] = useState<PublicacaoOab[] | null>(null)
  const [atividades, setAtividades] = useState<AtividadeResumo[]>([])
  const [filtro, setFiltro] = useState<'nao_tratada' | ''>('')
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [paraDesvincular, setParaDesvincular] = useState<PublicacaoOab | null>(null)
  const [criandoAtividade, setCriandoAtividade] = useState<PublicacaoOab | null>(null)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro(null)
    Promise.all([
      buscarJson<{ publicacoes: PublicacaoOab[] }>(cliente, `/casos/${casoId}/publicacoes`),
      // Só para mostrar qual atividade nasceu de cada publicação; falha não impede a lista.
      buscarJson<{ atividades: AtividadeResumo[] }>(cliente, `/casos/${casoId}/atividades`).catch(() => ({ atividades: [] as AtividadeResumo[] })),
    ])
      .then(([r, ra]) => { setPublicacoes(r.publicacoes ?? []); setAtividades(ra.atividades ?? []) })
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }, [cliente, casoId])
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(carregar, [carregar])

  const ordenadas = useMemo(() => [...(publicacoes ?? [])].sort((a, b) =>
    (b.dados?.data_disponibilizacao || b.criado_em || '').localeCompare(a.dados?.data_disponibilizacao || a.criado_em || '')), [publicacoes])
  const naoTratadas = ordenadas.filter(p => p.status === 'nao_tratada').length
  const visiveis = filtro ? ordenadas.filter(p => p.status === filtro) : ordenadas
  const atividadeDe = (p: PublicacaoOab) => atividades.find(a => a.origem_djen_hash === p.hash)

  async function mudarStatus(p: PublicacaoOab, status: Status, desfazendo = false) {
    if (operando && !desfazendo) return
    const anterior = p.status as Status
    setOperando(true)
    try {
      await enviarJson(cliente, '/publicacoes-oab/status', { hashes: [p.hash], status })
      if (!desfazendo) {
        avisar({
          texto: `Publicação marcada como ${ROTULO_STATUS[status].toLowerCase()}.`,
          desfazer: anterior && anterior !== status ? () => mudarStatus(p, anterior, true) : undefined,
        })
      }
      carregar()
      onAlterado?.()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao atualizar.' })
    } finally { setOperando(false) }
  }
  async function vincularDeNovo(hash: string) {
    try {
      await enviarJson(cliente, `/casos/${casoId}/publicacoes`, { hash })
      carregar()
      onAlterado?.()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao vincular de novo.' })
    }
  }
  async function confirmarDesvincular() {
    if (!paraDesvincular) return
    const hash = paraDesvincular.hash
    setOperando(true)
    try {
      await enviarJson(cliente, `/casos/${casoId}/publicacoes/${hash}`, {}, 'DELETE')
      setParaDesvincular(null)
      avisar({ texto: 'Publicação desvinculada do processo.', desfazer: () => vincularDeNovo(hash) })
      carregar()
      onAlterado?.()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao desvincular.' })
    } finally {
      setOperando(false)
    }
  }
  function alternar(hash: string) {
    setExpandidas(s => { const n = new Set(s); if (n.has(hash)) n.delete(hash); else n.add(hash); return n })
  }

  function acaoPrincipal(p: PublicacaoOab, grande = false) {
    const props = { size: (grande ? '3' : '1') as '1' | '3', style: grande ? { flex: 1 } : undefined, disabled: operando }
    return p.status === 'nao_tratada'
      ? <Button {...props} onClick={() => setCriandoAtividade({ ...p, caso_id: casoId })}>Criar atividade</Button>
      : <Button {...props} variant="soft" color="gray" onClick={() => mudarStatus(p, 'nao_tratada')}>Reabrir</Button>
  }
  function menu(p: PublicacaoOab) {
    const link = urlPublicacao(p)
    return <AcoesTabela rotulo={`publicação de ${dataDivulgacao(p)}`} acoes={[
      ...(link ? [{ texto: 'Abrir no DJEN', href: link }] : []),
      { texto: 'Marcar como tratada', desabilitada: operando || p.status === 'tratada', executar: () => mudarStatus(p, 'tratada') },
      { texto: 'Arquivar', desabilitada: operando || p.status === 'arquivada', executar: () => mudarStatus(p, 'arquivada') },
      { texto: 'Desvincular do processo', executar: () => setParaDesvincular(p), perigo: true },
    ]} />
  }
  const seloTipo = (p: PublicacaoOab) => p.dados?.tipoComunicacao
    ? <Badge color={corTipo(p.dados.tipoComunicacao)} variant="soft">{p.dados.tipoComunicacao}</Badge>
    : <Text size="1" color="gray">—</Text>
  function situacao(p: PublicacaoOab) {
    const atv = atividadeDe(p)
    return (
      <>
        <Badge color={COR_STATUS[p.status]} variant="soft" radius="full">{ROTULO_STATUS[p.status]}</Badge>
        {atv && <div className="oab-secundario">Atividade: {formatarNomeExibicao(atv.titulo)}</div>}
      </>
    )
  }
  function detalhes(p: PublicacaoOab) {
    const link = urlPublicacao(p)
    return (
      <div className="oab-detalhes">
        <dl className="oab-detalhes-grade">
          <div><dt>Partes</dt><dd>{nomePublicacao(p)}</dd></div>
          <div><dt>Advogados intimados</dt><dd>{advogadosPublicacao(p) || '—'}</dd></div>
          <div><dt>Capturado em</dt><dd>{dataCaptura(p)}</dd></div>
        </dl>
        <div>
          <Text as="p" size="1" weight="bold" color="gray" className="oab-rotulo">Inteiro teor</Text>
          <p className="oab-inteiro-teor">{p.dados?.texto || 'Inteiro teor não disponibilizado.'}</p>
        </div>
        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="oab-link">Abrir no DJEN</a>}
      </div>
    )
  }

  return (
    <Flex direction="column" gap="4" className="oab-painel">
      <div className="oab-atalhos" role="group" aria-label="Situação das publicações">
        <Button size="2" radius="full" variant={filtro === 'nao_tratada' ? 'soft' : 'outline'} color={filtro === 'nao_tratada' ? undefined : 'gray'}
          aria-pressed={filtro === 'nao_tratada'} onClick={() => setFiltro('nao_tratada')}>
          Não tratadas {naoTratadas > 0 ? <Badge color="red" variant="solid" radius="full">{naoTratadas}</Badge> : <Text size="1" color="gray">0</Text>}
        </Button>
        <Button size="2" radius="full" variant={!filtro ? 'soft' : 'outline'} color={!filtro ? undefined : 'gray'}
          aria-pressed={!filtro} onClick={() => setFiltro('')}>
          Todas <Text size="1" color="gray">{ordenadas.length}</Text>
        </Button>
      </div>

      <div aria-live="polite">
        {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && publicacoes && !visiveis.length && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>{publicacoes.length ? 'Nenhuma publicação não tratada neste processo.' : 'Nenhuma publicação vinculada a este processo.'}</Callout.Text>
          </Callout.Root>
        )}
      </div>

      {!carregando && visiveis.length > 0 && (estreita ? (
        <ul className="oab-cartoes">
          {visiveis.map(p => {
            const aberta = expandidas.has(p.hash)
            return (
              <li key={p.hash} className="oab-cartao">
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="2" weight="bold">{dataDivulgacao(p)}</Text>
                  {seloTipo(p)}
                  <span style={{ marginLeft: 'auto' }}><Badge color={COR_STATUS[p.status]} variant="soft" radius="full">{ROTULO_STATUS[p.status]}</Badge></span>
                </Flex>
                <div className="oab-secundario">{p.dados?.nomeOrgao}</div>
                <Text as="p" size="2">{aberta ? null : resumoTexto(p)}</Text>
                {aberta && detalhes(p)}
                <Flex gap="2" align="center" className="oab-cartao-acoes">
                  {acaoPrincipal(p, true)}
                  <Button size="3" variant="soft" color="gray" aria-expanded={aberta} onClick={() => alternar(p.hash)}>{aberta ? 'Fechar' : 'Ler'}</Button>
                  {menu(p)}
                </Flex>
              </li>
            )
          })}
        </ul>
      ) : (
        <TabelaResponsiva principais={['Resumo']}>
          <table aria-label="Publicações do processo" className="oab-tabela pubcaso-tabela">
            <thead>
              <tr>
                <th aria-label="Detalhes" />
                <th className="oab-col-data">Divulgado</th>
                <th className="oab-col-tipo">Tipo</th>
                <th>Resumo</th>
                <th className="oab-col-situacao">Situação</th>
                <th className="tabela-acoes oab-col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(p => {
                const aberta = expandidas.has(p.hash)
                return (
                  <Fragment key={p.hash}>
                    <tr>
                      <td>
                        <IconButton variant="ghost" size="1" aria-expanded={aberta} aria-label={`${aberta ? 'Recolher' : 'Expandir'} publicação de ${dataDivulgacao(p)}`} onClick={() => alternar(p.hash)}>
                          {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </IconButton>
                      </td>
                      <td>
                        <div className="oab-data">{dataDivulgacao(p)}</div>
                        <div className="oab-secundario">{p.dados?.nomeOrgao}</div>
                      </td>
                      <td>{seloTipo(p)}</td>
                      <td>{resumoTexto(p)}</td>
                      <td>{situacao(p)}</td>
                      <td className="tabela-acoes"><Flex gap="1" justify="end" align="center">{acaoPrincipal(p)}{menu(p)}</Flex></td>
                    </tr>
                    {aberta && <tr><td colSpan={6} className="oab-detalhes-celula">{detalhes(p)}</td></tr>}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </TabelaResponsiva>
      ))}

      {criandoAtividade && (
        <AtividadePublicacao publicacao={criandoAtividade} onClose={() => setCriandoAtividade(null)}
          onConcluido={m => { avisar({ texto: m }); setCriandoAtividade(null); carregar(); onAlterado?.() }} />
      )}
      <AlertDialog.Root open={paraDesvincular !== null} onOpenChange={(open) => !open && setParaDesvincular(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Desvincular publicação</AlertDialog.Title>
          <AlertDialog.Description>Desvincular esta publicação do processo? Ela continua em Publicações recebidas, sem processo vinculado.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={operando} onClick={confirmarDesvincular}>Desvincular</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
