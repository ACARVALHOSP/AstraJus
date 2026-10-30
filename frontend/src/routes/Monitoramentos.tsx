import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Column,
  Grid,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Stack,
  TextInput,
  Tile
} from '@carbon/react'
import Carregamento from '../Carregamento'
import { useCliente } from '../api/ClienteContext'
import { formatarNumeroCNJ } from '../utils/formatadores'
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

function EstadoExecucao({ titulo, dados }: { titulo: string; dados?: Execucao }) {
  return (
    <Stack gap={3}>
      <h3>{titulo}</h3>
      <p>
        Última tentativa:{' '}
        {dados?.ultima_tentativa ? formatarData(dados.ultima_tentativa) : 'Aguardando primeira execução'}.
      </p>
      {dados?.ultimo_sucesso && (
        <p>
          Última coleta concluída: {formatarData(dados.ultimo_sucesso)} · {dados.paginas ?? 0} página(s) ·{' '}
          {dados.encontradas ?? 0} publicação(ões).
        </p>
      )}
      {dados?.proxima_execucao && (
        <p>Próxima prevista: {formatarData(dados.proxima_execucao)}. Falhas podem adiar a execução.</p>
      )}
      {dados?.estado === 'executando' && <p role="status">Verificação em andamento.</p>}
      {dados?.erro && (
        <InlineNotification
          kind="warning"
          title="Coleta incompleta"
          subtitle={dados.erro}
          lowContrast
          hideCloseButton
        />
      )}
      {Boolean(dados?.emails_pendentes || dados?.locais_pendentes) && (
        <InlineNotification
          kind="warning"
          title="Entregas pendentes"
          subtitle={`${dados?.emails_pendentes ?? 0} publicação(ões) aguardam e-mail; ${dados?.locais_pendentes ?? 0} aguardam registro no painel. As entregas serão tentadas novamente.`}
          lowContrast
          hideCloseButton
        />
      )}
    </Stack>
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
  return (
    <>
      <Stack gap={6}>
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
            <Stack gap={5}>
              <h1>Monitoramentos</h1>
              <p>
                Acompanhe publicações de processos ou OAB. Você tem {lista.length} de {dados?.limite ?? 5}{' '}
                monitoramentos.
              </p>
              <div>
                <Button
                  kind="primary"
                  size="md"
                  disabled={!cliente || bloqueado || lista.length >= (dados?.limite ?? 5)}
                  onClick={() => {
                    setNumero('')
                    setUf('')
                    setNome('')
                    setErroModal('')
                    setTipo('oab')
                    setModal('criar')
                  }}
                >
                  Criar monitoramento
                </Button>
                <Button kind="ghost" size="md" disabled={bloqueado} onClick={carregar}>
                  Atualizar lista
                </Button>
              </div>
              <p>Atualizar esta lista não dispara uma consulta ao DJEN.</p>
            </Stack>
          </Column>
        </Grid>
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
            <Stack gap={4}>
              <InlineNotification
                kind="info"
                title="Como funciona"
                subtitle="As publicações são verificadas a cada 6 horas; a captura por OAB também ocorre a cada 24 horas. A atualização diária da capa é independente dos avisos por e-mail. Novas publicações permanecem não tratadas até a revisão."
                lowContrast
                hideCloseButton
              />
              {dados?.email_configurado === false && (
                <InlineNotification
                  kind="warning"
                  title="Envio de e-mail indisponível"
                  subtitle="A coleta continua. Os e-mails ficarão pendentes até a configuração do servidor ser restabelecida."
                  lowContrast
                  hideCloseButton
                />
              )}
              {erro && (
                <InlineNotification
                  kind="error"
                  title="Não foi possível concluir"
                  subtitle={erro}
                  lowContrast
                  hideCloseButton
                />
              )}
              {mensagem && (
                <InlineNotification
                  kind="success"
                  title="Operação concluída"
                  subtitle={mensagem}
                  lowContrast
                  hideCloseButton
                />
              )}
              {carregando && <Carregamento tipo="cartoes" descricao="Carregando monitoramentos…" />}
              {!carregando && dados && !lista.length && (
                <InlineNotification
                  kind="info"
                  title="Nenhum monitoramento ativo"
                  subtitle="Use Criar monitoramento para acompanhar uma OAB ou um processo."
                  lowContrast
                  hideCloseButton
                />
              )}
            </Stack>
          </Column>
        </Grid>
        {lista.map((mon) => (
          <Grid fullWidth key={mon.id}>
            <Column sm={4} md={8} lg={16}>
              <Tile>
                <Stack gap={5}>
                  <h2>{criterio(mon.criterio)}</h2>
                  {mon.criterio?.nome && <p>{mon.criterio.nome}</p>}
                  <p>
                    Criado em {formatarData(mon.criado_em)}. Expira em {formatarData(mon.expira_em)} se não houver
                    publicação nova.
                  </p>
                  <EstadoExecucao titulo="Verificação de publicações" dados={mon.verificacao} />
                  {mon.criterio?.numero_oab && <EstadoExecucao titulo="Captura por OAB" dados={mon.captura_oab} />}
                  <div>
                    <Button kind="tertiary" size="sm" disabled={bloqueado} onClick={() => executar('renovar', mon)}>
                      Renovar por 180 dias
                    </Button>
                    <Button
                      kind="danger--ghost"
                      size="sm"
                      disabled={bloqueado}
                      onClick={() => {
                        setErroModal('')
                        setModal(mon)
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                </Stack>
              </Tile>
            </Column>
          </Grid>
        ))}
        {dados?.historico && (
          <Grid fullWidth>
            <Column sm={4} md={8} lg={16}>
              <details>
                <summary>Histórico das rotinas automáticas</summary>
                <Stack gap={5}>
                  {Object.entries(dados.historico).map(([rotina, execucoes]) => (
                    <section key={rotina} aria-label={rotina}>
                      <Stack gap={3}>
                        <h2>
                          {(
                            {
                              monitoramentos: 'Verificação de publicações',
                              captura_oab: 'Captura por OAB',
                              movimentos: 'Atualização das capas'
                            } as Record<string, string>
                          )[rotina] || rotina}
                        </h2>
                        {!execucoes.length && <p>Aguardando primeira execução.</p>}
                        {execucoes.map((e) => (
                          <p key={e.inicio}>
                            {formatarData(e.inicio)} ·{' '}
                            {(
                              {
                                concluida: 'Concluída',
                                falha: 'Falha ou conclusão parcial',
                                interrompida: 'Interrompida',
                                executando: 'Em andamento'
                              } as Record<string, string>
                            )[e.estado] || e.estado}
                            {e.erro ? ` · ${e.erro}` : ''}
                          </p>
                        ))}
                      </Stack>
                    </section>
                  ))}
                </Stack>
              </details>
            </Column>
          </Grid>
        )}
      </Stack>
      <Modal
        open={modal === 'criar'}
        modalHeading="Criar monitoramento"
        closeButtonLabel="Fechar"
        primaryButtonText={operacao ? 'Criando…' : 'Criar monitoramento'}
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={operacao}
        onRequestClose={() => {
          if (!operacao) setModal(null)
        }}
        onRequestSubmit={() => executar('criar')}
      >
        <form
          ref={formulario}
          onSubmit={(e) => {
            e.preventDefault()
            void executar('criar')
          }}
        >
          <Stack gap={5}>
            <Select
              id="monitoramento-tipo"
              labelText="Acompanhar"
              value={tipo}
              disabled={operacao}
              onChange={(e) => {
                setTipo(e.target.value)
                setNumero('')
              }}
            >
              <SelectItem value="oab" text="Publicações por OAB" />
              <SelectItem value="processo" text="Publicações de um processo" />
            </Select>
            <TextInput
              id="monitoramento-numero"
              data-modal-primary-focus
              labelText={tipo === 'oab' ? 'Número da OAB' : 'Número CNJ do processo'}
              value={numero}
              required
              disabled={operacao}
              maxLength={tipo === 'oab' ? 6 : 25}
              pattern={tipo === 'oab' ? '[0-9]{1,6}' : '[0-9.\\-]{20,25}'}
              helperText={tipo === 'oab' ? 'Informe apenas os dígitos.' : 'Informe os 20 dígitos, com ou sem máscara.'}
              onChange={(e) => setNumero(e.target.value)}
            />
            {tipo === 'oab' && (
              <Select
                id="monitoramento-uf"
                labelText="UF da OAB"
                value={uf}
                required
                disabled={operacao}
                onChange={(e) => setUf(e.target.value)}
              >
                <SelectItem value="" text="Selecione a UF" />
                {'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'
                  .split(' ')
                  .map((u) => (
                    <SelectItem key={u} value={u} text={u} />
                  ))}
              </Select>
            )}
            <TextInput
              id="monitoramento-nome"
              labelText="Nome para identificação (opcional)"
              value={nome}
              disabled={operacao}
              maxLength={120}
              helperText="Identifica o monitoramento; não filtra a consulta."
              onChange={(e) => setNome(e.target.value)}
            />
            <p>
              Validade de 180 dias, renovada ao encontrar publicações novas. O envio de e-mail depende da configuração
              do servidor.
            </p>
            {erroModal && (
              <InlineNotification
                kind="error"
                title="Não foi possível criar"
                subtitle={erroModal}
                lowContrast
                hideCloseButton
              />
            )}
          </Stack>
        </form>
      </Modal>
      <Modal
        open={modal !== null && modal !== 'criar'}
        danger
        modalHeading="Remover monitoramento"
        closeButtonLabel="Fechar"
        primaryButtonText={operacao ? 'Removendo…' : 'Remover'}
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={operacao}
        onRequestClose={() => {
          if (!operacao) setModal(null)
        }}
        onRequestSubmit={() => {
          if (modal && modal !== 'criar') void executar('remover', modal)
        }}
      >
        <Stack gap={5}>
          <p>
            Seu acompanhamento de {modal && modal !== 'criar' ? criterio(modal.criterio) : ''} será encerrado. As
            publicações já capturadas e a atualização diária das capas serão preservadas.
          </p>
          {erroModal && (
            <InlineNotification
              kind="error"
              title="Não foi possível remover"
              subtitle={erroModal}
              lowContrast
              hideCloseButton
            />
          )}
        </Stack>
      </Modal>
    </>
  )
}
