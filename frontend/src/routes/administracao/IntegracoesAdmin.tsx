import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Card, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import Carregamento from '../../Carregamento'
import { avisarDadosAlterados } from '../../api/rest'
import {
  CAMPOS, DESCRICOES, PRECISAM_GOOGLE, SO_NO_PAINEL_AVANCADO, agruparCatalogo, chaveItem, ehAsaas, estadoAtual, linhaHistorico,
  mesmoConteudo, seloItem, textoAjuda, tituloItem, type EventoIntegracao, type ItemIntegracao,
} from './integracoes'

type Dados = { integracoes: ItemIntegracao[]; historico: EventoIntegracao[]; asaas_ambiente: string; drive_conectado: boolean; pode_gerir_administradores: boolean }
type Confirmacao = { titulo: string; texto: string; rotulo: string; acao: () => Promise<void> }

async function api<T>(token: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch('/admin/integracoes' + caminho, {
    method: corpo === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  })
  const dados = await r.json().catch(() => ({})) as T & { erro?: string }
  if (!r.ok) throw new Error(dados.erro || 'Não foi possível concluir a operação.')
  if (corpo !== undefined) avisarDadosAlterados()
  return dados
}

/** Configuração das integrações do escritório. As credenciais nunca voltam ao navegador: só aparecem mascaradas,
 *  e uma configuração nova só é ativada depois de um teste aprovado. */
