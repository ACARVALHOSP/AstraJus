import { useEffect, useMemo, useState } from 'react'
import { Button, Callout, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, PenLine } from 'lucide-react'
import { useAvisos } from './Avisos'
import CampoData from './CampoData'
import { useCliente } from './api/ClienteContext'
import { useCasos, useClientes } from './api/consultas'
import { ErroMCP } from './api/mcpClient'
import { enviarJson } from './api/rest'
import { interpretar, type TipoAnotacao } from './utils/anotarRapido'
import { formatarNomeExibicao } from './utils/formatadores'

type CasoLista = { id: string; titulo?: string | null; cliente_id?: string | null; processos?: string[] }
type Caso = { id: string; titulo?: string | null; cliente?: string | null; processos?: string[] }
const SEM_CASOS: CasoLista[] = []
const SEM_CLIENTES: { id: string; nome?: string }[] = []
const TIPOS: Record<TipoAnotacao, string> = { tarefa: 'Tarefa', prazo: 'Prazo', audiencia: 'Audiência', reuniao: 'Reunião' }
type Edicoes = { titulo?: string; tipo?: TipoAnotacao; data?: string; hora?: string; casoId?: string }

/** Anotação rápida no topo (atalho "/"): escreva "prazo contestação Maria sexta" e a atividade se monta sozinha. */
export default function AnotarRapido() {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [edicoes, setEdicoes] = useState<Edicoes>({})
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const consultaCasos = useCasos<CasoLista>({ enabled: aberto && Boolean(cliente) })
  const consultaClientes = useClientes({ enabled: aberto && Boolean(cliente) })
  const listaCasos = consultaCasos.data ?? SEM_CASOS
  const listaClientes = consultaClientes.data ?? SEM_CLIENTES
  // /casos devolve só o cliente_id: o nome vem da lista de contatos, para "Maria" achar o processo dela.
  const casos = useMemo<Caso[]>(() => {
    const nomes = new Map(listaClientes.map(c => [c.id, c.nome ?? '']))
    return listaCasos.map(c => ({ id: c.id, titulo: c.titulo, cliente: nomes.get(c.cliente_id ?? '') ?? '', processos: c.processos }))
  }, [listaCasos, listaClientes])

  // "/" abre a anotação de qualquer tela, menos quando a pessoa já está digitando.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const alvo = e.target instanceof HTMLElement ? e.target : null
      if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return
      e.preventDefault()
      setAberto(true)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const lido = useMemo(() => interpretar(texto, new Date(), casos), [texto, casos])
  const titulo = edicoes.titulo ?? lido.titulo
  const tipo = edicoes.tipo ?? lido.tipo
  const data = edicoes.data ?? lido.data
  const hora = edicoes.hora ?? lido.hora
  const casoId = edicoes.casoId ?? lido.casoId ?? ''
  const caso = casos.find(c => c.id === casoId)
  const candidatos = lido.candidatos.length > 1 ? casos.filter(c => lido.candidatos.includes(c.id)) : []

  function fechar() {
    setAberto(false)
    setTexto('')
    setEdicoes({})
    setErro(null)
  }

  async function salvar() {
    if (!titulo.trim()) { setErro('Escreva o que precisa ser feito.'); return }
    if (!casoId) { setErro('Escolha o processo da atividade.'); return }
    setSalvando(true)
    setErro(null)
    try {
      await enviarJson(cliente, `/casos/${encodeURIComponent(casoId)}/atividades`, {
        tipo, titulo: titulo.trim(), data: data || null, hora: hora || null, responsavel: null, observacoes: null,
      })
      avisar({ tipo: 'sucesso', texto: `Atividade criada${caso?.titulo ? ` em “${formatarNomeExibicao(caso.titulo)}”` : ''}.` })
      fechar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <button className="aj-ib" aria-label="Anotar rápido (tecla /)" title="Anotar rápido (tecla /)" onClick={() => setAberto(true)}>
        <PenLine size={18} />
      </button>
      <Dialog.Root open={aberto} onOpenChange={o => { if (!o) fechar() }}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>Anotar rápido</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="3">
            Escreva do seu jeito, por exemplo: prazo contestação Maria sexta, ou audiência amanhã 14h30.
          </Dialog.Description>
          <Flex direction="column" gap="3">
            <TextField.Root
              autoFocus
              autoComplete="off"
              aria-label="Anotação"
              placeholder="O que precisa ser feito?"
              value={texto}
              onChange={e => { setTexto(e.target.value); setEdicoes({}) }}
              onKeyDown={e => { if (e.key === 'Enter' && !salvando) { e.preventDefault(); void salvar() } }}
            />
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="anotar-titulo">Título</label>
              <TextField.Root id="anotar-titulo" autoComplete="off" value={titulo} onChange={e => setEdicoes(x => ({ ...x, titulo: e.target.value }))} />
            </div>
            <div className="casos-formulario-grade">
              <div className="form-campo">
                <label className="form-campo-label" id="anotar-tipo-rotulo">Tipo</label>
                <Select.Root value={tipo} onValueChange={v => setEdicoes(x => ({ ...x, tipo: v as TipoAnotacao }))}>
                  <Select.Trigger aria-labelledby="anotar-tipo-rotulo" style={{ width: '100%' }} />
                  <Select.Content>
                    {(Object.keys(TIPOS) as TipoAnotacao[]).map(t => <Select.Item key={t} value={t}>{TIPOS[t]}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="anotar-data">Data</label>
                <CampoData id="anotar-data" value={data} onChange={v => setEdicoes(x => ({ ...x, data: v }))} />
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="anotar-hora">Hora</label>
                <TextField.Root id="anotar-hora" type="time" value={hora} onChange={e => setEdicoes(x => ({ ...x, hora: e.target.value }))} />
              </div>
              <div className="form-campo">
                <label className="form-campo-label" id="anotar-caso-rotulo">Processo <span className="aj-obrigatorio" aria-hidden="true">*</span></label>
                <Select.Root value={casoId || undefined} onValueChange={v => setEdicoes(x => ({ ...x, casoId: v }))}>
                  <Select.Trigger aria-labelledby="anotar-caso-rotulo" placeholder="Escolha o processo" style={{ width: '100%' }} />
                  <Select.Content>
                    {(candidatos.length ? candidatos : casos).map(c => (
                      <Select.Item key={c.id} value={c.id}>
                        {formatarNomeExibicao(c.titulo || 'Sem título')}{c.cliente ? ` · ${formatarNomeExibicao(c.cliente)}` : ''}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </div>
            </div>
            {candidatos.length > 1 && !edicoes.casoId && (
              <Text size="1" color="gray">Mais de um processo combina com o texto; escolha um da lista.</Text>
            )}
            {erro && (
              <Callout.Root color="red" size="1" role="alert">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{erro}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" justify="end" mt="4">
            <Button variant="soft" color="gray" size="2" onClick={fechar}>Cancelar</Button>
            <Button size="2" loading={salvando} disabled={!cliente} onClick={() => void salvar()}>Criar atividade</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
