import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Box, Button, Callout, Checkbox, Dialog, Flex, Select, Table, Text, TextArea, TextField } from '@radix-ui/themes'
import { AlertTriangle, Download, FilePlus, RefreshCw, Send, Trash2, Upload } from 'lucide-react'
import { useAvisos } from '../Avisos'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useCliente } from '../api/ClienteContext'
import { useCasos, useClientes } from '../api/consultas'
import { ErroMCP } from '../api/mcpClient'
import { usePerfil } from '../api/PerfilContext'
import { buscarJson, enviarJson, requisitar } from '../api/rest'
import { formatarDataSimples } from '../utils/formatadores'
import './home/home-radix.css'

type Variavel = { chave: string; rotulo: string; origem: string }
type Catalogo = { variaveis: Variavel[]; poderes: { chave: string; texto: string }[]; tipos: string[]; zapsign: boolean }
type Modelo = { id: number; nome: string; tipo: string; variaveis: string[]; criado_em: string }
type Signatario = { nome?: string; email?: string; status?: string; assinou_em?: string | null; link?: string }
type Documento = {
  id: number; nome: string; cliente_id: string | null; status: 'gerado' | 'enviado' | 'assinado' | 'recusado' | 'expirado'
  signatarios: Signatario[]; tem_pdf: boolean; tem_assinado: boolean; criado_em: string
}
type Campo = { chave: string; rotulo: string; origem: string; valor: string }
type Paragrafo = { texto: string; negrito: boolean; centralizado: boolean }
type ContatoLista = { id: string; nome?: string; email?: string | null; telefone?: string | null }
type CasoLista = { id: string; titulo?: string; cliente_id?: string }

const TIPOS: Record<string, string> = { procuracao: 'Procuração', contrato: 'Contrato', outro: 'Outro' }
const STATUS: Record<string, { rotulo: string; cor: 'gray' | 'blue' | 'green' | 'red' | 'amber' }> = {
  gerado: { rotulo: 'Gerado', cor: 'gray' }, enviado: { rotulo: 'Aguardando assinatura', cor: 'blue' },
  assinado: { rotulo: 'Assinado', cor: 'green' }, recusado: { rotulo: 'Recusado', cor: 'red' }, expirado: { rotulo: 'Expirado', cor: 'amber' },
}
const LONGOS = new Set(['poderes', 'objeto', 'condicoes_pagamento', 'cliente_qualificacao'])
const CAMPO = /\{\{\s*([a-z0-9_]+)\s*\}\}/g
const NENHUM = '__nenhum__'

const mensagem = (e: unknown, padrao: string) => (e instanceof ErroMCP ? e.message : padrao)

function Erro({ texto }: { texto: string | null }) {
  return texto ? <Callout.Root color="red" size="1"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{texto}</Callout.Text></Callout.Root> : null
}

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '')
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
    leitor.readAsDataURL(arquivo)
  })
}

