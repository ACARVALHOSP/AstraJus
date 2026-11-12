import { useState, useEffect, useCallback } from 'react'
import { Badge, Button, Callout, Card, Flex, Grid, Heading, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, CheckCircle, ChevronRight, RefreshCw } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import CabecalhoPagina from '../../CabecalhoPagina'

const NOMES: Record<string, string> = {
  drive: 'Google Drive', asaas: 'Asaas', zapsign: 'ZapSign',
  datajud: 'DataJud', smtp: 'SMTP', recaptcha: 'reCAPTCHA', google_oauth: 'Google OAuth',
}

type Campo = [string, string, boolean?]
const SCHEMA: Record<string, Campo[]> = {
  drive:       [['pasta_raiz', 'ID da pasta institucional']],
  asaas:       [['api_key', 'Nova chave da API', true]],
  zapsign:     [['api_key', 'Nova chave da API', true]],
  datajud:     [['api_key', 'Nova chave da API', true]],
  smtp:        [['host', 'Servidor SMTP'], ['porta', 'Porta TLS (465 ou 587)'], ['usuario', 'Usuário'], ['senha', 'Nova senha', true], ['remetente', 'E-mail remetente']],
  recaptcha:   [['site_key', 'Site key'], ['secret', 'Nova secret key', true]],
  google_oauth:[['client_id', 'Client ID'], ['client_secret', 'Novo client secret', true]],
}

type ItemCatalogo = {
  provedor: string; ambiente: string; escopo: string; estado: string
  versao: number; testado_em: number | null; parametros: Record<string, string>; segredos: Record<string, string>
}

type Dados = {
  integracoes: ItemCatalogo[]; historico: Array<Record<string, string | number>>
  asaas_ambiente: string; drive_conectado: boolean; pode_gerir_administradores: boolean
}

function chave(item: ItemCatalogo) { return item.provedor + ':' + item.ambiente }

async function api(token: string, path: string, corpo?: unknown) {
  const r = await fetch('/admin/integracoes' + path, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: 'no-store',
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.erro || 'Não foi possível concluir a operação.')
  return j
}

