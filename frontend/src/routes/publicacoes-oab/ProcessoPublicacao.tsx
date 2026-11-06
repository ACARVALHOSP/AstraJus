import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Callout, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import type { Caso } from '../casos/ListaCasos'
import { nomePublicacao, numeroPublicacao, type PublicacaoOab } from './dados'

export default function ProcessoPublicacao({ publicacao, onClose, onConcluido }: {
  publicacao: PublicacaoOab; onClose: () => void; onConcluido: (mensagem: string) => void
}) {
  const { cliente } = useCliente()
  const numero = numeroPublicacao(publicacao)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [casos, setCasos] = useState<Caso[]>([])
  const [clientes, setClientes] = useState<Array<{ id: string; nome: string }>>([])
  const [responsaveis, setResponsaveis] = useState<string[]>([])
  const [clienteId, setClienteId] = useState('')
  const [nomeCliente, setNomeCliente] = useState(publicacao.nome_pesquisado ?? '')
  const [responsavel, setResponsavel] = useState('')
  const [termo, setTermo] = useState(numero)
  const [escolhido, setEscolhido] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [etapa, setEtapa] = useState('')
  // Keep the created ID across retries: a failed cover update must never create twice.
  const criado = useRef<Caso | null>(null)
  const [processoCriado, setProcessoCriado] = useState(false)
  const trava = useRef(false)
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    let ativo = true
    Promise.all([
      buscarJson<{ casos: Caso[] }>(cliente, `/casos?q=${encodeURIComponent(numero)}`),
      buscarJson<{ clientes: Array<{ id: string; nome: string }> }>(cliente, '/clientes'),
      buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis'),
    ]).then(([processos, pessoas, equipe]) => {
      if (!ativo) return
      const exatos = processos.casos.filter(c => c.processos?.some(n => n.replace(/\D/g, '') === numero))
      setCasos(exatos); setEscolhido(exatos[0]?.id ?? ''); setClientes(pessoas.clientes); setResponsaveis(equipe.responsaveis); setErro('')
    }).catch(e => { if (ativo) setErro(e.message) }).finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [cliente, numero, tentativa])

  async function consultar() {
    if (trava.current) return
    trava.current = true; setSalvando(true); setErro('')
    try {
      const r = await buscarJson<{ casos: Caso[] }>(cliente, `/casos?q=${encodeURIComponent(termo.trim())}`)
      setCasos(r.casos); setEscolhido(r.casos[0]?.id ?? '')
    } catch (e) { setErro((e as Error).message) } finally { trava.current = false; setSalvando(false) }
  }
  async function concluir() {
    if (trava.current || carregando) return
    trava.current = true; setSalvando(true); setErro('')
    try {
      let caso = criado.current
      if (!caso && escolhido) {
        caso = casos.find(c => c.id === escolhido) ?? null
        if (!caso) throw new Error('Confirme o processo de destino.')
        setEtapa('Vinculando publicação…')
        await enviarJson(cliente, `/casos/${encodeURIComponent(caso.id)}/publicacoes`, { hash: publicacao.hash })
        criado.current = caso; setProcessoCriado(true)
      }
      if (!caso) {
        if (!clienteId && !nomeCliente.trim()) throw new Error('Selecione um cliente ou informe o nome do novo cliente.')
        if (!responsavel) throw new Error('Selecione um responsável.')
        // Repeat the exact-CNJ lookup immediately before creating.
        const r = await buscarJson<{ casos: Caso[] }>(cliente, `/casos?q=${encodeURIComponent(numero)}`)
        const existentes = r.casos.filter(c => c.processos?.some(n => n.replace(/\D/g, '') === numero))
        if (existentes.length) { setCasos(existentes); setEscolhido(existentes[0].id); throw new Error('Já existe um processo com este CNJ. Confira o destino e confirme o vínculo.') }
        setEtapa('Criando processo com os dados da publicação…')
        caso = await enviarJson<Caso>(cliente, `/publicacoes-oab/${encodeURIComponent(publicacao.hash)}/criar-caso`, {
          ...(clienteId ? { cliente_id: clienteId } : { nome_cliente: nomeCliente.trim() }), responsavel,
        })
        criado.current = caso; setProcessoCriado(true)
      }
      const tribunal = publicacao.dados?.siglaTribunal?.toLowerCase() || siglaTribunalPorNumero(numero)
      // Do not overwrite an existing process cover on a simple link. New covers are enriched automatically.
      if (!escolhido && tribunal) {
        setEtapa('Preenchendo a capa automaticamente com DataJud e DJEN…')
        const capa = await enviarJson<{ aviso?: string }>(cliente, `/casos/${encodeURIComponent(caso.id)}/processos/${numero}/capa/atualizar`, { tribunal })
        if (capa.aviso) throw new Error(`Processo criado e vinculado. A capa requer revisão: ${capa.aviso}. Use Tentar novamente para completar a consulta.`)
      }
      if (!escolhido && !tribunal) throw new Error('Processo criado e vinculado; tribunal não identificado. Complete a capa no cadastro do processo.')
      onConcluido(escolhido ? 'Publicação vinculada. O estado de revisão foi preservado.' : 'Processo criado e capa preenchida. A publicação permanece disponível para revisão.')
    } catch (e) { setErro((e as Error).message) } finally { trava.current = false; setSalvando(false); setEtapa('') }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !salvando) onClose() }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Criar ou vincular processo</Dialog.Title>
        <Flex direction="column" gap="5">
          <Text as="p" size="2">{formatarNumeroCNJ(numero)} · {nomePublicacao(publicacao)}</Text>
          <Text as="p" size="2" color="gray">Os dados disponíveis serão preenchidos automaticamente. Campos ausentes permanecem sem informação.</Text>
          {carregando && <Text as="p" size="2" role="status">Consultando processos, clientes e responsáveis…</Text>}
          {!carregando && !processoCriado && <>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-consulta-processo">Consultar processo por CNJ, parte ou cliente</label>
              <TextField.Root id="oab-consulta-processo" value={termo} disabled={salvando} onChange={e => setTermo(e.target.value)} />
            </div>
            <div>
              <Button variant="soft" size="1" disabled={salvando || !termo.trim()} onClick={consultar}>Consultar processos</Button>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-processo-destino">Processo de destino</label>
              <Select.Root value={escolhido || '__novo__'} disabled={salvando} onValueChange={(v) => setEscolhido(v === '__novo__' ? '' : v)}>
                <Select.Trigger id="oab-processo-destino" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__novo__">Criar novo processo</Select.Item>
                  {casos.map(c => <Select.Item key={c.id} value={c.id}>{`${formatarNomeExibicao(c.titulo) || c.id} · ${(c.processos ?? []).map(formatarNumeroCNJ).join(', ')}`}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
            {escolhido ? <Text as="p" size="2">Confirme o vínculo com o processo acima. O cadastro e a capa existentes serão preservados.</Text> : <>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="oab-processo-cliente">Cliente</label>
                <Select.Root value={clienteId || '__novo__'} disabled={salvando} onValueChange={(v) => setClienteId(v === '__novo__' ? '' : v)}>
                  <Select.Trigger id="oab-processo-cliente" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__novo__">Novo cliente</Select.Item>
                    {clientes.map(c => <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.nome)}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
              </div>
              {!clienteId && (
                <div className="form-campo">
                  <label className="form-campo-label" htmlFor="oab-processo-novo-cliente">Nome do novo cliente</label>
                  <TextField.Root id="oab-processo-novo-cliente" value={nomeCliente} disabled={salvando} onChange={e => setNomeCliente(e.target.value)} />
                </div>
              )}
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="oab-processo-responsavel">Responsável</label>
                <Select.Root value={responsavel || '__none__'} disabled={salvando} onValueChange={(v) => setResponsavel(v === '__none__' ? '' : v)}>
                  <Select.Trigger id="oab-processo-responsavel" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__none__">Selecione</Select.Item>
                    {responsaveis.map(r => <Select.Item key={r} value={r}>{formatarNomeExibicao(r)}</Select.Item>)}
                  </Select.Content>
                </Select.Root>
              </div>
            </>}
          </>}
          {salvando && <Text as="p" size="2" role="status">{etapa || 'Consultando…'}</Text>}
          {erro && <>
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
            {!processoCriado && (
              <div>
                <Button variant="ghost" size="1" disabled={salvando} onClick={() => { setCarregando(true); setTentativa(n => n + 1) }}>Recarregar dados</Button>
              </div>
            )}
          </>}
          <Flex gap="3" mt="2" justify="end">
            <Button variant="soft" color="gray" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button disabled={salvando || carregando || numero.length !== 20} onClick={concluir}>
              {processoCriado ? 'Tentar novamente' : escolhido ? 'Confirmar vínculo' : 'Criar processo e preencher capa'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
