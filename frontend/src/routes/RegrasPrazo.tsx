import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Callout, Dialog, Flex, IconButton, Select, Switch, Tabs, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAvisos } from '../Avisos'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useCliente } from '../api/ClienteContext'
import { usePerfil } from '../api/PerfilContext'
import { buscarJson, enviarJson, requisitar } from '../api/rest'
import CampoTpu from './processo/CampoTpu'
import type { ItemTpu } from './processo/buscaProcessos'
import { resumoDaRegra, type EscopoItem, type Regra, type TipoPrazo } from './casos/regrasPrazo'
import './home/home-radix.css'

type RascunhoTipo = {
  id?: string; nome: string; dias: number; contagem: TipoPrazo['contagem']
  base_legal: string; inicio: TipoPrazo['inicio']; ativo: boolean
}
const NOVO_TIPO: RascunhoTipo = { nome: '', dias: 15, contagem: 'uteis', base_legal: '', inicio: 'disponibilizacao', ativo: true }
const SEM_TIPOS: TipoPrazo[] = []

type RascunhoRegra = {
  id?: string; nome: string; tipo_id: string; escopo: EscopoItem[]
  palavras: string; combinacao: Regra['combinacao']; ativo: boolean
}
const novaRegra = (tipoId = ''): RascunhoRegra => ({
  nome: '', tipo_id: tipoId, escopo: [], palavras: '', combinacao: 'e', ativo: true,
})

const ROTULO_INICIO: Record<TipoPrazo['inicio'], string> = {
  disponibilizacao: 'Disponibilização no DJEN',
  movimento: 'Data do movimento',
}

const AJUDA_PALAVRAS = 'Palavras soltas, “frase exata” entre aspas e os operadores e, ou e sem. O “e” vale antes do “ou”; não há parênteses. Exemplo: contestar ou “prazo de 15 dias” sem recurso.'

// Normaliza para comparar sem acento nem maiúscula, como o servidor faz ao casar o escopo.
function chaveDoEscopo(item: EscopoItem): string {
  const nome = item.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return `${item.tipo}:${item.codigo ?? nome}`
}

// Regra criada pela migração dos modelos antigos: nome "modelo – prazo", inativa e sem palavras.
function pareceMigrada(regra: Regra): boolean {
  return regra.nome.includes(' – ') && !regra.ativo && !regra.palavras.trim()
}