export default function AdminIntegracoes() {
  const { cliente, status } = useCliente()
  const [dados, setDados] = useState<Dados | null>(null)
  const [selecionado, setSelecionado] = useState<ItemCatalogo | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [candidato, setCandidato] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState('')
  const [teste, setTeste] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const token = cliente?.token ?? ''

  const carregar = useCallback(async () => {
    if (!token) return
    setCarregando(true)
    try {
      const d: Dados = await api(token, '/api')
      setDados(d)
      setSelecionado(prev => {
        const atual = prev ? d.integracoes.find(x => chave(x) === chave(prev)) : null
        return atual ?? d.integracoes.find(x => x.provedor === 'zapsign') ?? d.integracoes[0] ?? null
      })
    } catch (e) {
      setFeedback({ tipo: 'erro', texto: (e as Error).message })
    } finally {
      setCarregando(false)
    }
  }, [token])

  useEffect(() => { void carregar() }, [carregar])

  useEffect(() => {
    if (!selecionado) return
    const vals: Record<string, string> = {}
    for (const [name,, secret] of SCHEMA[selecionado.provedor] ?? [])
      vals[name] = secret ? '' : (selecionado.parametros[name] ?? '')
    setCampos(vals)
    setCandidato(null); setSnapshot(''); setTeste(null); setFeedback(null)
  }, [selecionado])

  const valorAtual = JSON.stringify(campos)

  async function executar(fn: () => Promise<void>) {
    if (ocupado) return
    setOcupado(true)
    try { await fn() } catch (e) { setFeedback({ tipo: 'erro', texto: (e as Error).message }) }
    finally { setOcupado(false) }
  }

  async function garantirCandidato() {
    if (candidato && snapshot === valorAtual) return candidato
    const r = await api(token, '/candidato', { provedor: selecionado!.provedor, ambiente: selecionado!.ambiente, dados: campos, base: selecionado!.versao })
    setCandidato(r.candidato); setSnapshot(valorAtual); setTeste(null)
    return r.candidato as string
  }

  async function testar() {
    await executar(async () => {
      const id = await garantirCandidato()
      const r = await api(token, '/testar', { candidato: id })
      setTeste(r.aprovado ? r.teste : null)
      setFeedback({ tipo: r.aprovado ? 'ok' : 'erro', texto: r.mensagem })
    })
  }

  async function ativar() {
    if (snapshot !== valorAtual) { setCandidato(null); setTeste(null); return }
    await executar(async () => {
      const prod = selecionado!.provedor === 'asaas' && selecionado!.ambiente === 'producao'
      if (prod && !confirm('Ativar esta chave Asaas no ambiente de PRODUÇÃO?')) return
      await api(token, '/ativar', { candidato, teste, confirmar_producao: prod })
      await carregar()
      setFeedback({ tipo: 'ok', texto: 'Configuração ativada. As próximas chamadas usarão os novos valores.' })
    })
  }

  async function desativar() {
    if (!confirm('Desativar ' + NOMES[selecionado!.provedor] + ' neste ambiente? O serviço ficará indisponível.')) return
    await executar(async () => {
      await api(token, '/desativar', { provedor: selecionado!.provedor, ambiente: selecionado!.ambiente, base: selecionado!.versao, confirmar: true })
      await carregar()
      setFeedback({ tipo: 'info', texto: 'Integração desativada.' })
    })
  }

  async function autorizarGoogle() {
    await executar(async () => {
      const corpo = selecionado!.provedor === 'google_oauth' ? { candidato: await garantirCandidato() } : {}
      const r = await api(token, '/google', corpo)
      const url = new URL(r.url)
      if (url.origin !== 'https://accounts.google.com') throw new Error('URL de autorização inválida.')
      window.open(r.url, '_blank', 'noopener')
      setFeedback({ tipo: 'info', texto: 'Conclua a autorização na aba Google. Depois volte e teste a configuração.' })
    })
  }

  if (status !== 'conectado') return (
    <Callout.Root color="gray"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
      <Callout.Text>Conecte-se primeiro para acessar as configurações de integrações.</Callout.Text>
    </Callout.Root>
  )

  const grupos = { escritorio: 'Escritório · Institucional', sistema: 'Sistema · Configurações gerais' } as const
  const historicoDo = dados?.historico.filter(h => h.provedor === selecionado?.provedor && h.ambiente === selecionado?.ambiente) ?? []
  const ativacaoOk = teste !== null && snapshot === valorAtual

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Administração de integrações"
        descricao="Configurações de serviços externos. Credenciais existentes ficam mascaradas; uma nova configuração só é ativada após um teste aprovado."
        acoes={<Button variant="soft" color="gray" size="2" onClick={carregar} disabled={carregando}><RefreshCw size={14} />Recarregar</Button>}
      />

      {!dados && carregando && <Text size="2" color="gray">Carregando…</Text>}

      {dados && (
        <Grid columns={{ initial: '1', md: '2' }} gap="5" align="start">
          {/* Catálogo */}
          <Card variant="surface">
            <Flex direction="column" gap="1">
              {(['escritorio', 'sistema'] as const).map(escopo => (
                <Flex direction="column" gap="1" key={escopo}>
                  <Text size="1" weight="bold" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '.05em', padding: '12px 4px 4px' }}>
                    {grupos[escopo]}
                  </Text>
                  {dados.integracoes.filter(i => i.escopo === escopo).map(item => {
                    const ativo = selecionado && chave(selecionado) === chave(item)
                    const rotulo = item.provedor === 'asaas'
                      ? (item.ambiente === 'sandbox' ? 'Homologação' : 'Produção') + (item.ambiente === dados.asaas_ambiente ? ' · Em uso' : '')
                      : escopo === 'escritorio' ? 'Conta institucional' : 'Configuração geral'
                    const tagEstado = item.provedor === 'drive' && dados.drive_conectado ? 'Conta conectada' : item.estado === 'ativo' ? 'Configurado' : 'Não configurado'
                    const tagCor = item.estado === 'ativo' || (item.provedor === 'drive' && dados.drive_conectado) ? 'green' : 'gray'
                    return (
                      <button key={chave(item)} onClick={() => setSelecionado(item)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 8px', background: ativo ? 'var(--accent-a3)' : 'transparent', border: 'none', borderLeft: ativo ? '3px solid var(--accent-9)' : '3px solid transparent', borderRadius: '4px', cursor: 'pointer', textAlign: 'left', gap: 8 }}>
                        <Flex direction="column" gap="1">
                          <Text size="2" weight={ativo ? 'bold' : 'regular'}>{NOMES[item.provedor]}</Text>
                          <Text size="1" color="gray">{rotulo}</Text>
                        </Flex>
                        <Flex align="center" gap="2">
                          <Badge color={tagCor} variant="soft" radius="full">{tagEstado}</Badge>
                          <ChevronRight size={14} color="var(--gray-8)" />
                        </Flex>
                      </button>
                    )
                  })}
                </Flex>
              ))}
              <Text size="1" color="gray" style={{ padding: '12px 4px 4px' }}>
                Google Calendar é individual. Cada usuário autoriza a própria agenda na página Integrações.
              </Text>
            </Flex>
          </Card>

          {/* Editor */}
          {selecionado && (
            <Flex direction="column" gap="4">
              <Card variant="surface">
                <Flex direction="column" gap="4">
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">{selecionado.escopo === 'sistema' ? 'Sistema' : 'Escritório'}</Text>
                    <Heading size="4">{NOMES[selecionado.provedor]}</Heading>
                    <Text size="2" color="gray">
                      {selecionado.estado === 'ativo'
                        ? `Configuração ativa · versão ${selecionado.versao}${selecionado.testado_em ? ' · Testada em ' + new Date(selecionado.testado_em * 1000).toLocaleString('pt-BR') : ' · Não testada'}`
                        : 'Não configurado'}
                      {selecionado.provedor === 'asaas' ? ` · ${selecionado.ambiente === 'sandbox' ? 'Homologação' : 'Produção'}` : ''}
                    </Text>
                  </Flex>

                  <Flex direction="column" gap="3">
                    {(SCHEMA[selecionado.provedor] ?? []).map(([name, label, secret]) => (
                      <Flex direction="column" gap="1" key={name}>
                        <Text as="label" size="1" weight="medium" htmlFor={'campo-' + name}>{label}</Text>
                        <TextField.Root
                          id={'campo-' + name}
                          type={secret ? 'password' : 'text'}
                          autoComplete="off"
                          maxLength={8192}
                          value={campos[name] ?? ''}
                          onChange={e => { setCampos(p => ({ ...p, [name]: e.target.value })); setCandidato(null); setTeste(null) }}
                        />
                        {secret && (
                          <Text size="1" color="gray">
                            {selecionado.segredos[name] ? `Credencial atual: ${selecionado.segredos[name]}. Deixe vazio para preservar.` : 'Nenhuma credencial cadastrada.'}
                          </Text>
                        )}
                      </Flex>
                    ))}
                  </Flex>

                  {selecionado.provedor === 'google_oauth' && (
                    <Text size="1" color="gray">
                      Cadastre no Google a URL de retorno: <code>{location.origin}/integracoes/google/callback</code>
                    </Text>
                  )}

                  <Flex gap="2" wrap="wrap">
                    <Button size="2" variant="soft" onClick={testar} disabled={ocupado}>
                      {ocupado ? 'Aguarde…' : 'Testar conexão'}
                    </Button>
                    <Button size="2" onClick={ativar} disabled={!ativacaoOk || ocupado}>
                      Ativar configuração
                    </Button>
                    {['drive', 'google_oauth'].includes(selecionado.provedor) && (
                      <Button size="2" variant="soft" onClick={autorizarGoogle} disabled={ocupado}>Autorizar Google</Button>
                    )}
                    {selecionado.provedor === 'asaas' && selecionado.ambiente !== dados.asaas_ambiente && selecionado.versao && (
                      <Button size="2" variant="soft" color="orange" disabled={ocupado}
                        onClick={() => executar(async () => {
                          const prod = selecionado.ambiente === 'producao'
                          if (prod && !confirm('Usar PRODUÇÃO nas próximas cobranças Asaas?')) return
                          await api(token, '/ambiente', { ambiente: selecionado.ambiente, confirmar_producao: prod })
                          await carregar()
                          setFeedback({ tipo: 'ok', texto: 'Ambiente de cobranças atualizado.' })
                        })}>
                        Usar este ambiente nas cobranças
                      </Button>
                    )}
                    {!!selecionado.versao && (
                      <Button size="2" variant="soft" color="red" onClick={desativar} disabled={ocupado}>
                        Desativar integração
                      </Button>
                    )}
                  </Flex>

                  {feedback && (
                    <Callout.Root color={feedback.tipo === 'ok' ? 'green' : feedback.tipo === 'erro' ? 'red' : 'blue'} size="1">
                      <Callout.Icon>{feedback.tipo === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}</Callout.Icon>
                      <Callout.Text>{feedback.texto}</Callout.Text>
                    </Callout.Root>
                  )}
                </Flex>
              </Card>

              {historicoDo.length > 0 && (
                <Card variant="surface">
                  <Flex direction="column" gap="2">
                    <Heading size="3">Histórico de alterações</Heading>
                    {historicoDo.map((h, i) => (
                      <Text key={i} size="1" color="gray">
                        {new Date((h.instante as number) * 1000).toLocaleString('pt-BR')} · {h.autor} · {h.acao} · {h.resultado}
                      </Text>
                    ))}
                  </Flex>
                </Card>
              )}
            </Flex>
          )}
        </Grid>
      )}
    </Flex>
  )
}
