import { Close } from '@carbon/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'

type ItemChecklist = { id: string; texto: string; concluido: boolean }

export default function ChecklistAtividade({ casoId, atividadeId }: { casoId: string; atividadeId: string }) {
  const { cliente } = useCliente()
  const [itens, setItens] = useState<ItemChecklist[]>([])
  const [novoTexto, setNovoTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(() => {
    buscarJson<{ itens: ItemChecklist[] }>(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist`)
      .then((r) => setItens(r.itens ?? []))
      .catch(() => setErro('Erro ao carregar checklist'))
  }, [cliente, casoId, atividadeId])

  useEffect(carregar, [carregar])

  async function alternarConcluido(item: ItemChecklist, concluido: boolean) {
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido } : i)))
    try {
      await enviarJson(cliente, `/casos/${casoId}/atividades/${atividadeId}/checklist/${item.id}`, { concluido }, 'PATCH')
    } catch {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, concluido: !concluido } : i)))
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
    <Stack gap={3}>
      <span className="cds--label">Checklist</span>
      <p role="status">{itens.length ? `${concluidos} de ${itens.length} concluído(s)` : 'Nenhum item ainda'}</p>
      {erro && <p>{erro}</p>}
      {itens.map((item) => (
        <div key={item.id} className="aj-layout-21">
          <Checkbox
            id={`checklist-${item.id}`}
            labelText={item.texto}
            checked={item.concluido}
            onChange={(_e, { checked }) => alternarConcluido(item, checked)}
          />
          <Button kind="ghost" size="sm" hasIconOnly iconDescription="Excluir item" onClick={() => excluirItem(item)}>
            <Close size={16} />
          </Button>
        </div>
      ))}
      <div className="aj-layout-22">
        <TextInput
          id="atividade-checklist-novo"
          labelText="Novo item do checklist"
          hideLabel
          placeholder="Novo item"
          value={novoTexto}
          onChange={(e) => setNovoTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              adicionar()
            }
          }}
        />
        <Button size="sm" onClick={adicionar}>
          Adicionar
        </Button>
      </div>
    </Stack>
  )
}