/** Configurações › Regras de prazos: tipos de prazo e regras de sugestão por classe, assunto e palavras-chave. */
export default function RegrasPrazo() {
  const { cliente } = useCliente()
  const { podeEditar } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const editavel = podeEditar('atividades')
  const [aba, setAba] = useState<'regras' | 'tipos'>('regras')
  const consultaTipos = useQuery({
    queryKey: ['tipos-prazo', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ tipos: TipoPrazo[] }>(cliente, '/tipos-prazo', signal).then(r => r.tipos ?? []),
  })
  const consultaRegras = useQuery({
    queryKey: ['regras-prazo', cliente?.token],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ regras: Regra[] }>(cliente, '/regras-prazo', signal).then(r => r.regras ?? []),
  })
  const [editandoTipo, setEditandoTipo] = useState<RascunhoTipo | null>(null)
  const [excluindoTipo, setExcluindoTipo] = useState<TipoPrazo | null>(null)
  const [editandoRegra, setEditandoRegra] = useState<RascunhoRegra | null>(null)
  const [excluindoRegra, setExcluindoRegra] = useState<Regra | null>(null)

  const tipos = consultaTipos.data ?? SEM_TIPOS
  const tiposPorId = useMemo(() => new Map(tipos.map(t => [t.id, t])), [tipos])
  const tiposAtivos = useMemo(() => tipos.filter(t => t.ativo), [tipos])

  function recarregar() {
    void queryClient.invalidateQueries({ queryKey: ['tipos-prazo'] })
    void queryClient.invalidateQueries({ queryKey: ['regras-prazo'] })
  }

  function falha(mensagem: string, e: unknown) {
    avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : mensagem })
  }

  async function alternarTipo(tipo: TipoPrazo) {
    try {
      await enviarJson(cliente, `/tipos-prazo/${encodeURIComponent(tipo.id)}`, { ativo: !tipo.ativo }, 'PATCH')
      recarregar()
    } catch (e) {
      falha('Não foi possível alterar o tipo de prazo.', e)
    }
  }

  async function alternarRegra(regra: Regra) {
    try {
      await enviarJson(cliente, `/regras-prazo/${encodeURIComponent(regra.id)}`, { ativo: !regra.ativo }, 'PATCH')
      recarregar()
    } catch (e) {
      falha('Não foi possível alterar a regra.', e)
    }
  }

  async function excluirTipo() {
    const alvo = excluindoTipo
    setExcluindoTipo(null)
    if (!alvo) return
    try {
      await enviarJson(cliente, `/tipos-prazo/${encodeURIComponent(alvo.id)}`, {}, 'DELETE')
      recarregar()
      avisar({ texto: 'Tipo de prazo excluído.' })
    } catch (e) {
      // 409: o tipo está em uso por regras e o servidor explica o que fazer.
      falha('Não foi possível excluir o tipo de prazo.', e)
    }
  }

  async function excluirRegra() {
    const alvo = excluindoRegra
    setExcluindoRegra(null)
    if (!alvo) return
    try {
      await enviarJson(cliente, `/regras-prazo/${encodeURIComponent(alvo.id)}`, {}, 'DELETE')
      recarregar()
      avisar({ texto: 'Regra excluída.' })
    } catch (e) {
      falha('Não foi possível excluir a regra.', e)
    }
  }

  return (
    <div className="home">
      <CabecalhoPagina
        titulo="Regras de prazos"
        descricao="Tipos de prazo e regras que sugerem um prazo quando a classe, o assunto ou o texto de uma publicação combina. A sugestão é sempre revista por você; nada é criado sozinho."
        acoes={(
          <Button size="2" disabled={!cliente || !editavel} onClick={() => {
            if (aba === 'regras') setEditandoRegra(novaRegra(tiposAtivos[0]?.id ?? ''))
            else setEditandoTipo(NOVO_TIPO)
          }}>
            <Plus size={16} aria-hidden="true" />{aba === 'regras' ? 'Nova regra' : 'Novo tipo de prazo'}
          </Button>
        )}
      />
      {!cliente && <Text as="p" size="2" color="gray">Conecte-se na aba Acesso para ver as regras e os tipos de prazo.</Text>}
      {!editavel && cliente && <Text as="p" size="2" color="gray">Seu perfil só permite consultar as regras e os tipos de prazo.</Text>}
      <Tabs.Root value={aba} onValueChange={v => setAba(v === 'tipos' ? 'tipos' : 'regras')}>
        <Tabs.List aria-label="Regras de prazos">
          <Tabs.Trigger value="regras">Regras</Tabs.Trigger>
          <Tabs.Trigger value="tipos">Tipos de prazo</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="regras">
          <Flex direction="column" gap="3" pt="4">
            {cliente && (consultaRegras.isPending || consultaTipos.isPending) && <Carregamento tipo="cartoes" descricao="Carregando regras…" />}
            {(consultaRegras.isError || consultaTipos.isError) && (
              <Callout.Root color="red" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>
                  Não foi possível carregar as regras.{' '}
                  <Button size="1" variant="ghost" onClick={() => { void consultaRegras.refetch(); void consultaTipos.refetch() }}>Tentar novamente</Button>
                </Callout.Text>
              </Callout.Root>
            )}
            {consultaTipos.data && tipos.length > 0 && tiposAtivos.length === 0 && (
              <Callout.Root color="amber" size="1" role="status"><Callout.Icon><Info size={14} /></Callout.Icon>
                <Callout.Text>Nenhum tipo de prazo ativo: as regras não serão sugeridas. Ative um tipo na aba Tipos de prazo.</Callout.Text>
              </Callout.Root>
            )}
            {consultaRegras.data && consultaRegras.data.length === 0 && (
              <Text as="p" size="2" color="gray" role="status">
                Nenhuma regra cadastrada ainda. Exemplo: assunto “Ação de cobrança” com as palavras “contestar”, ligado ao tipo “Contestação”.
              </Text>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {consultaRegras.data?.map(regra => {
                const tipo = tiposPorId.get(regra.tipo_id)
                return (
                  <li key={regra.id} className="risco-item" style={{ gridTemplateColumns: '1fr auto' }}>
                    <div className="risco-texto">
                      <Flex gap="2" align="center" wrap="wrap">
                        <Text size="2" weight="medium">{regra.nome}</Text>
                        <Badge color={regra.ativo ? 'green' : 'gray'} variant="soft">{regra.ativo ? 'Ativo' : 'Inativo'}</Badge>
                      </Flex>
                      <Text as="p" size="2" color="gray">
                        {tipo ? tipo.nome : 'Tipo de prazo indisponível'} · {resumoDaRegra(regra)}
                      </Text>
                      <Text as="p" size="1" color="gray">
                        Casa quando: {regra.combinacao === 'ou' ? 'assunto/classe OU palavras-chave' : 'assunto/classe E palavras-chave'}
                      </Text>
                      {pareceMigrada(regra) && (
                        <Callout.Root color="gray" size="1" mt="2" role="status">
                          <Callout.Icon><Info size={14} /></Callout.Icon>
                          <Callout.Text>Regra migrada dos modelos antigos: acrescente palavras-chave e ative para valer.</Callout.Text>
                        </Callout.Root>
                      )}
                    </div>
                    <Flex gap="2" align="center">
                      <Switch size="1" checked={regra.ativo} disabled={!editavel} onCheckedChange={() => void alternarRegra(regra)} aria-label={`${regra.ativo ? 'Desativar' : 'Ativar'} a regra ${regra.nome}`} />
                      <IconButton size="1" variant="soft" color="gray" disabled={!editavel} aria-label={`Editar a regra ${regra.nome}`} onClick={() => setEditandoRegra({
                        id: regra.id, nome: regra.nome, tipo_id: regra.tipo_id, escopo: regra.escopo,
                        palavras: regra.palavras, combinacao: regra.combinacao, ativo: regra.ativo,
                      })}><Pencil size={14} /></IconButton>
                      <IconButton size="1" variant="soft" color="red" disabled={!editavel} aria-label={`Excluir a regra ${regra.nome}`} onClick={() => setExcluindoRegra(regra)}><Trash2 size={14} /></IconButton>
                    </Flex>
                  </li>
                )
              })}
            </ul>
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="tipos">
          <Flex direction="column" gap="3" pt="4">
            {cliente && consultaTipos.isPending && <Carregamento tipo="cartoes" descricao="Carregando tipos de prazo…" />}
            {consultaTipos.isError && (
              <Callout.Root color="red" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>
                  Não foi possível carregar os tipos de prazo.{' '}
                  <Button size="1" variant="ghost" onClick={() => void consultaTipos.refetch()}>Tentar novamente</Button>
                </Callout.Text>
              </Callout.Root>
            )}
            {consultaTipos.data && consultaTipos.data.length === 0 && (
              <Text as="p" size="2" color="gray" role="status">
                Nenhum tipo de prazo cadastrado ainda. Exemplo: “Contestação”, 15 dias úteis, a contar da disponibilização no DJEN.
              </Text>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {consultaTipos.data?.map(tipo => (
                <li key={tipo.id} className="risco-item" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div className="risco-texto">
                    <Flex gap="2" align="center" wrap="wrap">
                      <Text size="2" weight="medium">{tipo.nome}</Text>
                      <Badge color={tipo.ativo ? 'green' : 'gray'} variant="soft">{tipo.ativo ? 'Ativo' : 'Inativo'}</Badge>
                    </Flex>
                    <Text as="p" size="2" color="gray">
                      {tipo.dias} {tipo.dias === 1 ? 'dia' : 'dias'} {tipo.contagem === 'uteis' ? 'úteis' : 'corridos'} · {ROTULO_INICIO[tipo.inicio]}
                    </Text>
                    {tipo.base_legal && <Text as="p" size="1" color="gray">Base legal: {tipo.base_legal}</Text>}
                  </div>
                  <Flex gap="2" align="center">
                    <Switch size="1" checked={tipo.ativo} disabled={!editavel} onCheckedChange={() => void alternarTipo(tipo)} aria-label={`${tipo.ativo ? 'Desativar' : 'Ativar'} o tipo de prazo ${tipo.nome}`} />
                    <IconButton size="1" variant="soft" color="gray" disabled={!editavel} aria-label={`Editar o tipo de prazo ${tipo.nome}`} onClick={() => setEditandoTipo({
                      id: tipo.id, nome: tipo.nome, dias: tipo.dias, contagem: tipo.contagem,
                      base_legal: tipo.base_legal ?? '', inicio: tipo.inicio, ativo: tipo.ativo,
                    })}><Pencil size={14} /></IconButton>
                    <IconButton size="1" variant="soft" color="red" disabled={!editavel} aria-label={`Excluir o tipo de prazo ${tipo.nome}`} onClick={() => setExcluindoTipo(tipo)}><Trash2 size={14} /></IconButton>
                  </Flex>
                </li>
              ))}
            </ul>
          </Flex>
        </Tabs.Content>
      </Tabs.Root>

      {editandoTipo && (
        <FormularioTipo inicial={editandoTipo} onClose={() => setEditandoTipo(null)}
          onSalvo={() => { setEditandoTipo(null); recarregar(); avisar({ texto: 'Tipo de prazo salvo.' }) }} />
      )}
      {editandoRegra && (
        <FormularioRegra inicial={editandoRegra} tipos={tipos} onClose={() => setEditandoRegra(null)}
          onSalvo={() => { setEditandoRegra(null); recarregar(); avisar({ texto: 'Regra salva.' }) }} />
      )}

      <Dialog.Root open={Boolean(excluindoTipo)} onOpenChange={aberto => { if (!aberto) setExcluindoTipo(null) }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Excluir o tipo “{excluindoTipo?.nome}”?</Dialog.Title>
          <Dialog.Description size="2" color="gray">Só é possível excluir um tipo que nenhuma regra usa. Os prazos já criados não mudam.</Dialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button color="red" onClick={() => void excluirTipo()}>Excluir</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={Boolean(excluindoRegra)} onOpenChange={aberto => { if (!aberto) setExcluindoRegra(null) }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Excluir a regra “{excluindoRegra?.nome}”?</Dialog.Title>
          <Dialog.Description size="2" color="gray">A regra deixa de sugerir prazos. Os prazos e as dispensas já registrados continuam como estão.</Dialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close><Button variant="soft" color="gray">Cancelar</Button></Dialog.Close>
            <Button color="red" onClick={() => void excluirRegra()}>Excluir</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  )
}

function FormularioTipo({ inicial, onClose, onSalvo }: { inicial: RascunhoTipo; onClose: () => void; onSalvo: () => void }) {
  const { cliente } = useCliente()
  const [d, setD] = useState<RascunhoTipo>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const valido = d.nome.trim().length > 0 && Number.isInteger(d.dias) && d.dias >= 1 && d.dias <= 365

  async function salvar() {
    setSalvando(true); setErro('')
    const corpo = {
      nome: d.nome.trim(), dias: d.dias, contagem: d.contagem,
      base_legal: d.base_legal.trim() || null, inicio: d.inicio, ativo: d.ativo,
    }
    try {
      if (d.id) await enviarJson(cliente, `/tipos-prazo/${encodeURIComponent(d.id)}`, corpo, 'PATCH')
      else await enviarJson(cliente, '/tipos-prazo', corpo, 'POST')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o tipo de prazo.')
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={aberto => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{d.id ? 'Editar tipo de prazo' : 'Novo tipo de prazo'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">O tipo define quantos dias o prazo tem e de onde a contagem começa.</Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="tipo-nome">Nome do tipo de prazo</Text>
            <TextField.Root id="tipo-nome" value={d.nome} maxLength={120} placeholder="Ex.: Contestação" onChange={e => setD({ ...d, nome: e.target.value })} />
          </Flex>
          <Flex gap="3" wrap="wrap">
            <Flex direction="column" gap="1" style={{ flex: '1 1 8rem' }}>
              <Text as="label" size="2" weight="medium" htmlFor="tipo-dias">Dias</Text>
              <TextField.Root id="tipo-dias" type="number" min={1} max={365} step={1}
                value={Number.isNaN(d.dias) ? '' : d.dias} placeholder="1 a 365"
                onChange={e => setD({ ...d, dias: e.target.value === '' ? NaN : Number(e.target.value) })} />
            </Flex>
            <Flex direction="column" gap="1" style={{ flex: '1 1 12rem' }}>
              <Text as="label" size="2" weight="medium" htmlFor="tipo-contagem">Contagem</Text>
              <Select.Root value={d.contagem} onValueChange={v => setD({ ...d, contagem: v as TipoPrazo['contagem'] })}>
                <Select.Trigger id="tipo-contagem" aria-label="Contagem do prazo" />
                <Select.Content><Select.Item value="uteis">Dias úteis</Select.Item><Select.Item value="corridos">Dias corridos</Select.Item></Select.Content>
              </Select.Root>
            </Flex>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="tipo-inicio">Início da contagem</Text>
            <Select.Root value={d.inicio} onValueChange={v => setD({ ...d, inicio: v as TipoPrazo['inicio'] })}>
              <Select.Trigger id="tipo-inicio" aria-label="Início da contagem do prazo" />
              <Select.Content>
                <Select.Item value="disponibilizacao">Disponibilização no DJEN</Select.Item>
                <Select.Item value="movimento">Data do movimento</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="tipo-base-legal">Base legal (opcional)</Text>
            <TextField.Root id="tipo-base-legal" value={d.base_legal} maxLength={200} placeholder="Ex.: CPC art. 335" onChange={e => setD({ ...d, base_legal: e.target.value })} />
          </Flex>
          <Text as="span" size="2"><Flex gap="2" align="center"><Switch aria-label="Tipo de prazo ativo" checked={d.ativo} onCheckedChange={v => setD({ ...d, ativo: v })} />Tipo ativo (pode ser usado em regras)</Flex></Text>
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button size="2" disabled={!valido || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar tipo'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function FormularioRegra({ inicial, tipos, onClose, onSalvo }: {
  inicial: RascunhoRegra; tipos: TipoPrazo[]; onClose: () => void; onSalvo: () => void
}) {
  const { cliente } = useCliente()
  const [d, setD] = useState<RascunhoRegra>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [avisoEscopo, setAvisoEscopo] = useState('')
  const [previa, setPrevia] = useState<{ texto: string; leitura?: string; erro?: string } | null>(null)
  const [prevendo, setPrevendo] = useState('')
  const opcoesTipo = useMemo(() => tipos.filter(t => t.ativo || t.id === d.tipo_id), [tipos, d.tipo_id])
  const semTipo = tipos.length === 0
  const expressao = d.palavras.trim()
  // A prévia só vale para o texto atual; enquanto o novo resultado não chega, a anterior não aparece.
  const previaAtual = previa && previa.texto === expressao ? previa : null
  const lendo = prevendo === expressao && !previaAtual
  const valido = Boolean(d.tipo_id) && (d.escopo.length > 0 || Boolean(expressao)) && previaAtual?.erro === undefined

  // Prévia da expressão: espera a pessoa parar de digitar e chama a leitura humana do servidor.
  useEffect(() => {
    const texto = d.palavras.trim()
    if (!texto || !cliente) return
    let ativo = true
    const controlador = new AbortController()
    const espera = setTimeout(async () => {
      setPrevendo(texto)
      try {
        const resposta = await requisitar(cliente, '/regras-prazo/previa', {
          metodo: 'POST', corpo: { palavras: texto }, signal: controlador.signal,
        })
        const dados = await resposta.json() as { leitura?: string }
        if (ativo) setPrevia({ texto, leitura: dados.leitura ?? '' })
      } catch (e) {
        if (ativo) setPrevia({ texto, erro: e instanceof Error ? e.message : 'Não foi possível ler a expressão.' })
      } finally {
        if (ativo) setPrevendo(atual => (atual === texto ? '' : atual))
      }
    }, 400)
    return () => { ativo = false; controlador.abort(); clearTimeout(espera) }
  }, [cliente, d.palavras])

  function adicionarEscopo(tipo: EscopoItem['tipo'], item: ItemTpu | null) {
    if (!item) return
    setAvisoEscopo('')
    if (d.escopo.length >= 20) { setAvisoEscopo('Limite de 20 itens no escopo.'); return }
    const novo: EscopoItem = { tipo, codigo: item.codigo, nome: item.nome }
    if (d.escopo.some(i => chaveDoEscopo(i) === chaveDoEscopo(novo))) {
      setAvisoEscopo('Esse item já está no escopo.')
      return
    }
    setD({ ...d, escopo: [...d.escopo, novo] })
  }

  async function salvar() {
    setSalvando(true); setErro('')
    const corpo = {
      nome: d.nome.trim(), tipo_id: d.tipo_id, escopo: d.escopo,
      palavras: d.palavras.trim(), combinacao: d.combinacao, ativo: d.ativo,
    }
    try {
      if (d.id) await enviarJson(cliente, `/regras-prazo/${encodeURIComponent(d.id)}`, corpo, 'PATCH')
      else await enviarJson(cliente, '/regras-prazo', corpo, 'POST')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a regra.')
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={aberto => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{d.id ? 'Editar regra' : 'Nova regra de prazo'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          A regra sugere um prazo quando o processo e o evento combinam com o escopo e/ou as palavras-chave abaixo. Você confere a data antes de criar.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="regra-nome">Nome da regra (opcional)</Text>
            <TextField.Root id="regra-nome" value={d.nome} maxLength={120} placeholder="Se vazio, usa o nome do tipo de prazo"
              onChange={e => setD({ ...d, nome: e.target.value })} />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="regra-tipo">Tipo de prazo</Text>
            <Select.Root value={d.tipo_id || undefined} onValueChange={v => setD({ ...d, tipo_id: v })}>
              <Select.Trigger id="regra-tipo" placeholder="Escolha o tipo de prazo" aria-label="Tipo de prazo da regra" />
              <Select.Content>
                {opcoesTipo.map(t => (
                  <Select.Item key={t.id} value={t.id}>{t.nome}{t.ativo ? '' : ' (inativo)'}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {semTipo && (
              <Callout.Root color="amber" size="1" role="status"><Callout.Icon><Info size={14} /></Callout.Icon>
                <Callout.Text>Cadastre um tipo de prazo, na aba Tipos de prazo, antes de criar uma regra.</Callout.Text>
              </Callout.Root>
            )}
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">Escopo (assunto ou classe)</Text>
            {d.escopo.length >= 20 ? (
              <Text size="1" color="gray">Limite de 20 itens no escopo.</Text>
            ) : (
              <Flex gap="3" wrap="wrap">
                <Flex direction="column" gap="1" style={{ flex: '1 1 16rem' }}>
                  <Text as="label" size="1" color="gray" htmlFor="regra-escopo-classe">Classe processual</Text>
                  <CampoTpu id="regra-escopo-classe" tabela="classes" valor="" escolhido={null}
                    onChange={(_, item) => adicionarEscopo('classe', item)} />
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: '1 1 16rem' }}>
                  <Text as="label" size="1" color="gray" htmlFor="regra-escopo-assunto">Assunto</Text>
                  <CampoTpu id="regra-escopo-assunto" tabela="assuntos" valor="" escolhido={null}
                    onChange={(_, item) => adicionarEscopo('assunto', item)} />
                </Flex>
              </Flex>
            )}
            {d.escopo.length > 0 && (
              <Flex direction="column" gap="1">
                {d.escopo.map((item, i) => (
                  <Flex key={`${item.tipo}-${item.codigo ?? item.nome}-${i}`} align="center" justify="between" gap="2">
                    <Text size="2">{item.tipo === 'classe' ? 'Classe' : 'Assunto'} · {item.nome}{item.codigo !== null ? ` (${item.codigo})` : ''}</Text>
                    <IconButton size="1" variant="soft" color="gray" aria-label={`Remover ${item.nome} do escopo`}
                      onClick={() => setD({ ...d, escopo: d.escopo.filter((_, j) => j !== i) })}><Trash2 size={14} /></IconButton>
                  </Flex>
                ))}
              </Flex>
            )}
            {avisoEscopo && <Text size="1" color="gray" role="status">{avisoEscopo}</Text>}
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="regra-palavras">Palavras-chave (opcional)</Text>
            <TextField.Root id="regra-palavras" value={d.palavras} maxLength={500}
              placeholder={'Ex.: contestar ou "prazo de 15 dias" sem recurso'}
              aria-describedby="regra-palavras-ajuda"
              onChange={e => setD({ ...d, palavras: e.target.value })} />
            <Text as="p" size="1" color="gray" id="regra-palavras-ajuda">{AJUDA_PALAVRAS}</Text>
            {lendo && <Text size="1" color="gray" role="status">Lendo a expressão…</Text>}
            {previaAtual?.erro && (
              <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{previaAtual.erro}</Callout.Text>
              </Callout.Root>
            )}
            {previaAtual?.leitura !== undefined && (
              <Callout.Root color="green" size="1" role="status"><Callout.Icon><Info size={14} /></Callout.Icon>
                <Callout.Text>A regra casa com: {previaAtual.leitura}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="regra-combinacao">Casar quando</Text>
            <Select.Root value={d.combinacao} onValueChange={v => setD({ ...d, combinacao: v as Regra['combinacao'] })}>
              <Select.Trigger id="regra-combinacao" aria-label="Casar quando" />
              <Select.Content>
                <Select.Item value="e">Assunto/classe E palavras-chave (padrão)</Select.Item>
                <Select.Item value="ou">Assunto/classe OU palavras-chave</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <Text as="span" size="2"><Flex gap="2" align="center"><Switch aria-label="Regra ativa" checked={d.ativo} onCheckedChange={v => setD({ ...d, ativo: v })} />Regra ativa (pode sugerir prazos)</Flex></Text>
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button size="2" disabled={!valido || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar regra'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
