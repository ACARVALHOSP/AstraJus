import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Checkbox, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { Lightbulb } from 'lucide-react'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { usePerfil } from '../../api/PerfilContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { ErroMCP } from '../../api/mcpClient'
import { diaLocal } from '../home/dados'
import { itensDoModelo, resumoDoModelo, type Sugestao } from './modelosPrazo'

/** Faixa no processo: "O modelo X combina com este processo". Nada é criado sem revisão. */
export default function SugestaoModelos({ casoId, onAplicado }: { casoId: string; onAplicado: () => void }) {
  const { cliente } = useCliente()
  const { podeEditar } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const permitido = podeEditar('atividades')
  const consulta = useQuery({
    queryKey: ['modelos-caso', cliente?.token, casoId],
    enabled: Boolean(cliente) && permitido,
    queryFn: ({ signal }) => buscarJson<{ sugestoes: Sugestao[] }>(cliente, `/casos/${encodeURIComponent(casoId)}/modelos-prazo`, signal).then(r => r.sugestoes ?? []),
  })
  const [revisando, setRevisando] = useState<Sugestao | null>(null)
  const [dispensando, setDispensando] = useState<string | null>(null)
  const atualizar = () => queryClient.invalidateQueries({ queryKey: ['modelos-caso'] })

  // Recurso complementar: sem permissão, erro ou nenhuma sugestão, não mostra nada.
  const sugestoes = consulta.data ?? []
  if (!permitido || !sugestoes.length) return null

  async function dispensar(s: Sugestao) {
    setDispensando(s.modelo.id)
    try {
      await enviarJson(cliente, `/casos/${encodeURIComponent(casoId)}/modelos-prazo/${encodeURIComponent(s.modelo.id)}/dispensar`, {}, 'POST')
      avisar({ texto: `Modelo “${s.modelo.nome}” dispensado neste processo.` })
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível dispensar o modelo.' })
    } finally {
      setDispensando(null)
      void atualizar()
    }
  }

  return (
    <Flex direction="column" gap="2" mb="3">
      {sugestoes.map(s => (
        <Callout.Root key={s.modelo.id} color="blue" size="1" role="status">
          <Callout.Icon><Lightbulb size={16} /></Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2" align="start">
              <span>
                O modelo <strong>“{s.modelo.nome}”</strong> combina com este processo (“{s.correspondeu_a}”):
                sugere {resumoDoModelo(s.modelo)}. Nada é criado sem a sua revisão.
              </span>
              <Flex gap="2" wrap="wrap">
                <Button size="1" onClick={() => setRevisando(s)}>Revisar e aplicar</Button>
                <Button size="1" variant="soft" color="gray" disabled={dispensando === s.modelo.id} onClick={() => void dispensar(s)}>Dispensar</Button>
              </Flex>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      ))}
      {revisando && (
        <RevisarModelo
          key={revisando.modelo.id}
          casoId={casoId}
          sugestao={revisando}
          onClose={() => setRevisando(null)}
          onAplicado={(n) => {
            setRevisando(null)
            avisar({ texto: `${n} ${n === 1 ? 'atividade criada' : 'atividades criadas'} a partir do modelo “${revisando.modelo.nome}”. Confira os vencimentos.` })
            void atualizar()
            onAplicado()
          }}
        />
      )}
    </Flex>
  )
}

type Linha = { chave: string; tipo: 'prazo' | 'tarefa'; titulo: string; data: string; descricao: string; incluir: boolean }

function RevisarModelo({ casoId, sugestao, onClose, onAplicado }: {
  casoId: string; sugestao: Sugestao; onClose: () => void; onAplicado: (criadas: number) => void
}) {
  const { cliente } = useCliente()
  const [linhas, setLinhas] = useState<Linha[]>(() => itensDoModelo(sugestao.modelo, diaLocal(new Date())).map(i => ({ ...i, incluir: true })))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const escolhidas = linhas.filter(l => l.incluir)
  const invalida = escolhidas.some(l => !l.titulo.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(l.data))
  const mudar = (chave: string, parcial: Partial<Linha>) => setLinhas(atual => atual.map(l => l.chave === chave ? { ...l, ...parcial } : l))

  async function criar() {
    setSalvando(true); setErro('')
    try {
      const r = await enviarJson<{ atividades: unknown[] }>(
        cliente, `/casos/${encodeURIComponent(casoId)}/modelos-prazo/${encodeURIComponent(sugestao.modelo.id)}/aplicar`,
        { itens: escolhidas.map(l => ({ tipo: l.tipo, titulo: l.titulo.trim(), data: l.data })) }, 'POST',
      )
      onAplicado(r.atividades?.length ?? escolhidas.length)
    } catch (e) {
      setErro(e instanceof ErroMCP || e instanceof Error ? e.message : 'Não foi possível criar as atividades.')
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>Aplicar o modelo “{sugestao.modelo.nome}”</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          As datas são estimativas: prazos contam a partir de amanhã, só com fins de semana e a suspensão de 20/12 a 20/01,
          <strong> sem feriados locais</strong>. Confira cada vencimento e desmarque o que não se aplica.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          {linhas.map(l => (
            <Flex key={l.chave} gap="3" align="end" wrap="wrap">
              <Checkbox checked={l.incluir} onCheckedChange={v => mudar(l.chave, { incluir: v === true })} aria-label={`Incluir ${l.titulo}`} style={{ marginBottom: 10 }} />
              <Flex direction="column" gap="1" style={{ flex: '1 1 14rem' }}>
                <Text as="label" size="1" color="gray">{l.tipo === 'prazo' ? 'Prazo' : 'Tarefa'} · {l.descricao}</Text>
                <TextField.Root value={l.titulo} disabled={!l.incluir} maxLength={200} onChange={e => mudar(l.chave, { titulo: e.target.value })} aria-label={`Título de ${l.titulo}`} />
              </Flex>
              <Flex direction="column" gap="1">
                <Text as="label" size="1" color="gray">Vencimento</Text>
                <TextField.Root type="date" value={l.data} disabled={!l.incluir} onChange={e => mudar(l.chave, { data: e.target.value })} aria-label={`Vencimento de ${l.titulo}`} />
              </Flex>
            </Flex>
          ))}
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={salvando || !escolhidas.length || invalida} onClick={() => void criar()}>
            {salvando ? 'Criando…' : `Criar ${escolhidas.length} ${escolhidas.length === 1 ? 'atividade' : 'atividades'}`}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
