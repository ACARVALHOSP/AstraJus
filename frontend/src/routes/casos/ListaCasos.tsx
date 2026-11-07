import CabecalhoPagina from '../../CabecalhoPagina'
import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AlertDialog, Badge, Button, Callout, Flex, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { useNavegacao } from '../../api/NavegacaoContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples, formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { alternarCasoFavorito, ehCasoFavorito } from '../../utils/listasRapidas'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import NovoProcessoModal from './NovoProcessoModal'

export type Caso = {
  id: string
  titulo?: string
  status?: string
  processos?: string[]
  cliente_id?: string
  clientes_adicionais?: string[]
  acao?: string
  foro?: string
  responsavel?: string
  pasta?: string
  acesso?: string
  ultima_movimentacao?: string
  monitorado?: boolean
  desfecho?: string
}

type Cliente = { id: string; nome?: string }

const ROTULO_DESFECHO: Record<string, string> = {
  procedente: 'Procedente',
  procedente_parcial: 'Parc. procedente',
  improcedente: 'Improcedente',
  acordo: 'Acordo',
  extinto: 'Extinto s/ mérito',
  provido: 'Provido',
  desprovido: 'Desprovido',
}

function formatarClasse(valor?: string): string {
  const siglas = new Set(['CNJ', 'STF', 'STJ', 'TST', 'TRT', 'TRF', 'TJ', 'OAB', 'INSS', 'FGTS', 'ICMS', 'IPI', 'IPTU', 'ISS', 'IRPF', 'IRPJ', 'CPC', 'CPP', 'CLT', 'CDC', 'ECA', 'CTN', 'JEC', 'JEFAZ'])
  return String(valor || '')
    .split(' - ')
    .map((parte) => {
      const texto = parte
        .trim()
        .toLocaleLowerCase('pt-BR')
        .replace(/\p{L}+/gu, (palavra) => (siglas.has(palavra.toLocaleUpperCase('pt-BR')) ? palavra.toLocaleUpperCase('pt-BR') : palavra))
      return texto.replace(/^\p{L}/u, (letra) => letra.toLocaleUpperCase('pt-BR'))
    })
    .filter(Boolean)
    .join(' · ')
}

