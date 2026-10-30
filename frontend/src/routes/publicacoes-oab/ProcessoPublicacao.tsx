import { useEffect, useRef, useState } from 'react'
import { Button, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
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
      setEtapa('Atualizando status…')
      const resultado = await enviarJson<{ hashes_falharam?: string[] }>(cliente, '/publicacoes-oab/status', { hashes: [publicacao.hash], status: 'tratada' })
      if (resultado.hashes_falharam?.length) throw new Error('Processo vinculado, mas não foi possível marcar a publicação como tratada. Tente novamente.')
      onConcluido(escolhido ? 'Publicação vinculada e marcada como tratada.' : 'Processo criado, capa preenchida e publicação tratada.')
    } catch (e) { setErro((e as Error).message) } finally { trava.current = false; setSalvando(false); setEtapa('') }
  }
  return <Modal open={true} size="lg" modalHeading="Criar ou vincular processo" closeButtonLabel="Fechar" primaryButtonText={processoCriado ? 'Tentar novamente' : escolhido ? 'Confirmar vínculo' : 'Criar processo e preencher capa'} secondaryButtonText="Cancelar" primaryButtonDisabled={salvando || carregando || numero.length !== 20} onRequestClose={() => { if (!salvando) onClose() }} onRequestSubmit={concluir}>
    <Stack gap={5}>
      <p>{formatarNumeroCNJ(numero)} · {nomePublicacao(publicacao)}</p>
      <p>Os dados disponíveis serão preenchidos automaticamente. Campos ausentes permanecem sem informação.</p>
      {carregando && <p role="status">Consultando processos, clientes e responsáveis…</p>}
      {!carregando && !processoCriado && <>
        <TextInput id="oab-consulta-processo" labelText="Consultar processo por CNJ, parte ou cliente" value={termo} disabled={salvando} onChange={e => setTermo(e.target.value)} />
        <Button kind="tertiary" size="sm" disabled={salvando || !termo.trim()} onClick={consultar}>Consultar processos</Button>
        <Select id="oab-processo-destino" labelText="Processo de destino" value={escolhido} disabled={salvando} onChange={e => setEscolhido(e.target.value)}>
          <SelectItem value="" text="Criar novo processo" />
          {casos.map(c => <SelectItem key={c.id} value={c.id} text={`${formatarNomeExibicao(c.titulo) || c.id} · ${(c.processos ?? []).map(formatarNumeroCNJ).join(', ')}`} />)}
        </Select>
        {escolhido ? <p>Confirme o vínculo com o processo acima. O cadastro e a capa existentes serão preservados.</p> : <>
          <Select id="oab-processo-cliente" labelText="Cliente" value={clienteId} disabled={salvando} onChange={e => setClienteId(e.target.value)}>
            <SelectItem value="" text="Novo cliente" />{clientes.map(c => <SelectItem key={c.id} value={c.id} text={formatarNomeExibicao(c.nome)} />)}
          </Select>
          {!clienteId && <TextInput id="oab-processo-novo-cliente" labelText="Nome do novo cliente" value={nomeCliente} disabled={salvando} onChange={e => setNomeCliente(e.target.value)} />}
          <Select id="oab-processo-responsavel" labelText="Responsável" value={responsavel} disabled={salvando} onChange={e => setResponsavel(e.target.value)}>
            <SelectItem value="" text="Selecione" />{responsaveis.map(r => <SelectItem key={r} value={r} text={formatarNomeExibicao(r)} />)}
          </Select>
        </>}
      </>}
      {salvando && <p role="status">{etapa || 'Consultando…'}</p>}
      {erro && <><InlineNotification kind="error" title={processoCriado ? 'Processo preservado; conclusão pendente' : 'Não foi possível concluir'} subtitle={erro} lowContrast hideCloseButton />{!processoCriado && <Button kind="ghost" size="sm" disabled={salvando} onClick={() => { setCarregando(true); setTentativa(n => n + 1) }}>Recarregar dados</Button>}</>}
    </Stack>
  </Modal>
}
