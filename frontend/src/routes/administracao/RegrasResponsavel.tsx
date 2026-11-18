import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { AlertDialog, Badge, Button, Callout, Flex, Select, Switch, Text, TextField } from '@radix-ui/themes'
import { useClientes, useNomePessoa, useResponsaveis } from '../../api/consultas'
import { buscarJson, enviarJson } from '../../api/rest'
import {
  erroDasRegras, LIMITE_REGRAS, moverRegra, resumoRegra, temPessoa, temValor, tipoDe, TIPOS,
  type Regra, type TipoRegra,
} from './regrasResponsavel'

type Estado = { regras: Regra[]; ativa: boolean; sem_responsavel: number }
type Simulacao = { itens: { caso_id: string; titulo: string; responsavel: string | null; motivo: string | null }[]; total: number }

const BASE = '/admin/automacoes/responsavel'
const SEM_CACHE = { cache: 'no-store' as const }

/** Editor das regras de distribuição: ordem de cima para baixo, a primeira que casa vence. Aparece dentro da rotina "Responsável por regras". */
export default function RegrasResponsavel({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [regras, setRegras] = useState<Regra[]>([])
  const [sujo, setSujo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [retorno, setRetorno] = useState<{ texto: string; tom: 'green' | 'red' } | null>(null)
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const pessoas = useResponsaveis().data ?? []
  const clientes = useClientes<{ id: string; nome: string }>().data ?? []
  const nomePessoa = useNomePessoa()
  const nomeCliente = (id: string) => clientes.find(c => c.id === id)?.nome ?? id

  const carregar = useCallback(async () => {
    try {
      const dados = await buscarJson<Estado>({ token }, `${BASE}/regras`, undefined, SEM_CACHE)
      setEstado(dados); setRegras(dados.regras); setSujo(false)
    } catch (e) { setRetorno({ texto: (e as Error).message, tom: 'red' }) }
  }, [token])
  useEffect(() => { void carregar() }, [carregar])

  const mudar = (nova: Regra[]) => { setRegras(nova); setSujo(true); setSimulacao(null) }
  const editar = (i: number, parte: Partial<Regra>) => mudar(regras.map((r, j) => (j === i ? { ...r, ...parte } : r)))
  function adicionar() {
    const nova: Regra = { tipo: 'classe', valor: '', responsavel: '', ativo: true }
    const fim = regras.length && regras[regras.length - 1].tipo === 'padrao' ? regras.length - 1 : regras.length
    mudar([...regras.slice(0, fim), nova, ...regras.slice(fim)])
  }
  function trocarTipo(i: number, tipo: TipoRegra) {
    const resto = regras.filter((_, j) => j !== i)
    if (tipo === 'padrao' && resto.some(r => r.tipo === 'padrao')) { setRetorno({ texto: 'Só pode haver um padrão do escritório.', tom: 'red' }); return }
    const alterada = { ...regras[i], tipo, valor: '', ...(temPessoa(tipo) ? {} : { responsavel: '' }) }
    const lista = regras.map((r, j) => (j === i ? alterada : r))
    // O padrão sempre fecha a lista.
    mudar([...lista.filter(r => r.tipo !== 'padrao'), ...lista.filter(r => r.tipo === 'padrao')])
  }

  async function executar<T>(acao: () => Promise<T>, aoTerminar: (r: T) => string) {
    if (ocupado) return
    setOcupado(true)
    try { setRetorno({ texto: aoTerminar(await acao()), tom: 'green' }) }
    catch (e) { setRetorno({ texto: (e as Error).message, tom: 'red' }) }
    finally { setOcupado(false) }
  }

  function salvar() {
    const erro = erroDasRegras(regras, pessoas)
    if (erro) { setRetorno({ texto: erro, tom: 'red' }); return }
    void executar(async () => {
      const corpo = regras.map(({ id, tipo, valor, responsavel, ativo }) => ({ id, tipo, valor, responsavel, ativo }))
      const dados = await enviarJson<Estado>({ token }, `${BASE}/regras`, { regras: corpo }, 'PUT', undefined, SEM_CACHE)
      setEstado(dados); setRegras(dados.regras); setSujo(false); setSimulacao(null)
    }, () => 'Regras salvas.')
  }
  const simular = () => executar(async () => { setSimulacao(await enviarJson<Simulacao>({ token }, `${BASE}/simular`, {}, 'POST', undefined, SEM_CACHE)) }, () => 'Simulação pronta: nada foi alterado.')
  function aplicar() {
    setConfirmar(false)
    void executar(async () => {
      const r = await enviarJson<{ aplicados: number; sem_regra: number }>({ token }, `${BASE}/aplicar`, {}, 'POST', undefined, SEM_CACHE)
      await carregar(); setSimulacao(null)
      return r
    }, r => `${r.aplicados} processo(s) receberam responsável${r.sem_regra ? `; ${r.sem_regra} não casaram com nenhuma regra` : ''}.`)
  }

  if (!estado) return retorno ? <Text size="2" color="red">{retorno.texto}</Text> : <Text size="2" color="gray">Carregando regras…</Text>
  const comRegra = simulacao?.itens.filter(i => i.responsavel) ?? []

  return (
    <Flex direction="column" gap="3" mt="2" aria-label="Regras de distribuição">
      <Text size="2" color="gray">Da primeira à última: vale a primeira regra que casar. Quem já tem responsável nunca é trocado.</Text>
      {retorno && <Callout.Root color={retorno.tom} role={retorno.tom === 'red' ? 'alert' : 'status'} size="1"><Callout.Text>{retorno.texto}</Callout.Text></Callout.Root>}
      <Flex direction="column" gap="2" asChild><ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {regras.map((r, i) => {
          const def = tipoDe(r.tipo)
          const opcoes = [...new Set([...pessoas, r.responsavel].filter(Boolean))]
          return (
            <li key={r.id ?? `novo-${i}`}>
              <Flex gap="2" align="end" wrap="wrap">
                <Text size="2" color="gray" style={{ width: 20 }}>{i + 1}.</Text>
                <div className="form-campo">
                  <label className="form-campo-label" htmlFor={`regra-tipo-${i}`}>Quando</label>
                  <Select.Root value={r.tipo} onValueChange={v => trocarTipo(i, v as TipoRegra)} disabled={ocupado}>
                    <Select.Trigger id={`regra-tipo-${i}`} style={{ width: 220 }} />
                    <Select.Content>{TIPOS.map(t => <Select.Item key={t.id} value={t.id}>{t.rotulo}</Select.Item>)}</Select.Content>
                  </Select.Root>
                </div>
                {temValor(r.tipo) && (
                  <div className="form-campo">
                    <label className="form-campo-label" htmlFor={`regra-valor-${i}`}>{r.tipo === 'cliente' ? 'Cliente' : 'Texto'}</label>
                    {r.tipo === 'cliente' ? (
                      <Select.Root value={r.valor || '__none__'} onValueChange={v => editar(i, { valor: v === '__none__' ? '' : v })} disabled={ocupado}>
                        <Select.Trigger id={`regra-valor-${i}`} style={{ width: 220 }} />
                        <Select.Content>
                          <Select.Item value="__none__">Selecione</Select.Item>
                          {clientes.map(c => <Select.Item key={c.id} value={c.id}>{c.nome}</Select.Item>)}
                        </Select.Content>
                      </Select.Root>
                    ) : <TextField.Root id={`regra-valor-${i}`} style={{ width: 220 }} maxLength={200} disabled={ocupado} value={r.valor} onChange={e => editar(i, { valor: e.target.value })} />}
                  </div>
                )}
                {temPessoa(r.tipo) && (
                  <div className="form-campo">
                    <label className="form-campo-label" htmlFor={`regra-pessoa-${i}`}>Responsável</label>
                    <Select.Root value={r.responsavel || '__none__'} onValueChange={v => editar(i, { responsavel: v === '__none__' ? '' : v })} disabled={ocupado}>
                      <Select.Trigger id={`regra-pessoa-${i}`} style={{ width: 200 }} />
                      <Select.Content>
                        <Select.Item value="__none__">{r.tipo === 'padrao' ? 'Ninguém' : 'Selecione'}</Select.Item>
                        {opcoes.map(p => <Select.Item key={p} value={p}>{nomePessoa(p)}</Select.Item>)}
                      </Select.Content>
                    </Select.Root>
                  </div>
                )}
                <Text as="label" size="2"><Flex align="center" gap="2">
                  <Switch checked={r.ativo} disabled={ocupado} aria-label={`Regra ${i + 1} ativa`} onCheckedChange={v => editar(i, { ativo: v })} />Ativa
                </Flex></Text>
                <Button variant="ghost" size="1" aria-label={`Subir regra ${i + 1}`} disabled={ocupado || i === 0} onClick={() => mudar(moverRegra(regras, i, -1))}><ArrowUp size={14} /></Button>
                <Button variant="ghost" size="1" aria-label={`Descer regra ${i + 1}`} disabled={ocupado || i === regras.length - 1} onClick={() => mudar(moverRegra(regras, i, 1))}><ArrowDown size={14} /></Button>
                <Button variant="ghost" size="1" color="red" aria-label={`Remover regra ${i + 1}`} disabled={ocupado} onClick={() => mudar(regras.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
              </Flex>
              <Text as="p" size="1" color="gray" ml="5">{def.dica}{r.invalida && ' A pessoa desta regra saiu da equipe: ela é ignorada até você trocar.'}</Text>
              {r.invalida && <Badge color="amber" variant="soft" ml="5">Pessoa inativa</Badge>}
            </li>
          )
        })}
      </ol></Flex>
      {regras.length === 0 && <Text size="2" color="gray">Nenhuma regra ainda.</Text>}
      <Flex gap="2" wrap="wrap">
        <Button variant="soft" size="2" disabled={ocupado || regras.length >= LIMITE_REGRAS} onClick={adicionar}><Plus size={14} />Adicionar regra</Button>
        <Button size="2" disabled={ocupado || !sujo} onClick={salvar}>Salvar regras</Button>
      </Flex>

      <Flex direction="column" gap="2" pt="2" style={{ borderTop: '1px solid var(--gray-5)' }}>
        <Text size="2"><strong>{estado.sem_responsavel}</strong> processo(s) sem responsável hoje.</Text>
        <Flex gap="2" wrap="wrap">
          <Button variant="soft" size="2" disabled={ocupado || sujo || estado.sem_responsavel === 0} onClick={() => void simular()}>Simular</Button>
          <Button size="2" color="indigo" disabled={ocupado || sujo || !simulacao || comRegra.length === 0} onClick={() => setConfirmar(true)}>Aplicar a {comRegra.length} processo(s)</Button>
        </Flex>
        {sujo && <Text size="1" color="gray">Salve as regras para simular ou aplicar.</Text>}
        {simulacao && (
          <div role="region" aria-label="Resultado da simulação">
            <Text as="p" size="2" mb="1">{comRegra.length} de {simulacao.total} receberiam responsável (nada foi gravado):</Text>
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflow: 'auto' }}>
              {simulacao.itens.slice(0, 50).map(i => (
                <li key={i.caso_id}><Text size="2">{i.titulo || i.caso_id} → {i.responsavel ? <>{nomePessoa(i.responsavel)} <Text color="gray">({i.motivo})</Text></> : <Text color="gray">nenhuma regra casa</Text>}</Text></li>
              ))}
            </ul>
            {simulacao.itens.length > 50 && <Text size="1" color="gray">Mostrando 50 de {simulacao.itens.length}.</Text>}
          </div>
        )}
        <Text size="1" color="gray">{regras.length ? `Resumo: ${regras.filter(r => r.ativo).map(r => resumoRegra(r, nomePessoa, nomeCliente)).join('; ')}.` : ''}</Text>
      </Flex>

      <AlertDialog.Root open={confirmar} onOpenChange={o => { if (!o) setConfirmar(false) }}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Aplicar regras a {comRegra.length} processo(s)?</AlertDialog.Title>
          <AlertDialog.Description>Cada pessoa será avisada no sino. Quem já tem responsável não muda. Para desfazer, troque o responsável no cadastro do processo.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">Cancelar</Button></AlertDialog.Cancel>
            <Button onClick={aplicar}>Aplicar</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
