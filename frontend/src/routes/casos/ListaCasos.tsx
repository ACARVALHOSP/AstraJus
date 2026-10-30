import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { Star, StarFilled } from '@carbon/icons-react'
import { useEffect, useRef, useState } from 'react'
import { ActionableNotification, Button, InlineNotification, Modal, Stack, Tag, TextInput, Grid, Column, Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from '@carbon/react'
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

  const normalizarFiltro = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
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
    <Grid fullWidth narrow className="casos-lista"><Column sm={4} md={8} lg={16}><Stack gap={6}>
      <div className="casos-titulo-linha">
        <div><h1 tabIndex={-1}>Processos</h1><p className="casos-ajuda">Cadastros, atividades e acompanhamento do escritório.</p></div>
        <Button ref={botaoNovo} size="sm" onClick={() => setModalNovoAberto(true)}>
          Novo processo
        </Button>
      </div>
      {casoCriado && (
        <ActionableNotification
          kind="success"
          title={`Processo "${casoCriado.titulo || 'sem título'}" cadastrado.`}
          actionButtonLabel="Abrir processo criado"
          onActionButtonClick={() => onAbrir(casoCriado.id)}
          onCloseButtonClick={() => setCasoCriado(null)}
          lowContrast
          inline
        />
      )}
      <TextInput
        id="casos-busca"
        labelText="Filtrar processos"
        placeholder="Filtrar processos"
        helperText="Filtre por título, cliente, classe/ação, órgão julgador, responsável ou número do processo."
        autoComplete="off"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <div aria-live="polite">
        {carregando && <Carregamento colunas={6} />}
        {erro && <Stack gap={4}><InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton /><Button kind="tertiary" size="sm" onClick={carregar} disabled={carregando}>Tentar novamente</Button></Stack>}
        {!carregando && casos && casos.length === 0 && <InlineNotification kind="info" title="Nenhum processo cadastrado ainda" lowContrast hideCloseButton />}
        {!carregando && casos && casos.length > 0 && ordenados.length === 0 && (
          <InlineNotification kind="info" title="Nenhum processo corresponde ao filtro." lowContrast hideCloseButton />
        )}
        {!carregando && ordenados.length > 0 && (
          <section aria-label="Processos cadastrados"><p className="casos-contagem">{ordenados.length} {ordenados.length === 1 ? 'processo' : 'processos'}</p>
            <Table size="xl" className="casos-tabela" aria-label="Processos cadastrados">
              <TableHead>
                <TableRow>
                  <TableHeader>Favorito</TableHeader>
                  <TableHeader>Título</TableHeader>
                  <TableHeader>Cliente e pasta</TableHeader>
                  <TableHeader>Classe e foro</TableHeader>
                  <TableHeader>Última movimentação</TableHeader>
                  <TableHeader>Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {ordenados.map((caso) => {
                  const nomes = [caso.cliente_id, ...(caso.clientes_adicionais ?? [])].map(nomeCliente).filter(Boolean).map(formatarNomeExibicao)
                  const favoritado = ehCasoFavorito(caso.id)
                  return (
                    <TableRow key={caso.id}>
                      <TableCell data-label="Favorito">
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          iconDescription={favoritado ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                          onClick={() => favoritar(caso.id)}
                        >
                          {favoritado ? <StarFilled size={16} /> : <Star size={16} />}
                        </Button>
                      </TableCell>
                      <TableCell className="casos-celula-principal" data-label="Título">
                        <TextoTabela texto={caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)'} onClick={() => onAbrir(caso.id)} />
                        {caso.monitorado && <Tag type="green" size="sm">Monitorado</Tag>}
                        {caso.desfecho && ROTULO_DESFECHO[caso.desfecho] && (
                          <Tag type="purple" size="sm">
                            {ROTULO_DESFECHO[caso.desfecho]}
                          </Tag>
                        )}
                        <div>
                          {(caso.processos ?? []).map((numero, i) => (
                            <span key={numero}>
                              {i > 0 && ', '}
                              <button
                                type="button"
                                className="contato-nome-link"
                                onClick={() =>
                                  irPara('processo', { tribunal: siglaTribunalPorNumero(numero) ?? '', numero_processo: numero })
                                }
                              >
                                {formatarNumeroCNJ(numero)}
                              </button>
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell data-label="Cliente e pasta">
                        <TextoTabela texto={nomes.join(', ') || 'Sem cliente vinculado'} />{caso.pasta && <div className="casos-celula-secundaria"><TextoTabela texto={caso.pasta} /></div>}
                      </TableCell>
                      <TableCell data-label="Classe e foro">
                        <TextoTabela texto={formatarClasse(caso.acao) || 'Classe não informada'} />{caso.foro && <div className="casos-celula-secundaria"><TextoTabela texto={caso.foro} /></div>}
                      </TableCell>
                      <TableCell data-label="Última movimentação">{formatarDataSimples(caso.ultima_movimentacao)}</TableCell>
                      <TableCell data-label="Ações">
                        <AcoesTabela rotulo={caso.titulo || 'processo'} acoes={[{ texto: 'Excluir', executar: () => setParaExcluir(caso), perigo: true }]} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </section>
        )}
      </div>
      <Modal closeButtonLabel="Fechar"
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir processo"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir o processo "{paraExcluir?.titulo || '(sem título)'}"? Essa ação não pode ser desfeita.</p>
      </Modal>
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
    </Stack></Column></Grid>
  )
}