/** Modelos DOCX com {{campos}}, geração do PDF preenchido e envio para assinatura (ZapSign). */
export default function Documentos() {
  const { cliente } = useCliente()
  const { nivel } = usePerfil()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const administrador = nivel === 'administrador'
  const [dialogo, setDialogo] = useState<null | 'modelo' | 'gerar'>(null)
  const [enviando, setEnviando] = useState<Documento | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)

  const catalogo = useQuery({ queryKey: ['documentos-catalogo', cliente?.token], enabled: !!cliente, queryFn: ({ signal }) => buscarJson<Catalogo>(cliente, '/documentos/catalogo', signal) })
  const modelos = useQuery({ queryKey: ['documentos-modelos', cliente?.token], enabled: !!cliente, queryFn: ({ signal }) => buscarJson<{ modelos: Modelo[] }>(cliente, '/documentos/modelos', signal).then(r => r.modelos) })
  const documentos = useQuery({ queryKey: ['documentos', cliente?.token], enabled: !!cliente, queryFn: ({ signal }) => buscarJson<{ documentos: Documento[] }>(cliente, '/documentos', signal).then(r => r.documentos) })
  const contatos = useClientes<ContatoLista>()
  const nomeContato = (id: string | null) => contatos.data?.find(c => c.id === id)?.nome ?? ''

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: ['documentos'] })

  async function baixar(doc: Documento, tipo: 'pdf' | 'docx' | 'assinado') {
    try {
      const resposta = await requisitar(cliente, `/documentos/${doc.id}/arquivo?tipo=${tipo}`)
      const url = URL.createObjectURL(await resposta.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${doc.nome}${tipo === 'docx' ? '.docx' : '.pdf'}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { avisar({ texto: mensagem(e, 'Não foi possível baixar o arquivo.'), tipo: 'erro' }) }
  }

  async function atualizar(doc: Documento) {
    setOcupado(doc.id)
    try {
      await enviarJson(cliente, `/documentos/${doc.id}/atualizar`, {})
      recarregar()
    } catch (e) { avisar({ texto: mensagem(e, 'Não foi possível consultar a ZapSign.'), tipo: 'erro' }) } finally { setOcupado(null) }
  }

  async function excluirModelo(m: Modelo) {
    try {
      await enviarJson(cliente, `/documentos/modelos/${m.id}`, undefined, 'DELETE')
      void queryClient.invalidateQueries({ queryKey: ['documentos-modelos'] })
    } catch (e) { avisar({ texto: mensagem(e, 'Não foi possível excluir o modelo.'), tipo: 'erro' }) }
  }

  return (
    <div className="home">
      <CabecalhoPagina
        titulo="Documentos"
        descricao="Procurações e contratos a partir dos seus modelos do Word, preenchidos com os dados do contato e enviados para assinatura."
        acoes={(
          <Flex gap="2" wrap="wrap">
            {administrador && <Button size="2" variant="soft" color="gray" disabled={!cliente} onClick={() => setDialogo('modelo')}><Upload size={15} aria-hidden="true" />Enviar modelo</Button>}
            <Button size="2" disabled={!cliente || !modelos.data?.length} onClick={() => setDialogo('gerar')}><FilePlus size={16} aria-hidden="true" />Gerar documento</Button>
          </Flex>
        )}
      />
      {!cliente && <Text as="p" size="2" color="gray">Conecte-se na aba Acesso para ver os documentos.</Text>}
      {catalogo.data && !catalogo.data.zapsign && (
        <Callout.Root color="amber" size="1" mb="3"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>A ZapSign ainda não está configurada em Integrações: dá para gerar o PDF, mas não enviar para assinatura.</Callout.Text></Callout.Root>
      )}

      <Text as="p" size="3" weight="bold" mb="2">Modelos</Text>
      {modelos.isLoading ? <Carregamento tipo="detalhe" descricao="Carregando modelos…" /> : !modelos.data?.length ? (
        <Text as="p" size="2" color="gray" mb="5">Nenhum modelo ainda.{administrador ? ' Envie um DOCX com campos como {{cliente_nome}} e {{poderes}}.' : ' Peça a um administrador para enviar os modelos.'}</Text>
      ) : (
        <Table.Root variant="surface" mb="5">
          <Table.Header><Table.Row><Table.ColumnHeaderCell>Modelo</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Tipo</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Campos</Table.ColumnHeaderCell><Table.ColumnHeaderCell /></Table.Row></Table.Header>
          <Table.Body>
            {modelos.data.map(m => (
              <Table.Row key={m.id}>
                <Table.RowHeaderCell>{m.nome}</Table.RowHeaderCell>
                <Table.Cell>{TIPOS[m.tipo] ?? m.tipo}</Table.Cell>
                <Table.Cell><Text size="1" color="gray">{m.variaveis.length} campos</Text></Table.Cell>
                <Table.Cell justify="end">{administrador && <Button size="1" variant="ghost" color="red" aria-label={`Excluir ${m.nome}`} onClick={() => void excluirModelo(m)}><Trash2 size={14} /></Button>}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      <Text as="p" size="3" weight="bold" mb="2">Documentos gerados</Text>
      {documentos.isLoading ? <Carregamento tipo="detalhe" descricao="Carregando documentos…" /> : !documentos.data?.length ? (
        <Text as="p" size="2" color="gray">Nenhum documento gerado ainda.</Text>
      ) : (
        <Table.Root variant="surface">
          <Table.Header><Table.Row><Table.ColumnHeaderCell>Documento</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Contato</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Situação</Table.ColumnHeaderCell><Table.ColumnHeaderCell>Criado em</Table.ColumnHeaderCell><Table.ColumnHeaderCell /></Table.Row></Table.Header>
          <Table.Body>
            {documentos.data.map(d => (
              <Table.Row key={d.id}>
                <Table.RowHeaderCell>{d.nome}</Table.RowHeaderCell>
                <Table.Cell>{nomeContato(d.cliente_id)}</Table.Cell>
                <Table.Cell>
                  <Badge color={STATUS[d.status].cor}>{STATUS[d.status].rotulo}</Badge>
                  {d.status === 'enviado' && d.signatarios.length > 0 && <Text as="div" size="1" color="gray">{d.signatarios.filter(s => s.status === 'signed').length}/{d.signatarios.length} assinaram</Text>}
                </Table.Cell>
                <Table.Cell>{formatarDataSimples(d.criado_em.slice(0, 10))}</Table.Cell>
                <Table.Cell justify="end">
                  <Flex gap="2" justify="end" wrap="wrap">
                    {d.tem_pdf && <Button size="1" variant="soft" color="gray" onClick={() => void baixar(d, 'pdf')}><Download size={13} aria-hidden="true" />PDF</Button>}
                    <Button size="1" variant="soft" color="gray" onClick={() => void baixar(d, 'docx')}><Download size={13} aria-hidden="true" />DOCX</Button>
                    {d.tem_assinado && <Button size="1" variant="soft" color="green" onClick={() => void baixar(d, 'assinado')}><Download size={13} aria-hidden="true" />Assinado</Button>}
                    {d.status === 'gerado' && d.tem_pdf && catalogo.data?.zapsign && <Button size="1" onClick={() => setEnviando(d)}><Send size={13} aria-hidden="true" />Enviar para assinatura</Button>}
                    {d.status === 'enviado' && <Button size="1" variant="soft" loading={ocupado === d.id} onClick={() => void atualizar(d)}><RefreshCw size={13} aria-hidden="true" />Atualizar</Button>}
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {dialogo === 'modelo' && catalogo.data && <DialogoModelo catalogo={catalogo.data} onFechar={() => setDialogo(null)} />}
      {dialogo === 'gerar' && catalogo.data && modelos.data && (
        <DialogoGerar catalogo={catalogo.data} modelos={modelos.data} contatos={contatos.data ?? []}
          onFechar={() => setDialogo(null)} onGerado={(d) => { setDialogo(null); recarregar(); if (catalogo.data?.zapsign) setEnviando(d) }} />
      )}
      {enviando && <DialogoEnviar documento={enviando} contato={contatos.data?.find(c => c.id === enviando.cliente_id)} onFechar={() => setEnviando(null)} onEnviado={() => { setEnviando(null); recarregar() }} />}
    </div>
  )
}

function DialogoModelo({ catalogo, onFechar }: { catalogo: Catalogo; onFechar: () => void }) {
  const { cliente } = useCliente()
  const queryClient = useQueryClient()
  const arquivo = useRef<HTMLInputElement>(null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('procuracao')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const f = arquivo.current?.files?.[0]
    if (!f) { setErro('Escolha o arquivo DOCX do modelo.'); return }
    setSalvando(true); setErro(null)
    try {
      await enviarJson(cliente, '/documentos/modelos', { nome, tipo, arquivo_base64: await lerBase64(f) })
      void queryClient.invalidateQueries({ queryKey: ['documentos-modelos'] })
      onFechar()
    } catch (e) { setErro(mensagem(e, 'Não foi possível enviar o modelo.')) } finally { setSalvando(false) }
  }

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onFechar() }}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>Enviar modelo</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">Escreva o modelo no Word e coloque os campos entre chaves duplas, como {'{{cliente_nome}}'}. Salve como .docx.</Dialog.Description>
        <Flex direction="column" gap="3">
          <TextField.Root aria-label="Nome do modelo" placeholder="Nome do modelo" maxLength={120} value={nome} onChange={e => setNome(e.target.value)} />
          <Select.Root value={tipo} onValueChange={setTipo}>
            <Select.Trigger aria-label="Tipo do modelo" />
            <Select.Content>{catalogo.tipos.map(t => <Select.Item key={t} value={t}>{TIPOS[t] ?? t}</Select.Item>)}</Select.Content>
          </Select.Root>
          <input ref={arquivo} type="file" aria-label="Arquivo DOCX" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          <details>
            <summary><Text size="2" weight="bold">Campos disponíveis</Text></summary>
            <Flex direction="column" gap="1" mt="2">
              {catalogo.variaveis.map(v => <Text key={v.chave} size="1"><code>{`{{${v.chave}}}`}</code> — {v.rotulo}{v.origem === 'manual' ? ' (preenchido por você ao gerar)' : ''}</Text>)}
              <Text size="1" color="gray">Campos com outro nome também funcionam e ficam para preenchimento manual.</Text>
            </Flex>
          </details>
          <Erro texto={erro} />
        </Flex>
        <Flex gap="3" justify="end" mt="4">
          <Button variant="soft" color="gray" size="2" onClick={onFechar}>Cancelar</Button>
          <Button size="2" loading={salvando} disabled={!nome.trim()} onClick={() => void salvar()}>Enviar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Troca cada {{campo}} do parágrafo pelo valor digitado ou por um aviso amarelo de campo em branco. */
function partesDoParagrafo(texto: string, valores: Record<string, string>, rotulos: Record<string, string>, foco: string | null) {
  const partes: ReactNode[] = []
  let ultimo = 0
  for (const achado of texto.matchAll(CAMPO)) {
    const inicio = achado.index ?? 0
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio))
    const chave = achado[1]
    const valor = (valores[chave] ?? '').trim()
    const emFoco = foco === chave
    partes.push(
      <span key={`${inicio}-${chave}`} data-campo={chave} style={{
        whiteSpace: 'pre-wrap',
        ...(valor ? {} : { background: '#fff3b0', color: '#5c4a00', padding: '0 2px', borderRadius: 2 }),
        outline: emFoco ? '2px solid var(--accent-9)' : undefined,
      }}>
        {valor || `[${rotulos[chave] ?? chave}]`}
      </span>,
    )
    ultimo = inicio + achado[0].length
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return partes
}

/** Prévia ao vivo do documento: o texto do modelo com os valores trocados a cada tecla, tudo no cliente. */
function PreviaDocumento({ paragrafos, valores, rotulos, foco }: {
  paragrafos: Paragrafo[]; valores: Record<string, string>; rotulos: Record<string, string>; foco: string | null
}) {
  const caixa = useRef<HTMLDivElement>(null)

  // Mantém o campo em foco visível dentro do papel.
  useEffect(() => {
    if (!foco) return
    caixa.current?.querySelector<HTMLElement>(`[data-campo="${foco}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [foco])

  return (
    <>
      <Box ref={caixa} style={{
        background: '#fff', color: '#1a1a1a', fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: 12, lineHeight: 1.55, padding: '18px 20px', border: '1px solid var(--gray-a5)',
        borderRadius: 'var(--radius-3)', maxHeight: '60vh', overflow: 'auto',
      }}>
        {paragrafos.map((p, i) => (
          <Text as="p" key={i} style={{
            margin: '0 0 8px', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
            fontWeight: p.negrito ? 700 : 400, textAlign: p.centralizado ? 'center' : 'justify', whiteSpace: 'pre-wrap',
          }}>
            {partesDoParagrafo(p.texto, valores, rotulos, foco)}
          </Text>
        ))}
      </Box>
      <Text as="p" size="1" color="gray" mt="2">Prévia aproximada: o papel timbrado e a paginação aparecem no PDF.</Text>
    </>
  )
}

function DialogoGerar({ catalogo, modelos, contatos, onFechar, onGerado }: {
  catalogo: Catalogo; modelos: Modelo[]; contatos: ContatoLista[]; onFechar: () => void; onGerado: (d: Documento) => void
}) {
  const { cliente } = useCliente()
  const casos = useCasos<CasoLista>()
  const [modeloId, setModeloId] = useState(String(modelos[0]?.id ?? ''))
  const [contatoId, setContatoId] = useState('')
  const [casoId, setCasoId] = useState('')
  const [campos, setCampos] = useState<Campo[]>([])
  const [paragrafos, setParagrafos] = useState<Paragrafo[]>([])
  const [automaticos, setAutomaticos] = useState<Set<string>>(new Set())
  const [foco, setFoco] = useState<string | null>(null)
  const [poderes, setPoderes] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const casosDoContato = (casos.data ?? []).filter(c => c.cliente_id === contatoId)

  // Recarrega os valores sugeridos ao trocar modelo, contato ou processo.
  useEffect(() => {
    if (!modeloId) return
    let cancelado = false
    enviarJson<{ campos: Campo[]; paragrafos: Paragrafo[] }>(cliente, `/documentos/modelos/${modeloId}/previa`, { cliente_id: contatoId || null, caso_id: casoId || null })
      .then(r => {
        if (cancelado) return
        setCampos(r.campos)
        setParagrafos(r.paragrafos ?? [])
        // Guarda o que já veio do cadastro para destacar os campos na prévia.
        setAutomaticos(new Set(r.campos.filter(c => c.origem !== 'manual' && c.valor.trim()).map(c => c.chave)))
        setErro(null)
      })
      .catch(e => { if (!cancelado) setErro(mensagem(e, 'Não foi possível carregar o modelo.')) })
    return () => { cancelado = true }
  }, [cliente, modeloId, contatoId, casoId])

  function definir(chave: string, valor: string) {
    setCampos(cs => cs.map(c => (c.chave === chave ? { ...c, valor } : c)))
  }

  // Marcar poderes monta o texto; ele continua editável à mão.
  function alternarPoder(chave: string, texto: string, marcado: boolean) {
    const novo = new Set(poderes)
    if (marcado) novo.add(chave); else novo.delete(chave)
    setPoderes(novo)
    setFoco('poderes')
    definir('poderes', catalogo.poderes.filter(p => novo.has(p.chave)).map(p => p.texto).join('; ') + (novo.size ? '.' : ''))
    void texto
  }

  async function gerar() {
    setGerando(true); setErro(null)
    const modelo = modelos.find(m => String(m.id) === modeloId)
    try {
      const r = await enviarJson<{ documento: Documento }>(cliente, '/documentos', {
        modelo_id: Number(modeloId), cliente_id: contatoId || null, caso_id: casoId || null,
        nome: `${modelo?.nome ?? 'Documento'}${contatoId ? ' - ' + (contatos.find(c => c.id === contatoId)?.nome ?? '') : ''}`,
        valores: Object.fromEntries(campos.map(c => [c.chave, c.valor])),
      })
      onGerado(r.documento)
    } catch (e) { setErro(mensagem(e, 'Não foi possível gerar o documento.')) } finally { setGerando(false) }
  }

  const modelo = modelos.find(m => String(m.id) === modeloId)
  const valores = Object.fromEntries(campos.map(c => [c.chave, c.valor]))
  const rotulos = Object.fromEntries(campos.map(c => [c.chave, c.rotulo]))
  const emBranco = campos.filter(c => !c.valor.trim()).length
  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onFechar() }}>
      <Dialog.Content maxWidth="1100px" maxHeight="90vh">
        <Dialog.Title>Gerar documento</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">Os campos vêm preenchidos com os dados do contato e podem ser editados antes de gerar o PDF.</Dialog.Description>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
          <Flex direction="column" gap="3">
            <Flex gap="3" wrap="wrap">
              <Select.Root value={modeloId} onValueChange={setModeloId}>
                <Select.Trigger aria-label="Modelo" />
                <Select.Content>{modelos.map(m => <Select.Item key={m.id} value={String(m.id)}>{m.nome}</Select.Item>)}</Select.Content>
              </Select.Root>
              <Select.Root value={contatoId || NENHUM} onValueChange={v => { setContatoId(v === NENHUM ? '' : v); setCasoId('') }}>
                <Select.Trigger aria-label="Contato" placeholder="Contato" />
                <Select.Content>
                  <Select.Item value={NENHUM}>Sem contato (preencher à mão)</Select.Item>
                  {contatos.map(c => <Select.Item key={c.id} value={c.id}>{c.nome}</Select.Item>)}
                </Select.Content>
              </Select.Root>
              {casosDoContato.length > 0 && (
                <Select.Root value={casoId || NENHUM} onValueChange={v => setCasoId(v === NENHUM ? '' : v)}>
                  <Select.Trigger aria-label="Processo" placeholder="Processo" />
                  <Select.Content>
                    <Select.Item value={NENHUM}>Sem processo</Select.Item>
                    {casosDoContato.map(c => <Select.Item key={c.id} value={c.id}>{c.titulo}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
              )}
            </Flex>
            {modelo?.variaveis.includes('poderes') && (
              <Flex direction="column" gap="1" role="group" aria-label="Poderes">
                <Text size="2" weight="bold">Poderes</Text>
                {catalogo.poderes.map(p => (
                  <Text as="label" size="2" key={p.chave}><Flex gap="2" align="center"><Checkbox checked={poderes.has(p.chave)} onCheckedChange={v => alternarPoder(p.chave, p.texto, v === true)} />{p.texto}</Flex></Text>
                ))}
              </Flex>
            )}
            {automaticos.size > 0 && <Text size="1" color="gray">Borda verde: veio do cadastro</Text>}
            {campos.map(c => {
              const doCadastro = automaticos.has(c.chave)
              return (
                <Flex key={c.chave} direction="column" gap="1">
                  <Text as="label" size="2" weight="bold" htmlFor={`doc-${c.chave}`}>{c.rotulo}</Text>
                  {LONGOS.has(c.chave)
                    ? <TextArea id={`doc-${c.chave}`} rows={c.chave === 'cliente_qualificacao' ? 3 : 4} value={c.valor}
                        onChange={e => definir(c.chave, e.target.value)} onFocus={() => setFoco(c.chave)} onBlur={() => setFoco(null)}
                        style={doCadastro ? { boxShadow: 'inset 3px 0 0 var(--green-9)' } : undefined} />
                    : <TextField.Root id={`doc-${c.chave}`} value={c.valor}
                        onChange={e => definir(c.chave, e.target.value)} onFocus={() => setFoco(c.chave)} onBlur={() => setFoco(null)}
                        style={doCadastro ? { boxShadow: 'inset 3px 0 0 var(--green-9)' } : undefined} />}
                  {c.origem === 'manual' && !c.valor && <Text size="1" color="gray">Em branco, o documento sai com uma linha ________ para preencher.</Text>}
                </Flex>
              )
            })}
            <Erro texto={erro} />
          </Flex>
          <div style={{ position: 'sticky', top: 0 }}>
            <PreviaDocumento paragrafos={paragrafos} valores={valores} rotulos={rotulos} foco={foco} />
          </div>
        </div>
        <Flex gap="3" justify="between" align="center" mt="4" wrap="wrap">
          <Text size="1" color="gray">
            {emBranco ? `${emBranco} campo(s) em branco: sairão como ________` : 'Todos os campos preenchidos. Confira a prévia.'}
          </Text>
          <Flex gap="3">
            <Button variant="soft" color="gray" size="2" onClick={onFechar}>Cancelar</Button>
            <Button size="2" loading={gerando} disabled={!modeloId} onClick={() => void gerar()}>Gerar PDF</Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function DialogoEnviar({ documento, contato, onFechar, onEnviado }: {
  documento: Documento; contato?: ContatoLista; onFechar: () => void; onEnviado: () => void
}) {
  const { cliente } = useCliente()
  const [nome, setNome] = useState(contato?.nome ?? '')
  const [email, setEmail] = useState(contato?.email ?? '')
  const [telefone, setTelefone] = useState(contato?.telefone ?? '')
  const [canal, setCanal] = useState<'email' | 'whatsapp'>('email')
  const [prazo, setPrazo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    setEnviando(true); setErro(null)
    try {
      await enviarJson(cliente, `/documentos/${documento.id}/enviar`, { signatarios: [{ nome, email, telefone }], canal, prazo: prazo || null })
      onEnviado()
    } catch (e) { setErro(mensagem(e, 'Não foi possível enviar para assinatura.')) } finally { setEnviando(false) }
  }

  return (
    <Dialog.Root open onOpenChange={o => { if (!o) onFechar() }}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Enviar para assinatura</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">{documento.nome}. A ZapSign envia o link de assinatura ao signatário.</Dialog.Description>
        <Flex direction="column" gap="3">
          <TextField.Root aria-label="Nome do signatário" placeholder="Nome do signatário" value={nome} onChange={e => setNome(e.target.value)} />
          <TextField.Root aria-label="E-mail" placeholder="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <TextField.Root aria-label="Telefone com DDD" placeholder="Telefone com DDD" value={telefone} onChange={e => setTelefone(e.target.value)} />
          <Select.Root value={canal} onValueChange={v => setCanal(v as 'email' | 'whatsapp')}>
            <Select.Trigger aria-label="Enviar por" />
            <Select.Content><Select.Item value="email">Enviar por e-mail</Select.Item><Select.Item value="whatsapp">Enviar por WhatsApp</Select.Item></Select.Content>
          </Select.Root>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" htmlFor="doc-prazo">Prazo para assinar (opcional)</Text>
            <TextField.Root id="doc-prazo" type="date" value={prazo} onChange={e => setPrazo(e.target.value)} />
          </Flex>
          <Erro texto={erro} />
        </Flex>
        <Flex gap="3" justify="end" mt="4">
          <Button variant="soft" color="gray" size="2" onClick={onFechar}>Agora não</Button>
          <Button size="2" loading={enviando} onClick={() => void enviar()}>Enviar</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
