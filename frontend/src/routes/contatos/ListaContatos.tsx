import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { AlertDialog, Badge, Button, Callout, Checkbox, Flex, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info, Pencil, Tag } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
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
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
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
  const idsLote = [...selecionados]
  const todosSelecionados = filtrados.length > 0 && filtrados.every((c) => selecionados.has(c.id))
  const algunsSelecionados = filtrados.some((c) => selecionados.has(c.id)) && !todosSelecionados

  function toggleTodos() {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (todosSelecionados) filtrados.forEach((c) => novo.delete(c.id))
      else filtrados.forEach((c) => novo.add(c.id))
      return novo
    })
  }

  return (
    <Flex direction="column" gap="6">
      <div className="aj-layout-36">
        <h2>Clientes</h2>
        <Button size="1" onClick={onNovo}>Novo cliente</Button>
      </div>
      <div role="group" aria-label="Filtrar clientes pela inicial do nome" className="aj-layout-37 clientes-filtro-letra">
        {['TODOS', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => (
          <Button key={l} variant={l === letra ? 'solid' : 'ghost'} size="1" onClick={() => setLetra(l)}>
            {l}
          </Button>
        ))}
      </div>
      <div className="form-campo">
        <label className="form-campo-label" htmlFor="contatos-busca">Consultar clientes</label>
        <TextField.Root
          id="contatos-busca"
          placeholder="Nome, telefone ou e-mail"
          autoComplete="off"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {clientes && (
        <p>Mostrando {filtrados.length} de {clientes.length} cliente(s). {filtrosAtivos.join('; ') || 'Sem filtros ativos'}.</p>
      )}
      {filtrosAtivos.length > 0 && (
        <Button variant="ghost" size="1" onClick={() => { setLetra('TODOS'); setBusca('') }}>
          Limpar filtros
        </Button>
      )}
      <div aria-live="polite">
        {carregando && <Carregamento colunas={8} />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && clientes && clientes.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum cliente cadastrado ainda.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && clientes && clientes.length > 0 && filtrados.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum cliente corresponde aos filtros. Confira o texto ou limpe a busca para ver todos.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && filtrados.length > 0 && (
          <>
            {idsLote.length > 0 && (
              <Flex gap="2" mb="3" align="center" wrap="wrap">
                <Text size="2">{idsLote.length} selecionado(s)</Text>
                <Button variant="outline" size="1" onClick={() => setLoteAberto('etiquetas')}>
                  <Tag size={14} /> Etiquetas
                </Button>
                <Button variant="outline" size="1" onClick={() => setLoteAberto('perfil')}>
                  <Pencil size={14} /> Atualizar perfil
                </Button>
                <Button variant="ghost" size="1" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
              </Flex>
            )}
            <TabelaResponsiva principais={['Nome']}>
              <table aria-label="Clientes">
                <thead>
                  <tr>
                    <th>
                      <Checkbox
                        checked={todosSelecionados ? true : algunsSelecionados ? 'indeterminate' : false}
                        onCheckedChange={toggleTodos}
                        aria-label="Selecionar todas as linhas"
                      />
                    </th>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Perfil</th>
                    <th>Telefone</th>
                    <th>E-mail</th>
                    <th>Etiquetas</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Checkbox
                          checked={selecionados.has(c.id)}
                          onCheckedChange={(checked) =>
                            setSelecionados((atual) => {
                              const novo = new Set(atual)
                              if (checked) novo.add(c.id)
                              else novo.delete(c.id)
                              return novo
                            })
                          }
                          aria-label="Selecionar linha"
                        />
                      </td>
                      <td><TextoTabela texto={formatarNomeExibicao(c.nome)} onClick={() => onAbrir(c.id)} /></td>
                      <td>{{ fisica: 'Pessoa física', juridica: 'Pessoa jurídica' }[c.tipo_pessoa ?? ''] ?? 'Não informado'}</td>
                      <td>{c.perfil === 'contato' ? 'Contato' : c.perfil === 'cliente' ? 'Cliente' : 'Não informado'}</td>
                      <td>{c.telefone || 'Não informado'}</td>
                      <td><TextoTabela texto={c.email || 'Não informado'} /></td>
                      <td>
                        {(c.etiquetas ?? []).length
                          ? (c.etiquetas ?? []).map((et) => <Badge key={et} size="1" mr="1">{et}</Badge>)
                          : 'Sem etiquetas'}
                      </td>
                      <td>
                        <AcoesTabela rotulo={c.nome || 'contato'} acoes={[{ texto: 'Excluir', executar: () => setParaExcluir(c), perigo: true }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaResponsiva>
          </>
        )}
      </div>
      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir cliente</AlertDialog.Title>
          <AlertDialog.Description>Excluir o cliente "{paraExcluir?.nome}"? Essa ação não pode ser desfeita.</AlertDialog.Description>
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
      {loteAberto && (
        <ClientesLoteModal
          open
          tipo={loteAberto}
          ids={idsLote}
          etiquetasExistentes={etiquetasExistentes}
          onClose={() => setLoteAberto(null)}
          onConcluido={() => {
            setLoteAberto(null)
            setSelecionados(new Set())
            carregar()
          }}
        />
      )}
    </Flex>
  )
}
