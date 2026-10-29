import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { Button, InlineNotification, Stack } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { useNavegacao } from '../../api/NavegacaoContext'
import { buscarJson } from '../../api/rest'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import type { Caso } from '../casos/ListaCasos'

type Lancamento = {
  id: string; cliente_id?: string; caso_id?: string; vencimento?: string
  descricao?: string; valor?: number; direcao: string; pago?: boolean
}

export default function VinculosContato({ clienteId, tipo }: { clienteId: string; tipo: 'processos' | 'financeiro' }) {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [dados, setDados] = useState<{ casos: Caso[]; lancamentos: Lancamento[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [revisao, setRevisao] = useState(0)

  useEffect(() => {
    let atual = true
    setCarregando(true)
    setErro(null)
    setDados(null)
    Promise.all([
      buscarJson<{ casos: Caso[] }>(cliente, '/casos'),
      tipo === 'financeiro'
        ? buscarJson<{ lancamentos: Lancamento[] }>(cliente, '/lancamentos')
        : Promise.resolve({ lancamentos: [] as Lancamento[] }),
    ]).then(([processos, financeiro]) => {
      if (atual) setDados({ casos: processos.casos ?? [], lancamentos: financeiro.lancamentos ?? [] })
    }).catch((e: unknown) => {
      if (atual) setErro(e instanceof Error ? e.message : 'Falha ao carregar vínculos do contato.')
    }).finally(() => { if (atual) setCarregando(false) })
    return () => { atual = false }
  }, [cliente, clienteId, tipo, revisao])

  const casos = (dados?.casos ?? []).filter((caso) => caso.cliente_id === clienteId || caso.clientes_adicionais?.includes(clienteId))
  const itens = (dados?.lancamentos ?? []).filter((item) => item.cliente_id === clienteId)
    .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''))
  const totais = { receitas: 0, despesas: 0, recebido: 0, pago: 0 }
  for (const item of itens) {
    const valor = Math.round((Number(item.valor) || 0) * 100)
    const despesa = item.direcao === 'DESPESA'
    totais[despesa ? 'despesas' : 'receitas'] += valor
    if (item.pago) totais[despesa ? 'pago' : 'recebido'] += valor
  }
  const resumo: [string, number][] = [
    ['Receitas totais', totais.receitas], ['Despesas totais', totais.despesas],
    ['Recebido', totais.recebido], ['Pago', totais.pago],
    ['A receber', totais.receitas - totais.recebido], ['A pagar', totais.despesas - totais.pago],
    ['Saldo realizado', totais.recebido - totais.pago],
  ]

  function linkProcesso(caso: Caso) {
    return <Button kind="ghost" size="sm" onClick={() => irPara('casos', { id: caso.id })}>{formatarNomeExibicao(caso.titulo) || 'Processo sem título'}</Button>
  }

  return <Stack gap={5}>
    <div className="aj-layout-38">
      <h2>{tipo === 'processos' ? 'Processos vinculados' : 'Financeiro do cliente'}</h2>
      <Button kind="tertiary" size="sm" disabled={carregando} onClick={() => setRevisao((r) => r + 1)}>
        {tipo === 'processos' ? 'Atualizar processos' : 'Atualizar financeiro'}
      </Button>
    </div>
    {tipo === 'processos' ? <p>Processos em que este contato é cliente principal ou adicional.</p> : <div>
      <p>Lançamentos vinculados diretamente a este cliente. Os totais incluem todos os vencimentos.</p>
      <Button kind="ghost" size="sm" onClick={() => irPara('financeiro')}>Acessar Lançamentos para cadastrar ou alterar valores e pagamentos</Button>
    </div>}
    <div aria-live="polite" aria-busy={carregando}>
      {carregando && <Carregamento />}
      {erro && <InlineNotification kind="error" title="Erro ao carregar" subtitle={erro} lowContrast hideCloseButton />}
      {!carregando && dados && (tipo === 'processos' ? (
        casos.length ? <div className="contato-vinculos-tabela" tabIndex={0} role="region" aria-label="Processos vinculados">
          <table><caption>{casos.length} processo(s) vinculado(s)</caption><thead><tr><th scope="col">Título</th><th scope="col">Número CNJ</th><th scope="col">Vínculo</th><th scope="col">Situação</th></tr></thead>
            <tbody>{casos.map((caso) => <tr key={caso.id}><td>{linkProcesso(caso)}</td><td>{caso.processos?.map(formatarNumeroCNJ).join(', ') || 'Não informado'}</td><td>{caso.cliente_id === clienteId ? 'Cliente principal' : 'Cliente adicional'}</td><td>{formatarNomeExibicao(caso.status) || 'Não informado'}</td></tr>)}</tbody>
          </table>
        </div> : <InlineNotification kind="info" title="Nenhum processo vinculado a este cliente ainda" lowContrast hideCloseButton />
      ) : itens.length ? <Stack gap={5}>
        <dl className="contato-vinculos-resumo">{resumo.map(([rotulo, valor]) => <div key={rotulo}><dt>{rotulo}</dt><dd>{formatarMoeda(valor / 100)}</dd></div>)}</dl>
        <div className="contato-vinculos-tabela" tabIndex={0} role="region" aria-label="Lançamentos do cliente">
          <table><caption>{itens.length} lançamento(s) deste cliente</caption><thead><tr>{['Vencimento', 'Descrição', 'Processo', 'Tipo', 'Situação', 'Valor'].map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
            <tbody>{itens.map((item) => {
              const caso = dados.casos.find((c) => c.id === item.caso_id)
              const despesa = item.direcao === 'DESPESA'
              return <tr key={item.id}><td>{formatarDataSimples(item.vencimento)}</td><td>{item.descricao || 'Não informado'}</td><td>{caso ? linkProcesso(caso) : 'Não informado'}</td><td>{despesa ? 'Despesa' : 'Receita'}</td><td>{item.pago ? despesa ? 'Pago' : 'Recebido' : despesa ? 'A pagar' : 'A receber'}</td><td>{formatarMoeda(item.valor)}</td></tr>
            })}</tbody>
          </table>
        </div>
      </Stack> : <InlineNotification kind="info" title="Nenhum lançamento financeiro para este cliente" lowContrast hideCloseButton />)}
    </div>
  </Stack>
}