export default function ListaCasos({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [casos, setCasos] = useState<Caso[] | null>(null)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [busca, setBusca] = useState('')
  const [paraExcluir, setParaExcluir] = useState<Caso | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [casoCriado, setCasoCriado] = useState<Caso | null>(null)
  const botaoNovo = useRef<HTMLButtonElement>(null)

  const carregar = () => {
    setCarregando(true)
    setErro(null)
    Promise.all([
      buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      buscarJson<{ clientes: Cliente[] }>(cliente, '/clientes'),
    ])
      .then(([respCasos, respClientes]) => {
        setCasos(respCasos.casos ?? [])
        setClientes(respClientes.clientes ?? [])
      })
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }

  function favoritar(casoId: string) {
    alternarCasoFavorito(casoId)
    setCasos((atual) => (atual ? [...atual] : atual))
  }

  useEffect(carregar, [cliente])

  const nomeCliente = (id?: string) => clientes.find((c) => c.id === id)?.nome ?? id ?? ''

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/casos/${paraExcluir.id}`, {}, 'DELETE')
      setCasos((atual) => atual?.filter((c) => c.id !== paraExcluir.id) ?? null)
      setParaExcluir(null)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const normalizarFiltro = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()
  const termo = normalizarFiltro(busca)
  const numeroFiltro = /^[\d.\-/\s]+$/.test(busca) ? busca.replace(/\D/g, '') : ''
  const filtrados = (casos ?? []).filter((c) => {
    if (!termo) return true
    if (numeroFiltro.length >= 4 && c.processos?.some((numero) => numero.replace(/\D/g, '').includes(numeroFiltro))) return true
    const textos = [c.titulo, c.acao, c.foro, c.responsavel, nomeCliente(c.cliente_id), ...(c.clientes_adicionais ?? []).map(nomeCliente), ...(c.processos ?? [])].map(
      (t) => normalizarFiltro(t || ''),
    )
    return textos.some((t) => t.includes(termo))
  })
  const ordenados = [...filtrados].sort((a, b) => (b.ultima_movimentacao || '').localeCompare(a.ultima_movimentacao || ''))

  return (
    <div className="casos-lista">
      <Flex direction="column" gap="6">
        <CabecalhoPagina
          titulo="Processos"
          focavel
          descricao="Cadastros, atividades e acompanhamento do escritório."
          acoes={<Button ref={botaoNovo} size="2" onClick={() => setModalNovoAberto(true)}>Novo processo</Button>}
        />
        {casoCriado && (
          <Callout.Root color="green" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>
              Processo "{casoCriado.titulo || 'sem título'}" cadastrado.{' '}
              <button type="button" className="contato-nome-link" onClick={() => onAbrir(casoCriado.id)}>
                Abrir processo criado
              </button>{' '}
              <button type="button" className="contato-nome-link" onClick={() => setCasoCriado(null)}>
                Fechar
              </button>
            </Callout.Text>
          </Callout.Root>
        )}
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="casos-busca">Filtrar processos</label>
          <TextField.Root
            id="casos-busca"
            placeholder="Filtrar processos"
            autoComplete="off"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Text size="1" color="gray">Filtre por título, cliente, classe/ação, órgão julgador, responsável ou número do processo.</Text>
        </div>
        <div aria-live="polite">
          {carregando && <Carregamento colunas={6} />}
          {erro && (
            <Flex direction="column" gap="3">
              <Callout.Root color="red" size="1">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{erro}</Callout.Text>
              </Callout.Root>
              <Button variant="soft" size="1" onClick={carregar} disabled={carregando} style={{ alignSelf: 'flex-start' }}>Tentar novamente</Button>
            </Flex>
          )}
          {!carregando && casos && casos.length === 0 && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>Nenhum processo cadastrado ainda.</Callout.Text>
            </Callout.Root>
          )}
          {!carregando && casos && casos.length > 0 && ordenados.length === 0 && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>Nenhum processo corresponde ao filtro.</Callout.Text>
            </Callout.Root>
          )}
          {!carregando && ordenados.length > 0 && (
            <section aria-label="Processos cadastrados">
              <p className="casos-contagem">{ordenados.length} {ordenados.length === 1 ? 'processo' : 'processos'}</p>
              <TabelaResponsiva principais={['Título']}>
                <table aria-label="Processos cadastrados" className="casos-tabela">
                  <thead>
                    <tr>
                      <th>Favorito</th>
                      <th>Título</th>
                      <th>Cliente e pasta</th>
                      <th>Classe e foro</th>
                      <th>Última movimentação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenados.map((caso) => {
                      const nomes = [caso.cliente_id, ...(caso.clientes_adicionais ?? [])].map(nomeCliente).filter(Boolean).map(formatarNomeExibicao)
                      const favoritado = ehCasoFavorito(caso.id)
                      return (
                        <tr key={caso.id}>
                          <td data-label="Favorito">
                            <Button
                              variant="ghost"
                              size="1"
                              aria-label={favoritado ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                              onClick={() => favoritar(caso.id)}
                            >
                              <Star size={16} fill={favoritado ? 'currentColor' : 'none'} />
                            </Button>
                          </td>
                          <td className="casos-celula-principal" data-label="Título">
                            <TextoTabela texto={caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)'} onClick={() => onAbrir(caso.id)} />
                            {caso.monitorado && <Badge color="green" size="1" ml="1">Monitorado</Badge>}
                            {caso.desfecho && ROTULO_DESFECHO[caso.desfecho] && (
                              <Badge color="purple" size="1" ml="1">{ROTULO_DESFECHO[caso.desfecho]}</Badge>
                            )}
                            <div>
                              {(caso.processos ?? []).map((numero, i) => (
                                <span key={numero}>
                                  {i > 0 && ', '}
                                  <button
                                    type="button"
                                    className="contato-nome-link"
                                    onClick={() => irPara('processo', { tribunal: siglaTribunalPorNumero(numero) ?? '', numero_processo: numero })}
                                  >
                                    {formatarNumeroCNJ(numero)}
                                  </button>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td data-label="Cliente e pasta">
                            <TextoTabela texto={nomes.join(', ') || 'Sem cliente vinculado'} />
                            {caso.pasta && <div className="casos-celula-secundaria"><TextoTabela texto={caso.pasta} /></div>}
                          </td>
                          <td data-label="Classe e foro">
                            <TextoTabela texto={formatarClasse(caso.acao) || 'Classe não informada'} />
                            {caso.foro && <div className="casos-celula-secundaria"><TextoTabela texto={caso.foro} /></div>}
                          </td>
                          <td data-label="Última movimentação">{formatarDataSimples(caso.ultima_movimentacao)}</td>
                          <td data-label="Ações">
                            <AcoesTabela rotulo={caso.titulo || 'processo'} acoes={[{ texto: 'Excluir', executar: () => setParaExcluir(caso), perigo: true }]} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TabelaResponsiva>
            </section>
          )}
        </div>
        <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
          <AlertDialog.Content maxWidth="400px">
            <AlertDialog.Title>Excluir processo</AlertDialog.Title>
            <AlertDialog.Description>
              Excluir o processo "{paraExcluir?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">Cancelar</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button color="red" disabled={excluindo} onClick={confirmarExclusao}>Excluir</Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
        <NovoProcessoModal
          open={modalNovoAberto}
          launcherButtonRef={botaoNovo}
          clientes={clientes.map((c) => ({ id: c.id, nome: c.nome ?? '' }))}
          onClose={() => setModalNovoAberto(false)}
          onCriado={(novoCaso) => {
            setCasos((atual) => [...(atual ?? []), novoCaso])
            setModalNovoAberto(false)
            setCasoCriado(novoCaso)
          }}
        />
      </Flex>
    </div>
  )
}
