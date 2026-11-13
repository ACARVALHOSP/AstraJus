import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Callout, Dialog, Flex, IconButton, Select, Switch, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAvisos } from '../Avisos'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useCliente } from '../api/ClienteContext'
import { usePerfil } from '../api/PerfilContext'
import { buscarJson, enviarJson } from '../api/rest'
import { resumoDoModelo, type ItemPrazo, type ItemTarefa, type Modelo } from './casos/modelosPrazo'

type Rascunho = { id?: string; nome: string; criterio: string; ativo: boolean; prazos: ItemPrazo[]; tarefas: ItemTarefa[] }
const NOVO: Rascunho = { nome: '', criterio: '', ativo: true, prazos: [{ titulo: '', dias: 15, contagem: 'uteis' }], tarefas: [] }

/** Configurações › Modelos de prazos: prazos e tarefas padrão por assunto ou classe processual. */
export default function ModelosPrazo() {
  const { cliente } = useCliente()
  const { podeEditar } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const editavel = podeEditar('atividades')
  const consulta = useQuery({
    queryKey: ['modelos-prazo', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ modelos: Modelo[] }>(cliente, '/modelos-prazo', signal).then(r => r.modelos ?? []),
  })
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [excluindo, setExcluindo] = useState<Modelo | null>(null)
  const recarregar = () => queryClient.invalidateQueries({ queryKey: ['modelos-prazo'] })

  async function alternarAtivo(m: Modelo) {
    try {
      await enviarJson(cliente, `/modelos-prazo/${encodeURIComponent(m.id)}`, { ativo: !m.ativo }, 'PATCH')
      void recarregar()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível alterar o modelo.' })
    }
  }

  return (
    <div className="home">
      <CabecalhoPagina
        titulo="Modelos de prazos"
        descricao="Prazos e tarefas padrão por assunto ou classe processual. Quando um processo combina com um modelo, o sistema sugere os itens para você revisar; nada é criado sozinho."
        acoes={<Button size="2" disabled={!cliente || !editavel} onClick={() => setEditando(NOVO)}><Plus size={16} aria-hidden="true" />Novo modelo</Button>}
      />
      {!cliente && <Text as="p" size="2" color="gray">Conecte-se na aba Acesso para ver os modelos.</Text>}
      {!editavel && cliente && <Text as="p" size="2" color="gray">Seu perfil só permite consultar os modelos.</Text>}
      {consulta.isPending && cliente && <Carregamento tipo="cartoes" descricao="Carregando modelos…" />}
      {consulta.isError && (
        <Callout.Root color="red" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>Não foi possível carregar os modelos. <Button size="1" variant="ghost" onClick={() => void consulta.refetch()}>Tentar novamente</Button></Callout.Text>
        </Callout.Root>
      )}
      {consulta.data && consulta.data.length === 0 && (
        <Text as="p" size="2" color="gray" role="status">
          Nenhum modelo cadastrado ainda. Exemplo: assunto “Ação de cobrança” com o prazo “contestação” em 15 dias úteis.
        </Text>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {consulta.data?.map(m => (
          <li key={m.id} className="risco-item" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="risco-texto">
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="2" weight="medium">{m.nome}</Text>
                <Badge color={m.ativo ? 'green' : 'gray'} variant="soft">{m.ativo ? 'Ativo' : 'Inativo'}</Badge>
              </Flex>
              <Text as="p" size="2" color="gray">Quando o assunto ou a classe contém “{m.criterio}” · {resumoDoModelo(m)}</Text>
              <Text as="p" size="1" color="gray">
                {[...m.prazos.map(p => `${p.titulo} (${p.dias} ${p.contagem === 'uteis' ? 'úteis' : 'corridos'})`), ...m.tarefas.map(t => `${t.titulo} (+${t.dias}d)`)].join(' · ')}
              </Text>
            </div>
            <Flex gap="2" align="center">
              <Switch checked={m.ativo} disabled={!editavel} onCheckedChange={() => void alternarAtivo(m)} aria-label={`${m.ativo ? 'Desativar' : 'Ativar'} ${m.nome}`} />
              <IconButton variant="soft" color="gray" disabled={!editavel} aria-label={`Editar ${m.nome}`} onClick={() => setEditando({ ...m })}><Pencil size={14} /></IconButton>
              <IconButton variant="soft" color="red" disabled={!editavel} aria-label={`Excluir ${m.nome}`} onClick={() => setExcluindo(m)}><Trash2 size={14} /></IconButton>
            </Flex>
          </li>
        ))}
      </ul>
      {editando && <FormularioModelo inicial={editando} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); void recarregar(); avisar({ texto: 'Modelo salvo.' }) }} />}
      <Dialog.Root open={Boolean(excluindo)} onOpenChange={(aberto) => { if (!aberto) setExcluindo(null) }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Excluir o modelo “{excluindo?.nome}”?</Dialog.Title>
          <Dialog.Description size="2" color="gray">As atividades já criadas a partir dele continuam nos processos. O modelo deixa de ser sugerido.</Dialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button color="red" onClick={async () => {
              const alvo = excluindo
              setExcluindo(null)
              if (!alvo) return
              try { await enviarJson(cliente, `/modelos-prazo/${encodeURIComponent(alvo.id)}`, {}, 'DELETE'); void recarregar(); avisar({ texto: 'Modelo excluído.' }) }
              catch (e) { avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível excluir.' }) }
            }}>Excluir</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  )
}

function FormularioModelo({ inicial, onClose, onSalvo }: { inicial: Rascunho; onClose: () => void; onSalvo: () => void }) {
  const { cliente } = useCliente()
  const [d, setD] = useState<Rascunho>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const itensOk = d.prazos.every(p => p.titulo.trim() && p.dias >= 1 && p.dias <= 365) && d.tarefas.every(t => t.titulo.trim() && t.dias >= 0 && t.dias <= 365)
  const valido = d.criterio.trim().length >= 3 && (d.prazos.length > 0 || d.tarefas.length > 0) && itensOk
  const numero = (texto: string) => (texto === '' ? NaN : Number(texto))

  async function salvar() {
    setSalvando(true); setErro('')
    const corpo = { nome: d.nome.trim() || d.criterio.trim(), criterio: d.criterio.trim(), ativo: d.ativo, prazos: d.prazos, tarefas: d.tarefas }
    try {
      if (d.id) await enviarJson(cliente, `/modelos-prazo/${encodeURIComponent(d.id)}`, corpo, 'PATCH')
      else await enviarJson(cliente, '/modelos-prazo', corpo, 'POST')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o modelo.')
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{d.id ? 'Editar modelo' : 'Novo modelo de prazos'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">O modelo é sugerido quando a classe ou um dos assuntos do processo contém o texto abaixo (sem diferenciar acentos nem maiúsculas).</Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="modelo-criterio">Assunto ou classe processual</Text>
            <TextField.Root id="modelo-criterio" value={d.criterio} maxLength={200} placeholder="Ex.: Ação de cobrança" onChange={e => setD({ ...d, criterio: e.target.value })} />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="modelo-nome">Nome do modelo (opcional)</Text>
            <TextField.Root id="modelo-nome" value={d.nome} maxLength={120} placeholder="Se vazio, usa o assunto ou a classe" onChange={e => setD({ ...d, nome: e.target.value })} />
          </Flex>

          <Text size="2" weight="medium">Prazos sugeridos</Text>
          {d.prazos.map((p, i) => (
            <Flex key={i} gap="2" align="end" wrap="wrap">
              <TextField.Root style={{ flex: '1 1 12rem' }} value={p.titulo} maxLength={120} placeholder="Tipo de prazo (ex.: contestação)" aria-label={`Título do prazo ${i + 1}`}
                onChange={e => setD({ ...d, prazos: d.prazos.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x) })} />
              <TextField.Root style={{ width: '5.5rem' }} type="number" min={1} max={365} value={Number.isNaN(p.dias) ? '' : p.dias} placeholder="Dias" aria-label={`Dias do prazo ${i + 1}`}
                onChange={e => setD({ ...d, prazos: d.prazos.map((x, j) => j === i ? { ...x, dias: numero(e.target.value) } : x) })} />
              <Select.Root value={p.contagem} onValueChange={v => setD({ ...d, prazos: d.prazos.map((x, j) => j === i ? { ...x, contagem: v as ItemPrazo['contagem'] } : x) })}>
                <Select.Trigger aria-label={`Contagem do prazo ${i + 1}`} />
                <Select.Content><Select.Item value="uteis">Dias úteis</Select.Item><Select.Item value="corridos">Dias corridos</Select.Item></Select.Content>
              </Select.Root>
              <IconButton variant="soft" color="gray" aria-label={`Remover prazo ${i + 1}`} onClick={() => setD({ ...d, prazos: d.prazos.filter((_, j) => j !== i) })}><Trash2 size={14} /></IconButton>
            </Flex>
          ))}
          <Button size="1" variant="soft" style={{ alignSelf: 'flex-start' }} disabled={d.prazos.length >= 20} onClick={() => setD({ ...d, prazos: [...d.prazos, { titulo: '', dias: 15, contagem: 'uteis' }] })}><Plus size={12} aria-hidden="true" />Adicionar prazo</Button>

          <Text size="2" weight="medium">Tarefas sugeridas</Text>
          {d.tarefas.map((t, i) => (
            <Flex key={i} gap="2" align="end" wrap="wrap">
              <TextField.Root style={{ flex: '1 1 12rem' }} value={t.titulo} maxLength={120} placeholder="Título da tarefa" aria-label={`Título da tarefa ${i + 1}`}
                onChange={e => setD({ ...d, tarefas: d.tarefas.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x) })} />
              <TextField.Root style={{ width: '7.5rem' }} type="number" min={0} max={365} value={Number.isNaN(t.dias) ? '' : t.dias} placeholder="Em quantos dias" aria-label={`Dias da tarefa ${i + 1}`}
                onChange={e => setD({ ...d, tarefas: d.tarefas.map((x, j) => j === i ? { ...x, dias: numero(e.target.value) } : x) })} />
              <IconButton variant="soft" color="gray" aria-label={`Remover tarefa ${i + 1}`} onClick={() => setD({ ...d, tarefas: d.tarefas.filter((_, j) => j !== i) })}><Trash2 size={14} /></IconButton>
            </Flex>
          ))}
          <Button size="1" variant="soft" style={{ alignSelf: 'flex-start' }} disabled={d.tarefas.length >= 20} onClick={() => setD({ ...d, tarefas: [...d.tarefas, { titulo: '', dias: 2 }] })}><Plus size={12} aria-hidden="true" />Adicionar tarefa</Button>

          <Text as="label" size="2"><Flex gap="2" align="center"><Switch checked={d.ativo} onCheckedChange={v => setD({ ...d, ativo: v })} />Modelo ativo (pode ser sugerido)</Flex></Text>
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={!valido || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar modelo'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