export default function IntegracoesAdmin({ token }: { token: string }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [falha, setFalha] = useState('')
  const [selecionado, setSelecionado] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [candidato, setCandidato] = useState<{ id: number; conteudo: Record<string, string> } | null>(null)
  const [teste, setTeste] = useState<string | null>(null)
  const [retorno, setRetorno] = useState<{ texto: string; tom: 'green' | 'red' | 'gray' } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)

  const item = useMemo(() => dados?.integracoes.find(i => chaveItem(i) === selecionado) ?? null, [dados, selecionado])

  const invalidar = () => { setCandidato(null); setTeste(null); setRetorno(null) }
  const preencher = useCallback((i: ItemIntegracao) => {
    setValores(Object.fromEntries((CAMPOS[i.provedor] ?? []).map(c => [c.nome, c.segredo ? '' : (i.parametros[c.nome] ?? '')])))
    setCandidato(null); setTeste(null)
  }, [])

  const carregar = useCallback(async (manterRetorno = false, manter = '') => {
    setCarregando(true)
    try {
      const d = await api<Dados>(token, '/api')
      setDados(d); setFalha('')
      const atual = d.integracoes.find(i => chaveItem(i) === manter) ?? d.integracoes.find(i => i.provedor === 'zapsign') ?? d.integracoes[0]
      if (atual) { setSelecionado(chaveItem(atual)); preencher(atual) }
      if (!manterRetorno) setRetorno(null)
    } catch (e) {
      setFalha(e instanceof TypeError ? 'Não foi possível falar com o servidor. Confira sua conexão.' : (e as Error).message)
    } finally { setCarregando(false) }
  }, [token, preencher])
  useEffect(() => { void carregar() }, [carregar])

  async function executar(fn: () => Promise<void>) {
    if (ocupado) return
    setOcupado(true)
    try { await fn() } catch (e) { setRetorno({ texto: (e as Error).message, tom: 'red' }) } finally { setOcupado(false) }
  }
  function escolher(i: ItemIntegracao) { if (ocupado) return; setSelecionado(chaveItem(i)); preencher(i); setRetorno(null) }
  function editar(nome: string, valor: string) { setValores(v => ({ ...v, [nome]: valor })); invalidar() }

  async function garantirCandidato(i: ItemIntegracao) {
    if (candidato && mesmoConteudo(candidato.conteudo, valores)) return candidato.id
    const r = await api<{ candidato: number }>(token, '/candidato', { provedor: i.provedor, ambiente: i.ambiente, dados: valores, base: i.versao })
    setCandidato({ id: r.candidato, conteudo: { ...valores } }); setTeste(null)
    return r.candidato
  }
  const testar = (i: ItemIntegracao) => executar(async () => {
    const id = await garantirCandidato(i)
    const r = await api<{ aprovado: boolean; mensagem: string; teste: string }>(token, '/testar', { candidato: id })
    setTeste(r.aprovado ? r.teste : null)
    setRetorno({ texto: r.mensagem, tom: r.aprovado ? 'green' : 'red' })
  })
  const ativar = (i: ItemIntegracao) => {
    const producao = ehAsaas(i) && i.ambiente === 'producao'
    const fazer = () => executar(async () => {
      if (!candidato || !teste || !mesmoConteudo(candidato.conteudo, valores)) { invalidar(); return }
      await api(token, '/ativar', { candidato: candidato.id, teste, confirmar_producao: producao })
      await carregar(true, chaveItem(i))
      setRetorno({ texto: 'Configuração ativada. As próximas chamadas usarão os novos valores.', tom: 'green' })
    })
    if (producao) setConfirmacao({ titulo: 'Ativar no ambiente de produção?', texto: 'Esta chave do Asaas passará a gerar cobranças reais.', rotulo: 'Ativar em produção', acao: fazer })
    else void fazer()
  }
  const desativar = (i: ItemIntegracao) => setConfirmacao({
    titulo: `Desativar ${tituloItem(i)}?`, texto: 'O serviço ficará indisponível até uma nova configuração ser ativada.', rotulo: 'Desativar',
    acao: () => executar(async () => { await api(token, '/desativar', { provedor: i.provedor, ambiente: i.ambiente, base: i.versao, confirmar: true }); await carregar(true, chaveItem(i)); setRetorno({ texto: 'Integração desativada.', tom: 'gray' }) }),
  })
  const usarAmbiente = (i: ItemIntegracao) => {
    const producao = i.ambiente === 'producao'
    const fazer = () => executar(async () => { await api(token, '/ambiente', { ambiente: i.ambiente, confirmar_producao: producao }); await carregar(true, chaveItem(i)); setRetorno({ texto: 'Ambiente de cobranças atualizado.', tom: 'green' }) })
    if (producao) setConfirmacao({ titulo: 'Usar produção nas próximas cobranças?', texto: 'As cobranças do Asaas passarão a ser reais.', rotulo: 'Usar produção', acao: fazer })
    else void fazer()
  }
  const autorizarGoogle = (i: ItemIntegracao) => executar(async () => {
    const corpo = i.provedor === 'google_oauth' ? { candidato: await garantirCandidato(i) } : {}
    const r = await api<{ url: string }>(token, '/google', corpo)
    if (new URL(r.url).origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.')
    window.open(r.url, '_blank', 'noopener')
    setRetorno({ texto: 'Conclua a autorização na aba do Google. Depois volte e teste a configuração.', tom: 'gray' })
  })

  if (carregando && !dados) return <Carregamento tipo="texto" descricao="Carregando integrações…" />
  if (!dados) {
    return (
      <Callout.Root color="red" role="alert" mt="4">
        <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
        <Callout.Text>{falha || 'Não foi possível carregar as integrações.'} <Button variant="ghost" size="1" onClick={() => void carregar()}>Tentar de novo</Button></Callout.Text>
      </Callout.Root>
    )
  }
  const grupos = agruparCatalogo(dados.integracoes)
  const campos = item ? (CAMPOS[item.provedor] ?? []) : []
  const soAvancado = item ? SO_NO_PAINEL_AVANCADO.has(item.provedor) : false
  const historico = item ? dados.historico.filter(h => h.provedor === item.provedor && h.ambiente === item.ambiente) : []

  return (
    <Flex direction="column" gap="4" mt="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <div>
          <Heading as="h2" size="4">Integrações</Heading>
          <Text as="p" size="2" color="gray">Conexões do escritório com serviços externos. As credenciais ficam cifradas no servidor e só aparecem mascaradas.</Text>
        </div>
        <Button variant="soft" size="2" disabled={ocupado || carregando} onClick={() => void carregar(false, selecionado)}>Atualizar</Button>
      </Flex>
      <Callout.Root color="gray" size="1">
        <Callout.Text>Uma configuração nova só é ativada depois de um teste aprovado; campos de senha vazios preservam o valor atual. A conexão da <strong>agenda Google de cada pessoa</strong> fica em Meu perfil (menu da conta).</Callout.Text>
      </Callout.Root>

      <div className="administracao__integracoes">
        <nav aria-label="Serviços" className="administracao__integracoes-lista">
          {grupos.map(g => (
            <section key={g.chave} aria-label={g.titulo}>
              <Text as="p" size="1" weight="bold" color="gray" mb="1">{g.titulo}</Text>
              <Flex direction="column" gap="1">
                {g.itens.map(i => {
                  const selo = seloItem(i, dados.asaas_ambiente, dados.drive_conectado)
                  return (
                    <button key={chaveItem(i)} type="button" className="administracao__servico" aria-pressed={chaveItem(i) === selecionado} onClick={() => escolher(i)}>
                      <span>{tituloItem(i)}</span><Badge color={selo.cor} variant="soft">{selo.texto}</Badge>
                    </button>
                  )
                })}
              </Flex>
            </section>
          ))}
        </nav>

        {item && (
          <Card variant="surface" className="administracao__integracoes-editor">
            <form onSubmit={e => { e.preventDefault(); if (!soAvancado) void testar(item) }}>
              <Flex direction="column" gap="3">
                <div>
                  <Heading as="h3" size="3">{tituloItem(item)}</Heading>
                  <Text as="p" size="2" color="gray">{DESCRICOES[item.provedor]}</Text>
                  <Text as="p" size="2" mt="1">{estadoAtual(item)}</Text>
                </div>
                {campos.map(c => (
                  <div className="form-campo" key={c.nome}>
                    <label className="form-campo-label" htmlFor={`integ-${c.nome}`}>{c.rotulo}</label>
                    <TextField.Root id={`integ-${c.nome}`} name={c.nome} type={c.segredo ? 'password' : 'text'} autoComplete="off" maxLength={8192}
                      value={valores[c.nome] ?? ''} onChange={e => editar(c.nome, e.target.value)} />
                    {c.segredo && <Text size="1" color="gray">{item.segredos[c.nome] ? `Credencial atual: ${item.segredos[c.nome]}. Deixe vazio para preservar.` : 'Nenhuma credencial cadastrada.'}</Text>}
                  </div>
                ))}
                <Text as="p" size="1" color="gray">{textoAjuda(item.provedor, window.location.origin)}</Text>
                <div aria-live="polite">
                  {retorno && <Callout.Root color={retorno.tom} size="1" role="status"><Callout.Text>{retorno.texto}</Callout.Text></Callout.Root>}
                </div>
                <Flex gap="2" wrap="wrap">
                  <Button type="submit" variant="soft" disabled={ocupado || soAvancado}>{ocupado ? 'Aguarde…' : 'Testar conexão'}</Button>
                  <Button type="button" disabled={ocupado || !teste || !candidato || !mesmoConteudo(candidato.conteudo, valores)} onClick={() => ativar(item)}>Ativar configuração</Button>
                  {PRECISAM_GOOGLE.has(item.provedor) && <Button type="button" variant="soft" disabled={ocupado} onClick={() => void autorizarGoogle(item)}>{item.provedor === 'drive' ? 'Conectar conta Google' : 'Autorizar conta Google'}</Button>}
                  {ehAsaas(item) && item.versao > 0 && item.ambiente !== dados.asaas_ambiente && <Button type="button" variant="soft" disabled={ocupado} onClick={() => usarAmbiente(item)}>Usar este ambiente</Button>}
                  {item.versao > 0 && <Button type="button" variant="ghost" color="red" disabled={ocupado} onClick={() => desativar(item)}>Desativar</Button>}
                </Flex>
                <div>
                  <Text as="p" size="2" weight="medium" mb="1">Histórico</Text>
                  {historico.length ? historico.slice(0, 8).map((h, i) => <Text as="p" size="1" color="gray" key={i}>{linhaHistorico(h)}</Text>) : <Text as="p" size="1" color="gray">Nenhuma alteração registrada.</Text>}
                </div>
              </Flex>
            </form>
          </Card>
        )}
      </div>

      <Text as="p" size="1" color="gray">
        Para o desafio do reCAPTCHA, a reencriptação com a chave mestra e a permissão de administrador de integrações, use o{' '}
        <a href="/admin/integracoes" target="_blank" rel="noopener">painel avançado</a>.
      </Text>

      <AlertDialog.Root open={confirmacao !== null} onOpenChange={aberto => { if (!aberto) setConfirmacao(null) }}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>{confirmacao?.titulo}</AlertDialog.Title>
          <AlertDialog.Description size="2">{confirmacao?.texto}</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">Cancelar</Button></AlertDialog.Cancel>
            <AlertDialog.Action><Button color="red" onClick={() => { const c = confirmacao; setConfirmacao(null); void c?.acao() }}>{confirmacao?.rotulo}</Button></AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
