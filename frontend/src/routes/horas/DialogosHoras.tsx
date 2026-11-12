import { useState } from 'react'
import { Button, Callout, Checkbox, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarMoeda, formatarNomeExibicao } from '../../utils/formatadores'
import { diaLocal } from '../home/dados'
import { somarDiasIso } from '../home/risco'
import { formatarDuracao, lerDuracao, type Horas } from './dados'

export type CasoOpcao = { id: string; titulo?: string }
const mensagem = (e: unknown, padrao: string) => (e instanceof ErroMCP || e instanceof Error ? e.message : padrao)

function SeletorProcesso({ valor, onChange, casos, id }: { valor: string; onChange: (v: string) => void; casos: CasoOpcao[]; id: string }) {
  return (
    <Select.Root value={valor || undefined} onValueChange={onChange}>
      <Select.Trigger id={id} placeholder="Escolha o processo" style={{ width: '100%' }} />
      <Select.Content>
        {casos.map(c => <Select.Item key={c.id} value={c.id}>{formatarNomeExibicao(c.titulo) || '(sem título)'}</Select.Item>)}
      </Select.Content>
    </Select.Root>
  )
}

/** Lançar horas à mão, ou corrigir um lançamento (o processo, a data, o tempo, a descrição, se é faturável e o valor/hora). */
export function DialogoLancarHoras({ inicial, casos, tarifaPropria, onClose, onSalvo }: {
  inicial: Horas | null; casos: CasoOpcao[]; tarifaPropria: number | null; onClose: () => void; onSalvo: () => void
}) {
  const { cliente } = useCliente()
  const [casoId, setCasoId] = useState(inicial?.caso_id ?? '')
  const [data, setData] = useState(inicial?.data ?? diaLocal(new Date()))
  const [tempo, setTempo] = useState(inicial ? formatarDuracao(inicial.minutos) : '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [faturavel, setFaturavel] = useState(inicial?.faturavel ?? true)
  const [valorHora, setValorHora] = useState(inicial?.valor_hora !== null && inicial?.valor_hora !== undefined ? String(inicial.valor_hora).replace('.', ',') : '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const minutos = lerDuracao(tempo)
  const valorNumero = valorHora.trim() === '' ? null : Number(valorHora.replace(/\./g, '').replace(',', '.'))
  const valorOk = valorNumero === null || (Number.isFinite(valorNumero) && valorNumero > 0)
  const valido = Boolean(casoId) && minutos !== null && /^\d{4}-\d{2}-\d{2}$/.test(data) && valorOk

  async function salvar() {
    if (minutos === null) return
    setSalvando(true); setErro('')
    // Sem valor digitado, o servidor usa o valor por hora da pessoa (ou o que já estava no lançamento).
    const corpo: Record<string, unknown> = { caso_id: casoId, data, minutos, descricao: descricao.trim() || null, faturavel }
    if (valorNumero !== null) corpo.valor_hora = valorNumero
    else if (inicial) corpo.valor_hora = null
    try {
      if (inicial) await enviarJson(cliente, `/horas/${inicial.id}`, corpo, 'PATCH')
      else await enviarJson(cliente, '/horas', corpo, 'POST')
      onSalvo()
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível salvar as horas.'))
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>{inicial ? 'Editar horas' : 'Lançar horas'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">Tempo trabalhado em um processo. Horas faturáveis podem virar um lançamento de honorário no Financeiro.</Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="horas-processo">Processo</Text>
            <SeletorProcesso id="horas-processo" valor={casoId} onChange={setCasoId} casos={casos} />
          </Flex>
          <Flex gap="3" wrap="wrap">
            <Flex direction="column" gap="1" style={{ flex: '1 1 9rem' }}>
              <Text as="label" size="2" weight="medium" htmlFor="horas-data">Data</Text>
              <TextField.Root id="horas-data" type="date" value={data} max={diaLocal(new Date())} onChange={e => setData(e.target.value)} />
            </Flex>
            <Flex direction="column" gap="1" style={{ flex: '1 1 9rem' }}>
              <Text as="label" size="2" weight="medium" htmlFor="horas-tempo">Tempo</Text>
              <TextField.Root id="horas-tempo" value={tempo} placeholder="Ex.: 1:30, 1h30, 45min" onChange={e => setTempo(e.target.value)} color={tempo && minutos === null ? 'red' : undefined} />
              <Text size="1" color={tempo && minutos === null ? 'red' : 'gray'}>{tempo && minutos === null ? 'Use de 1 minuto a 24 horas.' : minutos ? `= ${formatarDuracao(minutos)}` : 'Horas:minutos, "1h30", "45min" ou "1,5".'}</Text>
            </Flex>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="horas-descricao">O que foi feito (opcional)</Text>
            <TextField.Root id="horas-descricao" value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} placeholder="Ex.: Minuta da réplica" />
          </Flex>
          <Text as="label" size="2"><Flex gap="2" align="center"><Checkbox checked={faturavel} onCheckedChange={v => setFaturavel(v === true)} />Faturável (pode ser cobrada do cliente)</Flex></Text>
          {faturavel && (
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="horas-valor">Valor por hora (R$), opcional</Text>
              <TextField.Root id="horas-valor" inputMode="decimal" value={valorHora} onChange={e => setValorHora(e.target.value)}
                placeholder={tarifaPropria !== null ? `Vazio usa o seu valor: ${formatarMoeda(tarifaPropria)}` : 'Vazio: sem valor definido'} color={valorOk ? undefined : 'red'} />
              {tarifaPropria === null && !valorHora && <Text size="1" color="amber">Você ainda não tem valor por hora. Peça ao administrador ou informe aqui; sem valor, estas horas não podem ser faturadas.</Text>}
            </Flex>
          )}
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={!valido || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Escolhe o processo e liga o cronômetro. */
export function DialogoIniciarCronometro({ casos, onClose, onIniciado }: { casos: CasoOpcao[]; onClose: () => void; onIniciado: () => void }) {
  const { cliente } = useCliente()
  const [casoId, setCasoId] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function iniciar() {
    setSalvando(true); setErro('')
    try {
      await enviarJson(cliente, '/horas/cronometro', { caso_id: casoId, descricao: descricao.trim() || null }, 'POST')
      onIniciado()
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível iniciar o cronômetro.'))
      setSalvando(false)
    }
  }
  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>Iniciar cronômetro</Dialog.Title>
        <Dialog.Description size="2" color="gray">O cronômetro só conta enquanto estiver ligado. Ao parar, o tempo vira um lançamento de horas.</Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="crono-processo">Processo</Text>
            <SeletorProcesso id="crono-processo" valor={casoId} onChange={setCasoId} casos={casos} />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="crono-descricao">O que vai fazer (opcional)</Text>
            <TextField.Root id="crono-descricao" value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} />
          </Flex>
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={!casoId || salvando} onClick={() => void iniciar()}>{salvando ? 'Iniciando…' : 'Iniciar'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Resume as horas escolhidas e cria UM lançamento de honorário no Financeiro. */
export function DialogoFaturar({ selecionadas, onClose, onFaturado, irParaFinanceiro }: {
  selecionadas: Horas[]; onClose: () => void; onFaturado: () => void; irParaFinanceiro: () => void
}) {
  const { cliente } = useCliente()
  const [vencimento, setVencimento] = useState(() => somarDiasIso(diaLocal(new Date()), 15))
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState<{ valor: number } | null>(null)
  const minutos = selecionadas.reduce((s, h) => s + h.minutos, 0)
  const valor = selecionadas.reduce((s, h) => s + Math.round((h.valor ?? 0) * 100), 0) / 100
  const processo = formatarNomeExibicao(selecionadas[0]?.caso_titulo) || '(sem título)'

  async function faturar() {
    setSalvando(true); setErro('')
    try {
      const r = await enviarJson<{ valor: number }>(cliente, '/horas/faturar', { ids: selecionadas.map(h => h.id), vencimento, descricao: descricao.trim() || null }, 'POST')
      setFeito({ valor: r.valor })
      onFaturado()
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível faturar as horas.'))
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="500px">
        {feito ? (
          <>
            <Dialog.Title>Lançamento criado</Dialog.Title>
            <Dialog.Description size="2">Um honorário de <strong>{formatarMoeda(feito.valor)}</strong> foi criado no Financeiro, com vencimento em {vencimento.split('-').reverse().join('/')}. As horas faturadas ficam travadas.</Dialog.Description>
            <Flex gap="3" mt="5" justify="end">
              <Button variant="soft" color="gray" onClick={onClose}>Fechar</Button>
              <Button onClick={() => { onClose(); irParaFinanceiro() }}>Ver no Financeiro</Button>
            </Flex>
          </>
        ) : (
          <>
            <Dialog.Title>Faturar horas</Dialog.Title>
            <Dialog.Description size="2" color="gray">Cria um lançamento de honorário a receber com o total das horas escolhidas.</Dialog.Description>
            <Flex direction="column" gap="3" mt="4">
              <Text size="2"><strong>{processo}</strong><br />{selecionadas.length} {selecionadas.length === 1 ? 'lançamento' : 'lançamentos'} · {formatarDuracao(minutos)} · <strong>{formatarMoeda(valor)}</strong></Text>
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium" htmlFor="faturar-venc">Vencimento</Text>
                <TextField.Root id="faturar-venc" type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} />
              </Flex>
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium" htmlFor="faturar-desc">Descrição (opcional)</Text>
                <TextField.Root id="faturar-desc" value={descricao} maxLength={300} onChange={e => setDescricao(e.target.value)} placeholder="Se vazio, o sistema descreve o processo, o tempo e o período" />
              </Flex>
            </Flex>
            {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
            <Flex gap="3" mt="5" justify="end">
              <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
              <Button disabled={salvando || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)} onClick={() => void faturar()}>{salvando ? 'Criando…' : `Criar lançamento de ${formatarMoeda(valor)}`}</Button>
            </Flex>
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Administrador: valor por hora de cada pessoa. Vale para as horas lançadas daqui em diante. */
export function DialogoTarifas({ pessoas, tarifas, onClose, onSalvo }: {
  pessoas: string[]; tarifas: Record<string, number>; onClose: () => void; onSalvo: () => void
}) {
  const { cliente } = useCliente()
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(pessoas.map(p => [p, tarifas[p] !== undefined ? String(tarifas[p]).replace('.', ',') : ''])))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const numero = (t: string) => (t.trim() === '' ? null : Number(t.replace(/\./g, '').replace(',', '.')))
  const invalido = pessoas.some(p => { const n = numero(valores[p] ?? ''); return n !== null && !(Number.isFinite(n) && n > 0) })

  async function salvar() {
    setSalvando(true); setErro('')
    try {
      for (const pessoa of pessoas) {
        const novo = numero(valores[pessoa] ?? '')
        if ((novo ?? null) === (tarifas[pessoa] ?? null)) continue
        await enviarJson(cliente, `/horas/tarifas/${encodeURIComponent(pessoa)}`, { valor_hora: novo }, 'PUT')
      }
      onSalvo()
    } catch (e) {
      setErro(mensagem(e, 'Não foi possível salvar os valores.'))
      setSalvando(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(aberto) => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Valor por hora</Dialog.Title>
        <Dialog.Description size="2" color="gray">O valor de cada pessoa é gravado nas horas que ela lançar daqui em diante; horas antigas não mudam.</Dialog.Description>
        <Flex direction="column" gap="2" mt="4">
          {pessoas.map(p => (
            <Flex key={p} align="center" justify="between" gap="3">
              <Text size="2" as="label" htmlFor={`tarifa-${p}`}>{p}</Text>
              <TextField.Root id={`tarifa-${p}`} style={{ width: '9rem' }} inputMode="decimal" placeholder="Sem valor" value={valores[p] ?? ''}
                onChange={e => setValores(v => ({ ...v, [p]: e.target.value }))} />
            </Flex>
          ))}
        </Flex>
        {erro && <Callout.Root color="red" size="1" mt="3" role="alert"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close><Button variant="soft" color="gray" disabled={salvando}>Cancelar</Button></Dialog.Close>
          <Button disabled={invalido || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar valores'}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
