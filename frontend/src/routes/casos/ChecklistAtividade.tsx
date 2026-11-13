import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Checkbox, Flex, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'

type ItemChecklist = { id: string; texto: string; concluido: boolean }
const SEM_ITENS: ItemChecklist[] = []

export default function ChecklistAtividade({ casoId, atividadeId }: { casoId: string; atividadeId: string }) {
  const { cliente } = useCliente()
  const queryClient = useQueryClient()
  const chave = ['checklist', cliente?.token, casoId, atividadeId]
  const consulta = useQuery({
    queryKey: chave,
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ itens: ItemChecklist[] }>(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist`, signal).then(r => r.itens ?? []),
  })
  const itens = consulta.data ?? SEM_ITENS
  const [novoTexto, setNovoTexto] = useState('')
  const [erroLocal, setErro] = useState<string | null>(null)
  const erro = erroLocal ?? (consulta.error ? 'Erro ao carregar checklist' : null)
  const carregar = () => void consulta.refetch()
  const marcar = (id: string, concluido: boolean) =>
    queryClient.setQueryData<ItemChecklist[]>(chave, atual => atual?.map(i => (i.id === id ? { ...i, concluido } : i)))

  async function alternarConcluido(item: ItemChecklist, concluido: boolean) {
    marcar(item.id, concluido)
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist/${item.id}`, { concluido }, 'PATCH')
    } catch {
      marcar(item.id, !concluido)
      setErro('Erro ao atualizar item')
    }
  }

  async function excluirItem(item: ItemChecklist) {
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist/${item.id}`, {}, 'DELETE')
      carregar()
    } catch {
      setErro('Erro ao excluir item')
    }
  }

  async function adicionar() {
    const texto = novoTexto.trim()
    if (!texto) return
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist`, { texto })
      setNovoTexto('')
      carregar()
    } catch {
      setErro('Erro ao adicionar item')
    }
  }

  const concluidos = itens.filter((i) => i.concluido).length

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">Checklist</Text>
      <Text size="1" color="gray" role="status">
        {itens.length ? `${concluidos} de ${itens.length} concluído(s)` : 'Nenhum item ainda'}
      </Text>
      {erro && (
        <Callout.Root color="red" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{erro}</Callout.Text>
        </Callout.Root>
      )}
      {itens.map((item) => (
        <Flex key={item.id} align="center" gap="2" justify="between">
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox
                checked={item.concluido}
                onCheckedChange={(checked) => alternarConcluido(item, Boolean(checked))}
              />
              <span style={{ textDecoration: item.concluido ? 'line-through' : undefined, color: item.concluido ? 'var(--gray-9)' : undefined }}>
                {item.texto}
              </span>
            </Flex>
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="1"
            color="gray"
            aria-label="Excluir item"
            onClick={() => excluirItem(item)}
          >
            <X size={12} />
          </Button>
        </Flex>
      ))}
      <Flex gap="2" mt="1">
        <TextField.Root
          placeholder="Novo item"
          value={novoTexto}
          onChange={(e) => setNovoTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void adicionar() } }}
          style={{ flex: 1 }}
        />
        <Button type="button" size="1" onClick={adicionar}>
          <Plus size={12} /> Adicionar
        </Button>
      </Flex>
    </Flex>
  )
}
