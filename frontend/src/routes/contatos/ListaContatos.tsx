import { useEffect, useState } from 'react'
import { Button, Checkbox, InlineNotification, Modal, Stack, Tag, TextInput } from '@carbon/react'
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

  function alternarSelecao(id: string, marcado: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (marcado) novo.add(id)
      else novo.delete(id)
      return novo
    })
  }

  function alternarSelecionarTodos(marcado: boolean) {
    setSelecionados(marcado ? new Set(filtrados.map((c) => c.id)) : new Set())
  }

  const etiquetasExistentes = [...new Set((clientes ?? []).flatMap((c) => c.etiquetas ?? []))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <Stack gap={6}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Clientes</h2>
        <Button size="sm" onClick={onNovo}>
          Novo cliente
        </Button>
      </div>
      <div role="group" aria-label="Filtrar clientes pela inicial do nome" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
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
      {selecionados.size > 0 && (
        <div className="clientes-lote-barra" role="group" aria-label="Ações nos clientes selecionados" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong role="status">{selecionados.size} cliente(s) selecionado(s)</strong>
          <Button kind="ghost" size="sm" onClick={() => setLoteAberto('etiquetas')}>
            Etiquetas
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setLoteAberto('perfil')}>
            Atualizar perfil
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setSelecionados(new Set())}>
            Cancelar seleção
          </Button>
        </div>
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
          <div className="tabela-responsiva-wrap">
            <table className="tabela-responsiva contatos-tabela">
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      id="clientes-selecionar-todos"
                      labelText=""
                      hideLabel
                      checked={filtrados.length > 0 && filtrados.every((c) => selecionados.has(c.id))}
                      indeterminate={filtrados.some((c) => selecionados.has(c.id)) && !filtrados.every((c) => selecionados.has(c.id))}
                      onChange={(_e, { checked }) => alternarSelecionarTodos(checked)}
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
                        id={`selecionar-cliente-${c.id}`}
                        labelText=""
                        hideLabel
                        checked={selecionados.has(c.id)}
                        onChange={(_e, { checked }) => alternarSelecao(c.id, checked)}
                      />
                    </td>
                    <td data-label="Nome">
                      <button type="button" className="contato-nome-link" onClick={() => onAbrir(c.id)}>
                        {formatarNomeExibicao(c.nome)}
                      </button>
                    </td>
                    <td data-label="Tipo">{{ fisica: 'Pessoa física', juridica: 'Pessoa jurídica' }[c.tipo_pessoa ?? ''] ?? 'Não informado'}</td>
                    <td data-label="Perfil">{c.perfil === 'contato' ? 'Contato' : c.perfil === 'cliente' ? 'Cliente' : 'Não informado'}</td>
                    <td data-label="Telefone">{c.telefone || 'Não informado'}</td>
                    <td data-label="E-mail">{c.email || 'Não informado'}</td>
                    <td data-label="Etiquetas">
                      {(c.etiquetas ?? []).length ? (c.etiquetas ?? []).map((et) => <Tag key={et} size="sm">{et}</Tag>) : 'Sem etiquetas'}
                    </td>
                    <td data-label="Ações">
                      <Button kind="danger--tertiary" size="sm" onClick={() => setParaExcluir(c)}>
                        Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal
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
          ids={[...selecionados]}
          etiquetasExistentes={etiquetasExistentes}
          onClose={() => setLoteAberto(null)}
          onConcluido={() => {
            setLoteAberto(null)
            setSelecionados(new Set())
            carregar()
          }}
        />
      )}
    </Stack>
  )
}
