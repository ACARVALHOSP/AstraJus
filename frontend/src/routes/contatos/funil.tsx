import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Dialog, Flex, IconButton, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'

export type ItemFunil = { chave?: string; nome: string }
export type CatalogoFunil = { estagios: ItemFunil[]; origens: ItemFunil[] }
const VAZIO: CatalogoFunil = { estagios: [], origens: [] }

/** Estágios e origens editáveis do funil de contatos (compartilhado entre cadastro e lista). */
export function useFunilCatalogo() {
  const { cliente } = useCliente()
  const consulta = useQuery({
    queryKey: ['funil-catalogo', cliente?.token],
    queryFn: ({ signal }) => buscarJson<CatalogoFunil>(cliente, '/clientes/funil-catalogo', signal),
  })
  return consulta.data ?? VAZIO
}

export const nomeDoFunil = (itens: ItemFunil[], chave?: string | null) => itens.find((i) => i.chave === chave)?.nome ?? ''

function ListaEditavel({ titulo, itens, onChange }: { titulo: string; itens: ItemFunil[]; onChange: (v: ItemFunil[]) => void }) {
  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="bold">{titulo}</Text>
      {itens.map((item, i) => (
        <Flex key={item.chave ?? `novo-${i}`} gap="2" align="center">
          <TextField.Root style={{ flex: 1 }} maxLength={40} aria-label={`${titulo} ${i + 1}`} value={item.nome}
            onChange={(e) => onChange(itens.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
          <IconButton type="button" variant="ghost" color="gray" aria-label={`Remover ${item.nome || 'item'}`}
            onClick={() => onChange(itens.filter((_, j) => j !== i))}><X size={14} /></IconButton>
        </Flex>
      ))}
      <Button type="button" variant="soft" color="gray" size="1" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...itens, { nome: '' }])}><Plus size={14} /> Adicionar</Button>
    </Flex>
  )
}

export function EditarFunilDialogo({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { cliente } = useCliente()
  const queryClient = useQueryClient()
  const catalogo = useFunilCatalogo()
  const [rascunho, setRascunho] = useState<CatalogoFunil | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const atual = rascunho ?? catalogo

  function fechar() { setRascunho(null); setErro(null); onFechar() }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const limpo = (l: ItemFunil[]) => l.filter((i) => i.nome.trim())
      const novo = await enviarJson<CatalogoFunil>(cliente, '/clientes/funil-catalogo', { estagios: limpo(atual.estagios), origens: limpo(atual.origens) }, 'PUT')
      queryClient.setQueryData(['funil-catalogo', cliente?.token], novo)
      fechar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível salvar as listas.')
    } finally { setSalvando(false) }
  }

  return (
    <Dialog.Root open={aberto} onOpenChange={(o) => { if (!o) fechar() }}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Editar estágios e origens</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Renomear mantém o vínculo dos contatos. Só dá para remover um item que nenhum contato usa.
        </Dialog.Description>
        <Flex direction="column" gap="5">
          <ListaEditavel titulo="Estágios" itens={atual.estagios} onChange={(estagios) => setRascunho({ ...atual, estagios })} />
          <ListaEditavel titulo="Origens" itens={atual.origens} onChange={(origens) => setRascunho({ ...atual, origens })} />
          {erro && (
            <Callout.Root color="red" size="1"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>
          )}
        </Flex>
        <Flex gap="3" justify="end" mt="5">
          <Button variant="soft" color="gray" size="2" onClick={fechar}>Cancelar</Button>
          <Button size="2" loading={salvando} onClick={salvar}>Salvar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
