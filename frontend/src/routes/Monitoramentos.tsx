import CabecalhoPagina from '../CabecalhoPagina'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, CheckCircle2 } from 'lucide-react'
import { Badge, Button, Callout, Dialog, Flex, Heading, Select, Tabs, Text, TextField } from '@radix-ui/themes'
import Carregamento from '../Carregamento'
import TabelaResponsiva from '../TabelaResponsiva'
import AcoesTabela from '../AcoesTabela'
import { useCliente } from '../api/ClienteContext'
import { diasEntreDatas, formatarNumeroCNJ, hojeIso } from '../utils/formatadores'
import { useEstreita } from '../utils/useEstreita'
import './monitoramentos/monitoramentos.scss'
import { formatarData } from '../utils/listasRapidas'

type Criterio = {
  numero_processo?: string
  numero_oab?: string
  uf_oab?: string
  nome?: string
  sigla_tribunal?: string
}
type Execucao = {
  estado?: string
  ultima_tentativa?: string
  ultimo_sucesso?: string
  proxima_execucao?: string
  paginas?: number
  encontradas?: number
  erro?: string
  emails_pendentes?: number
  locais_pendentes?: number
}
type Monitoramento = {
  id: string
  criterio?: Criterio
  criado_em?: string
  expira_em?: string
  verificacao?: Execucao
  captura_oab?: Execucao
}
type Historico = { inicio: string; fim?: string; estado: string; erro?: string }
type Resposta = {
  erro?: boolean
  mensagem?: string
  monitoramentos?: Monitoramento[]
  limite?: number
  email_configurado?: boolean
  email_destinatario_configurado?: boolean
  existente?: boolean
  historico?: Record<string, Historico[]>
}

function criterio(c: Criterio = {}) {
  return [
    c.numero_processo && `Processo ${formatarNumeroCNJ(c.numero_processo)}`,
    c.numero_oab && `OAB ${c.numero_oab}/${c.uf_oab ?? 'UF não informada'}`,
    c.sigla_tribunal
  ]
    .filter(Boolean)
    .join(' · ')
}

const DIAS_AVISO_EXPIRACAO = 30
const ROTINAS: Record<string, string> = { monitoramentos: 'Verificação de publicações', captura_oab: 'Captura por OAB', movimentos: 'Atualização das capas' }
const ESTADOS_ROTINA: Record<string, string> = { concluida: 'Concluída', falha: 'Falha ou conclusão parcial', interrompida: 'Interrompida', executando: 'Em andamento' }

function diasParaExpirar(mon: Monitoramento): number | null {
  return mon.expira_em ? diasEntreDatas(hojeIso(), mon.expira_em) : null
}
/** Situação resumida da última coleta (verificação e, para OAB, captura). */
function situacaoColeta(mon: Monitoramento): { cor: 'green' | 'red' | 'blue' | 'gray'; rotulo: string; detalhe: string; quando?: string } {
  const execucoes = [mon.verificacao, mon.criterio?.numero_oab ? mon.captura_oab : undefined].filter((e): e is Execucao => Boolean(e))
  const quando = execucoes.map(e => e.ultima_tentativa).filter((q): q is string => Boolean(q)).sort().pop()
  const comErro = execucoes.find(e => e.erro)
  if (execucoes.some(e => e.estado === 'executando')) return { cor: 'blue', rotulo: 'Verificando', detalhe: 'Coleta em andamento', quando }
  if (comErro) return { cor: 'red', rotulo: 'Falhou', detalhe: comErro.erro!, quando }
  if (!quando) return { cor: 'gray', rotulo: 'Aguardando', detalhe: 'Primeira coleta no próximo ciclo' }
  const pendentes = execucoes.reduce((t, e) => t + (e.emails_pendentes ?? 0) + (e.locais_pendentes ?? 0), 0)
  const encontradas = execucoes.reduce((t, e) => t + (e.encontradas ?? 0), 0)
  return {
    cor: 'green', rotulo: 'Em dia', quando,
    detalhe: pendentes ? `${pendentes} entrega(s) pendente(s)` : encontradas ? `${encontradas} publicação(ões) na última coleta` : 'Nenhuma publicação nova',
  }
}

