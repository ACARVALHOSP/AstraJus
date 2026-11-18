import { useCallback, useState } from 'react'
import { AlertDialog, Badge, Button, Callout, Checkbox, Flex, Heading, Text, TextArea } from '@radix-ui/themes'
import { buscarJson, enviarJson } from '../../api/rest'
import { quandoBrasilia } from './automacoes'

type Item = { tipo: 'cliente' | 'caso'; id: string; antes: string; depois: string; duplicado: boolean }
type Aplicado = { id: number; tipo: 'cliente' | 'caso'; antes: string; depois: string; aplicado_em: string; aplicado_por: string; desfeito_em: string | null }
type Verificacao = { itens: Item[]; total: number; duplicados: number; aplicados: Aplicado[] }

const BASE = '/admin/nomes'
const SEM_CACHE = { cache: 'no-store' as const }
const chave = (i: Pick<Item, 'tipo' | 'id'>) => `${i.tipo}:${i.id}`

/** Saneamento de nomes: lista "antes → depois" de clientes e processos em maiúsculas, aplica o que for marcado e permite desfazer. */
export default function NormalizarNomes({ token }: { token: string }) {
  const [dados, setDados] = useState<Verificacao | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [excecoes, setExcecoes] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [retorno, setRetorno] = useState<{ texto: string; tom: 'green' | 'red' } | null>(null)
  const [confirmarTodos, setConfirmarTodos] = useState(false)

  const verificar = useCallback(async () => {
    const d = await buscarJson<Verificacao>({ token }, `${BASE}/verificar`, undefined, SEM_CACHE)
    setDados(d); setMarcados(new Set())
    if (excecoes === null) setExcecoes((await buscarJson<{ excecoes: string[] }>({ token }, `${BASE}/excecoes`, undefined, SEM_CACHE)).excecoes.join('\n'))
  }, [token, excecoes])

  async function executar(acao: () => Promise<string>) {
    if (ocupado) return
    setOcupado(true)
    try { setRetorno({ texto: await acao(), tom: 'green' }) } catch (e) { setRetorno({ texto: (e as Error).message, tom: 'red' }) } finally { setOcupado(false) }
  }
  const aplicar = (corpo: object) => executar(async () => {
    const r = await enviarJson<{ aplicados: number; ignorados: number }>({ token }, `${BASE}/aplicar`, corpo, 'POST', undefined, SEM_CACHE)
    await verificar()
    return `${r.aplicados} nome(s) normalizado(s)${r.ignorados ? `; ${r.ignorados} ignorado(s) porque mudaram desde a prévia` : ''}.`
  })
  const desfazer = (ids: number[]) => executar(async () => {
    const r = await enviarJson<{ desfeitos: number; ignorados: number }>({ token }, `${BASE}/desfazer`, { ids }, 'POST', undefined, SEM_CACHE)
    await verificar()
    return `${r.desfeitos} nome(s) restaurado(s)${r.ignorados ? `; ${r.ignorados} não restaurado(s) porque o nome foi editado depois` : ''}.`
  })
  const salvarExcecoes = () => executar(async () => {
    const lista = (excecoes ?? '').split('\n').map(l => l.trim()).filter(Boolean)
    const r = await enviarJson<{ excecoes: string[] }>({ token }, `${BASE}/excecoes`, { excecoes: lista }, 'PUT', undefined, SEM_CACHE)
    setExcecoes(r.excecoes.join('\n'))
    await verificar()
    return 'Exceções salvas.'
  })
  const alternar = (i: Item) => setMarcados(m => { const n = new Set(m); if (!n.delete(chave(i))) n.add(chave(i)); return n })
  const recentes = dados?.aplicados.filter(a => !a.desfeito_em) ?? []

  return (
    <section aria-label="Normalizar nomes">
      <Heading as="h2" size="4" mt="4">Normalizar nomes</Heading>
      <Text as="p" size="2" color="gray">
        Passa nomes de clientes e títulos de processo que estão todos em maiúsculas (ou minúsculas) para caixa de título. Nome já em caixa mista
        não é tocado, e CPF/CNPJ, OAB, número do processo e dados da capa nunca mudam. Cada alteração pode ser desfeita.
      </Text>
      <Flex gap="2" mt="2" wrap="wrap">
        <Button variant="soft" size="2" disabled={ocupado} onClick={() => void executar(async () => { await verificar(); return 'Verificação pronta: nada foi alterado.' })}>Verificar</Button>
      </Flex>
      {retorno && <Callout.Root mt="2" color={retorno.tom} role={retorno.tom === 'red' ? 'alert' : 'status'} size="1"><Callout.Text>{retorno.texto}</Callout.Text></Callout.Root>}

      {dados && (
        <Flex direction="column" gap="3" mt="3">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="nomes-excecoes">Exceções de grafia (uma por linha, ex.: iFood)</label>
            <TextArea id="nomes-excecoes" rows={3} value={excecoes ?? ''} disabled={ocupado} onChange={e => setExcecoes(e.target.value)} />
            <Button mt="2" size="2" variant="soft" style={{ alignSelf: "flex-start" }} disabled={ocupado} onClick={() => void salvarExcecoes()}>Salvar exceções</Button>
          </div>

          {dados.total === 0
            ? <Text size="2" color="gray">Nenhum nome precisa de ajuste.</Text>
            : <>
              <Text size="2"><strong>{dados.total}</strong> nome(s) para ajustar{dados.duplicados ? `; ${dados.duplicados} já existe(m) com a grafia certa (fora da seleção padrão)` : ''}.</Text>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflow: 'auto' }}>
                {dados.itens.map(i => (
                  <li key={chave(i)}>
                    <Text as="label" size="2"><Flex align="center" gap="2">
                      <Checkbox checked={marcados.has(chave(i))} disabled={ocupado} onCheckedChange={() => alternar(i)} aria-label={`Aplicar em ${i.antes}`} />
                      <Badge variant="soft" color="gray">{i.tipo === 'cliente' ? 'Cliente' : 'Processo'}</Badge>
                      <span>{i.antes} → <strong>{i.depois}</strong></span>
                      {i.duplicado && <Badge color="amber" variant="soft">Já existe</Badge>}
                    </Flex></Text>
                  </li>
                ))}
              </ul>
              {dados.total > dados.itens.length && <Text size="1" color="gray">Mostrando {dados.itens.length} de {dados.total}; use “Aplicar a todos” para o restante.</Text>}
              <Flex gap="2" wrap="wrap">
                <Button size="2" disabled={ocupado || marcados.size === 0} onClick={() => void aplicar({ itens: dados.itens.filter(i => marcados.has(chave(i))).map(({ tipo, id }) => ({ tipo, id })) })}>Aplicar aos {marcados.size} marcado(s)</Button>
                <Button size="2" variant="soft" disabled={ocupado} onClick={() => setConfirmarTodos(true)}>Aplicar a todos (sem os que já existem)</Button>
              </Flex>
            </>}

          {recentes.length > 0 && (
            <div>
              <Heading as="h3" size="3" mb="1">Aplicados (podem ser desfeitos)</Heading>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflow: 'auto' }}>
                {recentes.map(a => (
                  <li key={a.id}><Flex align="center" gap="2" wrap="wrap">
                    <Text size="2">{a.antes} → {a.depois} <Text color="gray">({quandoBrasilia(a.aplicado_em)})</Text></Text>
                    <Button variant="ghost" size="1" disabled={ocupado} onClick={() => void desfazer([a.id])}>Desfazer</Button>
                  </Flex></li>
                ))}
              </ul>
              {recentes.length > 1 && <Button mt="1" size="1" variant="soft" color="gray" disabled={ocupado} onClick={() => void desfazer(recentes.map(a => a.id))}>Desfazer todos</Button>}
            </div>
          )}
        </Flex>
      )}

      <AlertDialog.Root open={confirmarTodos} onOpenChange={o => { if (!o) setConfirmarTodos(false) }}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Normalizar {dados ? dados.total - dados.duplicados : 0} nome(s)?</AlertDialog.Title>
          <AlertDialog.Description>Só muda a caixa dos nomes listados. Cada alteração guarda o valor anterior e pode ser desfeita aqui mesmo.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">Cancelar</Button></AlertDialog.Cancel>
            <Button onClick={() => { setConfirmarTodos(false); void aplicar({ todos: true }) }}>Aplicar</Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </section>
  )
}
