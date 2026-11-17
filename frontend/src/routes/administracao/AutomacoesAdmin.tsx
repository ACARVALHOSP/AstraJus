import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Card, Flex, Heading, Switch, Text, TextField } from '@radix-ui/themes'
import Carregamento from '../../Carregamento'
import { buscarJson, enviarJson } from '../../api/rest'
import {
  descreverAlteracao, lerParametro, quandoBrasilia, seloRotina, textoDoValor,
  type AlteracaoAuto, type RotinaAuto, type ValorParametro,
} from './automacoes'

type Dados = { rotinas: RotinaAuto[]; historico: AlteracaoAuto[] }

const URL = '/admin/automacoes/api'
const SEM_CACHE = { cache: 'no-store' as const }

/** Rotinas automáticas do servidor: liga/desliga, parâmetros e o que mudou. Quem altera aparece no histórico. */
export default function AutomacoesAdmin({ token }: { token: string }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [falha, setFalha] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [retorno, setRetorno] = useState<{ texto: string; tom: 'green' | 'red' } | null>(null)
  const [confirmarDesligar, setConfirmarDesligar] = useState<RotinaAuto | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setDados(await buscarJson<Dados>({ token }, URL, undefined, SEM_CACHE)); setFalha('')
    } catch (e) { setFalha((e as Error).message) } finally { setCarregando(false) }
  }, [token])
  useEffect(() => { void carregar() }, [carregar])

  async function salvar(r: RotinaAuto, corpo: { ativo?: boolean; parametros?: Record<string, ValorParametro> }, mensagem: string) {
    if (ocupado) return
    setOcupado(true)
    try {
      await enviarJson({ token }, `${URL}/${encodeURIComponent(r.chave)}`, corpo, 'PUT', undefined, SEM_CACHE)
      await carregar()
      setRetorno({ texto: mensagem, tom: 'green' })
    } catch (e) { setRetorno({ texto: (e as Error).message, tom: 'red' }) } finally { setOcupado(false) }
  }

  function salvarParametro(r: RotinaAuto, nome: string) {
    const def = r.parametros_definidos[nome]
    const texto = rascunhos[`${r.chave}.${nome}`] ?? textoDoValor(r.parametros[nome])
    const lido = lerParametro(def, texto)
    if (lido.valor === null) { setRetorno({ texto: lido.erro, tom: 'red' }); return }
    void salvar(r, { parametros: { [nome]: lido.valor } }, `${def.rotulo} atualizado.`)
    setRascunhos(v => { const { [`${r.chave}.${nome}`]: _descartado, ...resto } = v; return resto })
  }

  if (carregando && !dados) return <Carregamento tipo="cartoes" descricao="Carregando automações…" />
  if (!dados) {
    return (
      <Callout.Root color="red" role="alert" mt="4">
        <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
        <Callout.Text>{falha || 'Não foi possível carregar as automações.'} <Button variant="ghost" size="1" onClick={() => void carregar()}>Tentar de novo</Button></Callout.Text>
      </Callout.Root>
    )
  }
  const nomes = Object.fromEntries(dados.rotinas.map(r => [r.chave, r.nome]))

  return (
    <Flex direction="column" gap="4" mt="4">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <div>
          <Heading as="h2" size="4">Automações</Heading>
          <Text as="p" size="2" color="gray">O que o sistema faz sozinho, em segundo plano. Rotina desligada não roda; religar retoma na próxima verificação.</Text>
        </div>
        <Button variant="soft" size="2" disabled={ocupado || carregando} onClick={() => void carregar()}>Atualizar</Button>
      </Flex>

      {retorno && (
        <Callout.Root color={retorno.tom} role={retorno.tom === 'red' ? 'alert' : 'status'} size="1">
          <Callout.Text>{retorno.texto}</Callout.Text>
        </Callout.Root>
      )}

      <Flex direction="column" gap="3" role="list" aria-label="Rotinas automáticas">
        {dados.rotinas.map(r => {
          const selo = seloRotina(r)
          const parametros = Object.entries(r.parametros_definidos)
          return (
            <Card key={r.chave} variant="surface" role="listitem">
              <Flex direction="column" gap="2">
                <Flex justify="between" align="center" gap="3" wrap="wrap">
                  <Flex align="center" gap="2" wrap="wrap">
                    <Heading as="h3" size="3">{r.nome}</Heading>
                    <Badge color={selo.cor} variant="soft">{selo.texto}</Badge>
                  </Flex>
                  <Text as="label" size="2">
                    <Flex align="center" gap="2">
                      <Switch checked={r.ativo} disabled={ocupado} aria-label={`${r.ativo ? 'Desligar' : 'Ligar'} ${r.nome}`}
                        onCheckedChange={marcado => { if (marcado) void salvar(r, { ativo: true }, `"${r.nome}" ligada.`); else setConfirmarDesligar(r) }} />
                      {r.ativo ? 'Ligada' : 'Desligada'}
                    </Flex>
                  </Text>
                </Flex>
                <Text as="p" size="2" color="gray">{r.descricao}</Text>
                <Text as="p" size="1" color="gray">
                  Última execução: {r.ultima_execucao ? quandoBrasilia(r.ultima_execucao.inicio) : 'nenhuma ainda'}
                </Text>
                {r.ultima_execucao?.erro && <Text as="p" size="1" color="red">{r.ultima_execucao.erro}</Text>}
                {parametros.map(([nome, def]) => {
                  const id = `auto-${r.chave}-${nome}`
                  return (
                    <Flex key={nome} align="end" gap="2" wrap="wrap">
                      <div className="form-campo" style={{ minWidth: def.tipo === 'int' ? undefined : 300 }}>
                        <label className="form-campo-label" htmlFor={id}>{def.rotulo}</label>
                        <TextField.Root id={id} inputMode={def.tipo === 'int' ? 'numeric' : 'text'} size="2" style={{ width: def.tipo === 'int' ? 120 : 200 }} disabled={ocupado}
                          value={rascunhos[`${r.chave}.${nome}`] ?? textoDoValor(r.parametros[nome])}
                          onChange={e => setRascunhos(v => ({ ...v, [`${r.chave}.${nome}`]: e.target.value }))} />
                      </div>
                      <Button size="2" variant="soft" disabled={ocupado} onClick={() => salvarParametro(r, nome)}>Salvar</Button>
                      <Text size="1" color="gray">
                        {def.tipo === 'int'
                          ? `Entre ${def.minimo} e ${def.maximo}.`
                          : `De ${def.min_itens} a ${def.max_itens} valores, de ${def.minimo} a ${def.maximo}, separados por vírgula.`}
                      </Text>
                    </Flex>
                  )
                })}
              </Flex>
            </Card>
          )
        })}
      </Flex>

      <section aria-label="Alterações recentes">
        <Heading as="h3" size="3" mb="2">Alterações recentes</Heading>
        {dados.historico.length === 0
          ? <Text as="p" size="2" color="gray">Nenhuma alteração até agora: todas as rotinas estão como vieram de fábrica.</Text>
          : <Flex direction="column" gap="1" asChild><ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {dados.historico.map((a, i) => (
                <li key={`${a.ocorrido_em}-${i}`}><Text size="2">{quandoBrasilia(a.ocorrido_em)} · {descreverAlteracao(a, nomes)}</Text></li>
              ))}
            </ul></Flex>}
      </section>

      <AlertDialog.Root open={confirmarDesligar !== null} onOpenChange={aberto => { if (!aberto && !ocupado) setConfirmarDesligar(null) }}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Desligar "{confirmarDesligar?.nome}"?</AlertDialog.Title>
          <AlertDialog.Description>
            Enquanto estiver desligada, o sistema não faz mais esta verificação e ninguém é avisado por ela. Você pode religar quando quiser.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
            <Button color="red" disabled={ocupado} onClick={() => {
              const r = confirmarDesligar
              setConfirmarDesligar(null)
              if (r) void salvar(r, { ativo: false }, `"${r.nome}" desligada.`)
            }}>Desligar</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