function EstadoExecucao({ titulo, dados }: { titulo: string; dados?: Execucao }) {
  return (
    <Flex direction="column" gap="3">
      <Heading as="h3" size="3">{titulo}</Heading>
      <Text as="p" size="2">
        Última tentativa:{' '}
        {dados?.ultima_tentativa ? formatarData(dados.ultima_tentativa) : 'Aguardando primeira execução'}.
      </Text>
      {dados?.ultimo_sucesso && (
        <Text as="p" size="2">
          Última coleta concluída: {formatarData(dados.ultimo_sucesso)} · {dados.paginas ?? 0} página(s) ·{' '}
          {dados.encontradas ?? 0} publicação(ões).
        </Text>
      )}
      {dados?.proxima_execucao && (
        <Text as="p" size="2">Próxima prevista: {formatarData(dados.proxima_execucao)}. Falhas podem adiar a execução.</Text>
      )}
      {dados?.estado === 'executando' && <Text as="p" size="2" role="status">Verificação em andamento.</Text>}
      {dados?.erro && (
        <Callout.Root color="yellow" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>{dados.erro}</Callout.Text>
        </Callout.Root>
      )}
      {Boolean(dados?.emails_pendentes || dados?.locais_pendentes) && (
        <Callout.Root color="yellow" size="1">
          <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
          <Callout.Text>
            {dados?.emails_pendentes ?? 0} publicação(ões) aguardam e-mail; {dados?.locais_pendentes ?? 0} aguardam registro no painel. As entregas serão tentadas novamente.
          </Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}

export default function Monitoramentos() {
  const { cliente } = useCliente()
  return <Painel key={cliente?.token ?? 'sem-conexao'} />
}

function Painel() {
  const { cliente } = useCliente()
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [modal, setModal] = useState<'criar' | Monitoramento | null>(null)
  const [tipo, setTipo] = useState('oab')
  const [numero, setNumero] = useState('')
  const [uf, setUf] = useState('')
  const [nome, setNome] = useState('')
  const [erroModal, setErroModal] = useState('')
  const [operacao, setOperacao] = useState(false)
  const [detalhe, setDetalhe] = useState<Monitoramento | null>(null)
  const estreita = useEstreita()
  const trava = useRef(false)
  const sequencia = useRef(0)
  const vivo = useRef(true)
  const formulario = useRef<HTMLFormElement>(null)
  const chamar = useCallback(
    async (ferramenta: string, args: Record<string, unknown>): Promise<Resposta> => {
      if (!cliente) throw new Error('Conecte-se na aba Acesso para gerenciar monitoramentos.')
      const resposta = (await cliente.chamarFerramenta(ferramenta, args)) as Resposta
      if (!resposta || resposta.erro) throw new Error(resposta?.mensagem || 'Não foi possível concluir a operação.')
      return resposta
    },
    [cliente]
  )
  const carregar = useCallback(async () => {
    const pedido = ++sequencia.current
    setCarregando(true)
    setErro('')
    try {
      const r = await chamar('listar_monitoramentos', {})
      if (vivo.current && pedido === sequencia.current) setDados(r)
    } catch (e) {
      if (vivo.current && pedido === sequencia.current) setErro((e as Error).message)
    } finally {
      if (vivo.current && pedido === sequencia.current) setCarregando(false)
    }
  }, [chamar])
  useEffect(() => {
    const controle = sequencia
    vivo.current = true
    // A consulta sincroniza o painel com o servidor ao conectar ou montar a tela.
    // eslint-disable-next-line react/set-state-in-effect
    void carregar()
    return () => {
      vivo.current = false
      controle.current++
    }
  }, [carregar])
  async function executar(acao: 'criar' | 'remover' | 'renovar', mon?: Monitoramento) {
    if (trava.current || (acao === 'criar' && !formulario.current?.reportValidity())) return
    trava.current = true
    setOperacao(true)
    setErroModal('')
    setErro('')
    setMensagem('')
    try {
      if (acao === 'criar') {
        const r = await chamar('monitorar_publicacoes', {
          ...(tipo === 'oab' ? { numero_oab: numero.trim(), uf_oab: uf } : { numero_processo: numero.trim() }),
          nome: nome.trim() || undefined
        })
        if (vivo.current)
          setMensagem(
            r.existente
              ? 'Este monitoramento já existe. Seu histórico foi preservado.'
              : 'Monitoramento criado. A primeira coleta ocorrerá no próximo ciclo.'
          )
      } else {
        await chamar(acao === 'remover' ? 'remover_monitoramento' : 'renovar_monitoramento', { id: mon!.id })
        if (vivo.current)
          setMensagem(
            acao === 'remover'
              ? 'Monitoramento removido. As publicações já capturadas foram preservadas.'
              : 'Monitoramento renovado por 180 dias, preservando seu histórico.'
          )
      }
      if (!vivo.current) return
      setModal(null)
      await carregar()
    } catch (e) {
      if (vivo.current) {
        if (acao === 'renovar') setErro((e as Error).message)
        else setErroModal((e as Error).message)
      }
    } finally {
      trava.current = false
      if (vivo.current) setOperacao(false)
    }
  }
  const lista = dados?.monitoramentos ?? []
  const bloqueado = operacao || carregando
  const expirando = lista.filter(m => { const d = diasParaExpirar(m); return d !== null && d < DIAS_AVISO_EXPIRACAO })

  function criterioCelula(mon: Monitoramento) {
    const c = mon.criterio ?? {}
    const oab = Boolean(c.numero_oab)
    return (
      <>
        <Badge color={oab ? 'violet' : 'blue'} variant="soft">{oab ? 'OAB' : 'Processo'}</Badge>
        <div className="mon-criterio">{oab ? `OAB ${c.numero_oab}/${c.uf_oab ?? '—'}` : formatarNumeroCNJ(c.numero_processo ?? '')}</div>
        <div className="mon-secundario">{oab ? 'Captura diária no DJEN' : (c.sigla_tribunal ?? '').toUpperCase() || 'Verificação a cada 6 horas'}</div>
      </>
    )
  }
  function coletaCelula(mon: Monitoramento) {
    const s = situacaoColeta(mon)
    return (
      <>
        <Badge color={s.cor} variant="soft" radius="full">{s.rotulo}</Badge>
        {s.quando && <div className="mon-secundario">{formatarData(s.quando)}</div>}
        <div className={s.cor === 'red' ? 'mon-secundario mon-erro' : 'mon-secundario'}>{s.detalhe}</div>
      </>
    )
  }
  function expiraCelula(mon: Monitoramento) {
    const dias = diasParaExpirar(mon)
    const alerta = dias !== null && dias < DIAS_AVISO_EXPIRACAO
    return (
      <>
        <div className="mon-data">{mon.expira_em ? formatarData(mon.expira_em).slice(0, 10) : '—'}</div>
        {dias !== null && (
          <div className={alerta ? 'mon-secundario mon-alerta' : 'mon-secundario'}>
            {dias < 0 ? 'expirado' : dias === 0 ? 'expira hoje' : `faltam ${dias} dia${dias > 1 ? 's' : ''}`}
          </div>
        )}
      </>
    )
  }
  function acoes(mon: Monitoramento, grande = false) {
    const dias = diasParaExpirar(mon)
    const perto = dias !== null && dias < DIAS_AVISO_EXPIRACAO
    return (
      <Flex gap="1" justify="end" align="center" style={grande ? { width: '100%' } : undefined}>
        <Button size={grande ? '3' : '1'} variant={perto ? 'solid' : 'soft'} color={perto ? undefined : 'gray'} style={grande ? { flex: 1 } : undefined}
          disabled={bloqueado} onClick={() => executar('renovar', mon)}>Renovar</Button>
        <AcoesTabela rotulo={criterio(mon.criterio)} acoes={[
          { texto: 'Ver detalhes da coleta', executar: () => setDetalhe(mon) },
          { texto: 'Remover', perigo: true, desabilitada: bloqueado, executar: () => { setErroModal(''); setModal(mon) } },
        ]} />
      </Flex>
    )
  }

  return (
    <>
      <Flex direction="column" gap="5">
        <CabecalhoPagina
          titulo="Monitoramentos"
          descricao={<>Acompanhe publicações de processos ou OAB. Você usa {lista.length} de {dados?.limite ?? 5} monitoramentos.</>}
          acoes={<>
            <Button variant="soft" color="gray" size="2" disabled={bloqueado} onClick={carregar}>Atualizar</Button>
            <Button
              size="2"
              disabled={!cliente || bloqueado || lista.length >= (dados?.limite ?? 5)}
              onClick={() => { setNumero(''); setUf(''); setNome(''); setErroModal(''); setTipo('oab'); setModal('criar') }}
            >
              Criar monitoramento
            </Button>
          </>}
        />

        <Tabs.Root defaultValue="ativos">
          <Tabs.List aria-label="Monitoramentos">
            <Tabs.Trigger value="ativos">Ativos <Text size="1" color="gray" ml="1">{lista.length}</Text></Tabs.Trigger>
            <Tabs.Trigger value="historico">Histórico das rotinas automáticas</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="ativos">
            <Flex direction="column" gap="4" pt="4">
              {expirando.length > 0 && (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                  <Callout.Text>
                    <strong>{expirando.length === 1 ? '1 monitoramento expira' : `${expirando.length} monitoramentos expiram`} em menos de {DIAS_AVISO_EXPIRACAO} dias.</strong>{' '}
                    Renove para continuar recebendo os avisos.
                  </Callout.Text>
                </Callout.Root>
              )}
              {(dados?.email_configurado === false || dados?.email_destinatario_configurado === false) && (
                <Callout.Root color="yellow" size="1">
                  <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                  <Callout.Text>
                    {dados?.email_destinatario_configurado === false
                      ? 'E-mail do perfil não informado. Você pode criar monitoramentos e as publicações serão coletadas. Peça a um administrador para completar o e-mail do seu perfil; os envios pendentes serão retomados após a atualização.'
                      : 'Envio de e-mail indisponível. A coleta continua. Os e-mails ficarão pendentes até a configuração do servidor ser restabelecida.'}
                  </Callout.Text>
                </Callout.Root>
              )}
              <div aria-live="polite">
                {erro && (
                  <Callout.Root color="red" size="1">
                    <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                    <Callout.Text>Não foi possível concluir: {erro}</Callout.Text>
                  </Callout.Root>
                )}
                {mensagem && (
                  <Callout.Root color="green" size="1">
                    <Callout.Icon><CheckCircle2 size={14} /></Callout.Icon>
                    <Callout.Text>{mensagem}</Callout.Text>
                  </Callout.Root>
                )}
                {carregando && <Carregamento tipo="tabela" descricao="Carregando monitoramentos…" />}
                {!carregando && dados && !lista.length && (
                  <Callout.Root color="blue" size="1">
                    <Callout.Icon><Info size={14} /></Callout.Icon>
                    <Callout.Text>Nenhum monitoramento ativo. Use Criar monitoramento para acompanhar uma OAB ou um processo.</Callout.Text>
                  </Callout.Root>
                )}
              </div>

              {!carregando && lista.length > 0 && (estreita ? (
                <ul className="mon-cartoes">
                  {lista.map(mon => (
                    <li key={mon.id} className="mon-cartao">
                      <div>{criterioCelula(mon)}</div>
                      {mon.criterio?.nome && <Text as="p" size="2">{mon.criterio.nome}</Text>}
                      <div className="mon-cartao-resumo">
                        <div><div className="mon-rotulo">Última verificação</div>{coletaCelula(mon)}</div>
                        <div><div className="mon-rotulo">Expira em</div>{expiraCelula(mon)}</div>
                      </div>
                      {acoes(mon, true)}
                    </li>
                  ))}
                </ul>
              ) : (
                <TabelaResponsiva principais={['Critério']}>
                  <table aria-label="Monitoramentos ativos" className="mon-tabela">
                    <thead>
                      <tr>
                        <th className="mon-col-criterio">Critério</th>
                        <th>Nome</th>
                        <th className="mon-col-coleta">Última verificação</th>
                        <th className="mon-col-expira">Expira em</th>
                        <th className="tabela-acoes mon-col-acoes">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map(mon => (
                        <tr key={mon.id}>
                          <td>{criterioCelula(mon)}</td>
                          <td>{mon.criterio?.nome || <Text color="gray">—</Text>}</td>
                          <td>{coletaCelula(mon)}</td>
                          <td>{expiraCelula(mon)}</td>
                          <td className="tabela-acoes">{acoes(mon)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabelaResponsiva>
              ))}
              <Text as="p" size="2" color="gray">
                As publicações são verificadas a cada 6 horas; a captura por OAB ocorre a cada 24 horas. Atualizar esta lista não dispara uma consulta ao DJEN.
                Novas publicações permanecem não tratadas até a revisão.
              </Text>
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="historico">
            <Flex direction="column" gap="5" pt="4">
              {!dados?.historico && <Text as="p" size="2" color="gray">{carregando ? 'Carregando…' : 'Histórico indisponível.'}</Text>}
              {dados?.historico && Object.entries(dados.historico).map(([rotina, execucoes]) => (
                <section key={rotina} aria-label={ROTINAS[rotina] || rotina}>
                  <Heading as="h2" size="3" mb="2">{ROTINAS[rotina] || rotina}</Heading>
                  {!execucoes.length ? <Text as="p" size="2" color="gray">Aguardando primeira execução.</Text> : (
                    <ol className="mon-historico">
                      {execucoes.map(e => (
                        <li key={e.inicio}>
                          <span className="mon-data">{formatarData(e.inicio)}</span>
                          <Badge color={e.estado === 'concluida' ? 'green' : e.estado === 'executando' ? 'blue' : 'red'} variant="soft" radius="full">
                            {ESTADOS_ROTINA[e.estado] || e.estado}
                          </Badge>
                          {e.erro && <Text size="2" color="gray">{e.erro}</Text>}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
            </Flex>
          </Tabs.Content>
        </Tabs.Root>
      </Flex>

      <Dialog.Root open={detalhe !== null} onOpenChange={(open) => { if (!open) setDetalhe(null) }}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>{detalhe ? criterio(detalhe.criterio) : ''}</Dialog.Title>
          {detalhe && (
            <Flex direction="column" gap="5">
              {detalhe.criterio?.nome && <Text as="p" size="2">{detalhe.criterio.nome}</Text>}
              <Text as="p" size="2" color="gray">
                Criado em {formatarData(detalhe.criado_em)}. Expira em {formatarData(detalhe.expira_em)} se não houver publicação nova.
              </Text>
              <EstadoExecucao titulo="Verificação de publicações" dados={detalhe.verificacao} />
              {detalhe.criterio?.numero_oab && <EstadoExecucao titulo="Captura por OAB" dados={detalhe.captura_oab} />}
              <Flex justify="end"><Dialog.Close><Button variant="soft" color="gray">Fechar</Button></Dialog.Close></Flex>
            </Flex>
          )}
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={modal === 'criar'} onOpenChange={(open) => { if (!open && !operacao) setModal(null) }}>
        <Dialog.Content maxWidth="480px">
          <Dialog.Title>Criar monitoramento</Dialog.Title>
          <form
            ref={formulario}
            onSubmit={(e) => {
              e.preventDefault()
              void executar('criar')
            }}
          >
            <Flex direction="column" gap="5">
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="monitoramento-tipo">Acompanhar</label>
                <Select.Root
                  value={tipo}
                  disabled={operacao}
                  onValueChange={(v) => {
                    setTipo(v)
                    setNumero('')
                  }}
                >
                  <Select.Trigger id="monitoramento-tipo" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="oab">Publicações por OAB</Select.Item>
                    <Select.Item value="processo">Publicações de um processo</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="monitoramento-numero">{tipo === 'oab' ? 'Número da OAB' : 'Número CNJ do processo'}</label>
                <TextField.Root
                  id="monitoramento-numero"
                  data-modal-primary-focus
                  value={numero}
                  required
                  disabled={operacao}
                  maxLength={tipo === 'oab' ? 6 : 25}
                  pattern={tipo === 'oab' ? '[0-9]{1,6}' : '[0-9.\\-]{20,25}'}
                  onChange={(e) => setNumero(e.target.value)}
                />
                <Text size="1" color="gray">{tipo === 'oab' ? 'Informe apenas os dígitos.' : 'Informe os 20 dígitos, com ou sem máscara.'}</Text>
              </div>
              {tipo === 'oab' && (
                <div className="form-campo">
                  <label className="form-campo-label" htmlFor="monitoramento-uf">UF da OAB</label>
                  <Select.Root value={uf || '__none__'} disabled={operacao} onValueChange={(v) => setUf(v === '__none__' ? '' : v)}>
                    <Select.Trigger id="monitoramento-uf" style={{ width: '100%' }} />
                    <Select.Content>
                      <Select.Item value="__none__">Selecione a UF</Select.Item>
                      {'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'
                        .split(' ')
                        .map((u) => (
                          <Select.Item key={u} value={u}>{u}</Select.Item>
                        ))}
                    </Select.Content>
                  </Select.Root>
                </div>
              )}
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="monitoramento-nome">Nome para identificação (opcional)</label>
                <TextField.Root
                  id="monitoramento-nome"
                  value={nome}
                  disabled={operacao}
                  maxLength={120}
                  onChange={(e) => setNome(e.target.value)}
                />
                <Text size="1" color="gray">Identifica o monitoramento; não filtra a consulta.</Text>
              </div>
              <Text as="p" size="2" color="gray">
                Validade de 180 dias, renovada ao encontrar publicações novas. O envio de e-mail depende da configuração
                do servidor.
              </Text>
              {erroModal && (
                <Callout.Root color="red" size="1">
                  <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                  <Callout.Text>Não foi possível criar: {erroModal}</Callout.Text>
                </Callout.Root>
              )}
              <Flex gap="3" justify="end">
                <Button type="button" variant="soft" color="gray" disabled={operacao} onClick={() => setModal(null)}>Cancelar</Button>
                <Button type="submit" disabled={operacao}>{operacao ? 'Criando…' : 'Criar monitoramento'}</Button>
              </Flex>
            </Flex>
          </form>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={modal !== null && modal !== 'criar'} onOpenChange={(open) => { if (!open && !operacao) setModal(null) }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Remover monitoramento</Dialog.Title>
          <Flex direction="column" gap="5">
            <Text as="p" size="2">
              Seu acompanhamento de {modal && modal !== 'criar' ? criterio(modal.criterio) : ''} será encerrado. As
              publicações já capturadas e a atualização diária das capas serão preservadas.
            </Text>
            {erroModal && (
              <Callout.Root color="red" size="1">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>Não foi possível remover: {erroModal}</Callout.Text>
              </Callout.Root>
            )}
            <Flex gap="3" justify="end">
              <Button variant="soft" color="gray" disabled={operacao} onClick={() => setModal(null)}>Cancelar</Button>
              <Button
                color="red"
                disabled={operacao}
                onClick={() => {
                  if (modal && modal !== 'criar') void executar('remover', modal)
                }}
              >
                {operacao ? 'Removendo…' : 'Remover'}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
