import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, Flex, Text } from '@radix-ui/themes'
import { buscarJson, enviarJson } from '../../api/rest'
import { quandoBrasilia } from './automacoes'

type Simulacao = { itens: { numero: string; cliente: string; motivo: string }[]; total: number; criaria: number; limite_dia: number; restante_hoje: number }
const BASE = '/admin/automacoes/autocadastro'
const SEM_CACHE = { cache: 'no-store' as const }

/** Simulação obrigatória do autocadastro: mostra quais rascunhos seriam criados (nada é gravado). Só depois dela a rotina pode ser ligada. */
export default function SimulacaoAutocadastro({ token }: { token: string }) {
  const [simulouEm, setSimulouEm] = useState<string | null>(null)
  const [criadosHoje, setCriadosHoje] = useState(0)
  const [resultado, setResultado] = useState<Simulacao | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const e = await buscarJson<{ simulou_em: string | null; criados_hoje: number }>({ token }, `${BASE}/estado`, undefined, SEM_CACHE)
      setSimulouEm(e.simulou_em); setCriadosHoje(e.criados_hoje)
    } catch (e) { setErro((e as Error).message) }
  }, [token])
  useEffect(() => { void carregar() }, [carregar])

  async function simular() {
    setOcupado(true); setErro('')
    try { setResultado(await enviarJson<Simulacao>({ token }, `${BASE}/simular`, {}, 'POST', undefined, SEM_CACHE)); await carregar() }
    catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  return (
    <Flex direction="column" gap="2" mt="2">
      <Text size="2" color="gray">
        {simulouEm ? `Última simulação: ${quandoBrasilia(simulouEm)}.` : 'Rode a simulação antes de ligar: ela mostra quais rascunhos seriam criados, sem gravar nada.'}
        {criadosHoje > 0 ? ` Hoje já foram criados ${criadosHoje}.` : ''}
      </Text>
      <Flex><Button size="2" variant="soft" disabled={ocupado} onClick={() => void simular()}>Simular agora</Button></Flex>
      {erro && <Callout.Root color="red" role="alert" size="1"><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {resultado && (
        <div role="region" aria-label="Resultado da simulação">
          <Text as="p" size="2" mb="1">
            {resultado.total === 0 ? 'Nenhuma publicação atende às condições agora.' : `Criaria ${resultado.criaria} de ${resultado.total} rascunho(s) (limite de ${resultado.limite_dia} por dia; restam ${resultado.restante_hoje} hoje). Nada foi gravado.`}
          </Text>
          <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 200, overflow: 'auto' }}>
            {resultado.itens.map(i => <li key={i.numero}><Text size="2">{i.numero} → {i.cliente} <Text color="gray">({i.motivo})</Text></Text></li>)}
          </ul>
        </div>
      )}
    </Flex>
  )
}
