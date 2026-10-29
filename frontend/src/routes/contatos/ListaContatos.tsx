import { useEffect, useState } from 'react'
import {
  Button,
  DataTable,
  InlineNotification,
  Modal,
  Stack,
  Table,
  TableBatchAction,
  TableBatchActions,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAll,
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
} from '@carbon/react'
import { Edit, Tag as TagIcon } from '@carbon/icons-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { traduzirTabela } from '../../utils/tabela'
import ClientesLoteModal from './ClientesLoteModal'

export type ClienteItem = {
  id: string
  nome: string
  tipo_pessoa?: string
  perfil?: string
  telefone?: string
  email?: string
  etiquetas?: string[]
}

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export default function ListaContatos({ onAbrir, onNovo }: { onAbrir: (id: string) => void; onNovo: () => void }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [clientes, setClientes] = useState<ClienteItem[] | null>(null)
  const [busca, setBusca] = useState('')
  const [letra, setLetra] = useState('TODOS')
  const [paraExcluir, setParaExcluir] = useState<ClienteItem | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [idsLote, setIdsLote] = useState<string[]>([])
  const [loteAberto, setLoteAberto] = useState<'etiquetas' | 'perfil' | null>(null)

  const carregar = () => {
    setCarregando(true)
    setErro(null)
    buscarJson<{ clientes: ClienteItem[] }>(cliente, '/clientes')
      .then((r) => setClientes(r.clientes ?? []))
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [cliente])

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/clientes/${paraExcluir.id}`, {}, 'DELETE')
      setClientes((atual) => atual?.filter((c) => c.id !== paraExcluir.id) ?? null)
      setParaExcluir(null)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const consulta = normalizar(busca)
  const digitos = consulta.replace(/\D/g, '')
  const filtrados = (clientes ?? []).filter((c) => {
    if (letra !== 'TODOS' && normalizar(c.nome).charAt(0).toUpperCase() !== letra) return false
    if (!consulta) return true
    const alvo = normalizar(`${c.nome || ''} ${c.telefone || ''} ${c.email || ''}`)
    const telefoneCombina = digitos && /^[+\d\s().-]+$/.test(consulta) && String(c.telefone || '').replace(/\D/g, '').includes(digitos)
    return alvo.includes(consulta) || telefoneCombina
  })
  const filtrosAtivos = [...(letra !== 'TODOS' ? [`Inicial: ${letra}`] : []), ...(busca.trim() ? [`Texto: "${busca.trim()}"`] : [])]

  const etiquetasExistentes = [...new Set((clientes ?? []).flatMap((c) => c.etiquetas ?? []))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <Stack gap={6}>
      <div className="aj-layout-36">
        <h2>Clientes</h2>
        <Button size="sm" onClick={onNovo}>
          Novo cliente
        </Button>
      </div>
      <div role="group" aria-label="Filtrar clientes pela inicial do nome" className="aj-layout-37">
        {['TODOS', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => (
          <Button key={l} kind={l === letra ? 'primary' : 'ghost'} size="sm" onClick={() => setLetra(l)}>
            {l}
          </Button>
        ))}
      </div>
      <TextInput id="contatos-busca" labelText="Consultar clientes" placeholder="Nome, telefone ou e-mail" autoComplete="off" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {clientes && (
        <p>
          Mostrando {filtrados.length} de {clientes.length} cliente(s). {filtrosAtivos.join('; ') || 'Sem filtros ativos'}.
        </p>
      )}
      {filtrosAtivos.length > 0 && (
        <Button
          kind="ghost"
          size="sm"
          onClick={() => {
            setLetra('TODOS')
            setBusca('')
          }}
        >
          Limpar filtros
        </Button>
      )}
      <div aria-live="polite">
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && clientes && clientes.length === 0 && (
          <InlineNotification kind="info" title="Nenhum cliente cadastrado ainda" lowContrast hideCloseButton />
        )}
        {!carregando && clientes && clientes.length > 0 && filtrados.length === 0 && (
          <InlineNotification
            kind="info"
            title="Nenhum cliente corresponde aos filtros"
            subtitle="Confira o texto ou limpe a busca para ver todos os clientes."
            lowContrast
            hideCloseButton
          />
        )}
        {!carregando && filtrados.length > 0 && (
          <TabelaContatos
            clientes={filtrados}
            onAbrir={onAbrir}
            onExcluir={setParaExcluir}
            onLote={(tipo, ids) => {
              setIdsLote(ids)
              setLoteAberto(tipo)
            }}
          />
        )}
      </div>
      <Modal closeButtonLabel="Fechar"
        open={paraExcluir !== null}
        danger
        modalHeading="Excluir cliente"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(null)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir o cliente "{paraExcluir?.nome}"? Essa ação não pode ser desfeita.</p>
      </Modal>
      {loteAberto && (
        <ClientesLoteModal
          open
          tipo={loteAberto}
          ids={idsLote}
          etiquetasExistentes={etiquetasExistentes}
          onClose={() => setLoteAberto(null)}
          onConcluido={() => {
            setLoteAberto(null)
            setIdsLote([])
            carregar()
          }}
        />
      )}
    </Stack>
  )
}

const CABECALHOS_CONTATOS = [
  { key: 'nome', header: 'Nome' },
  { key: 'tipo', header: 'Tipo' },
  { key: 'perfil', header: 'Perfil' },
  { key: 'telefone', header: 'Telefone' },
  { key: 'email', header: 'E-mail' },
  { key: 'etiquetas', header: 'Etiquetas' },
]

function TabelaContatos({
  clientes,
  onAbrir,
  onExcluir,
  onLote,
}: {
  clientes: ClienteItem[]
  onAbrir: (id: string) => void
  onExcluir: (c: ClienteItem) => void
  onLote: (tipo: 'etiquetas' | 'perfil', ids: string[]) => void
}) {
  const porId = new Map(clientes.map((c) => [c.id, c]))
  const linhas = clientes.map((c) => ({
    id: c.id,
    nome: formatarNomeExibicao(c.nome),
    tipo: { fisica: 'Pessoa física', juridica: 'Pessoa jurídica' }[c.tipo_pessoa ?? ''] ?? 'Não informado',
    perfil: c.perfil === 'contato' ? 'Contato' : c.perfil === 'cliente' ? 'Cliente' : 'Não informado',
    telefone: c.telefone || 'Não informado',
    email: c.email || 'Não informado',
    etiquetas: (c.etiquetas ?? []).join(', ') || 'Sem etiquetas',
  }))

  return (
    <DataTable rows={linhas} headers={CABECALHOS_CONTATOS} isSortable>
      {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps, getToolbarProps, getBatchActionProps, selectedRows, getTableProps }) => {
        const batchActionProps = getBatchActionProps()
        return (
          <TableContainer>
            <TableToolbar {...getToolbarProps()}>
              <TableBatchActions {...batchActionProps} translateWithId={traduzirTabela}>
                <TableBatchAction
                  tabIndex={batchActionProps.shouldShowBatchActions ? 0 : -1}
                  renderIcon={TagIcon}
                  onClick={() => onLote('etiquetas', selectedRows.map((r) => r.id))}
                >
                  Etiquetas
                </TableBatchAction>
                <TableBatchAction
                  tabIndex={batchActionProps.shouldShowBatchActions ? 0 : -1}
                  renderIcon={Edit}
                  onClick={() => onLote('perfil', selectedRows.map((r) => r.id))}
                >
                  Atualizar perfil
                </TableBatchAction>
              </TableBatchActions>
              <TableToolbarContent aria-hidden={batchActionProps.shouldShowBatchActions}>{null}</TableToolbarContent>
            </TableToolbar>
            <Table {...getTableProps()} aria-label="Clientes">
              <TableHead>
                <TableRow>
                  <TableSelectAll {...getSelectionProps()} aria-label="Selecionar todas as linhas" />
                  {headers.map((header) => (
                    <TableHeader {...getHeaderProps({ header })}>
                      {header.header}
                    </TableHeader>
                  ))}
                  <TableHeader>Ações</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const c = porId.get(row.id)
                  return (
                    <TableRow {...getRowProps({ row })}>
                      <TableSelectRow {...getSelectionProps({ row })} aria-label="Selecionar linha" />
                      {row.cells.map((cell) =>
                        cell.info.header === 'nome' && c ? (
                          <TableCell key={cell.id}>
                            <button type="button" className="contato-nome-link" onClick={() => onAbrir(c.id)}>
                              {cell.value}
                            </button>
                          </TableCell>
                        ) : cell.info.header === 'etiquetas' && c ? (
                          <TableCell key={cell.id}>
                            {(c.etiquetas ?? []).length ? (c.etiquetas ?? []).map((et) => <Tag key={et} size="sm">{et}</Tag>) : 'Sem etiquetas'}
                          </TableCell>
                        ) : (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ),
                      )}
                      <TableCell>
                        {c && (
                          <Button kind="danger--tertiary" size="sm" onClick={() => onExcluir(c)}>
                            Excluir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      }}
    </DataTable>
  )
}
