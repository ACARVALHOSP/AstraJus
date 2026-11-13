import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import Carregamento from '../../Carregamento'
import { Badge, Button, Callout, Flex, Heading } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { useNavegacao } from '../../api/NavegacaoContext'
import { useCasos, useLancamentos } from '../../api/consultas'
import { formatarDataSimples, formatarMoeda, formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import type { Caso } from '../casos/ListaCasos'
import { COR_POLO, ROTULO_POLO } from '../../utils/polos'

type Lancamento = {
  id: string; cliente_id?: string; caso_id?: string; vencimento?: string
  descricao?: string; valor?: number; direcao: string; pago?: boolean
}

export default function VinculosContato({ clienteId, tipo }: { clienteId: string; tipo: 'processos' | 'financeiro' }) {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const financeiro = tipo === 'financeiro'
  const consultaCasos = useCasos<Caso>({ enabled: Boolean(cliente) })
  const consultaLancamentos = useLancamentos<Lancamento>({ enabled: Boolean(cliente) && financeiro })
  const carregando = consultaCasos.isLoading || (financeiro && consultaLancamentos.isLoading)
  const falha = consultaCasos.error ?? (financeiro ? consultaLancamentos.error : null)
  const erro = falha ? (falha instanceof Error ? falha.message : 'Falha ao carregar vínculos do contato.') : null
  const dados = consultaCasos.data && (!financeiro || consultaLancamentos.data)
    ? { casos: consultaCasos.data, lancamentos: financeiro ? consultaLancamentos.data ?? [] : [] }
    : null
  const recarregar = () => { void consultaCasos.refetch(); if (financeiro) void consultaLancamentos.refetch() }

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
    return <TextoTabela texto={formatarNomeExibicao(caso.titulo) || 'Processo sem título'} onClick={() => irPara('casos', { id: caso.id })} />
  }

  return (
    <Flex direction="column" gap="5">
      <div className="aj-layout-38">
        <Heading as="h2" size="4">{tipo === 'processos' ? 'Processos vinculados' : 'Financeiro do cliente'}</Heading>
        <Button variant="soft" size="1" disabled={carregando} onClick={recarregar}>
          {tipo === 'processos' ? 'Atualizar processos' : 'Atualizar financeiro'}
        </Button>
      </div>
      {tipo === 'processos' ? (
        <p>Processos em que este contato é cliente principal ou adicional.</p>
      ) : (
        <div>
          <p>Lançamentos vinculados diretamente a este cliente. Os totais incluem todos os vencimentos.</p>
          <Button variant="ghost" size="1" onClick={() => irPara('financeiro')}>Acessar Lançamentos para cadastrar ou alterar valores e pagamentos</Button>
        </div>
      )}
      <div aria-live="polite" aria-busy={carregando}>
        {carregando && <Carregamento />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>Erro ao carregar: {erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && dados && (tipo === 'processos' ? (
          casos.length ? (
            <div className="contato-vinculos-tabela" tabIndex={0} role="region" aria-label="Processos vinculados">
              <TabelaResponsiva principais={['Título', 'Descrição', 'Valor']}>
                <table>
                  <caption>{casos.length} processo(s) vinculado(s)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Título</th>
                      <th scope="col">Número CNJ</th>
                      <th scope="col">Vínculo</th>
                      <th scope="col">Posição no processo</th>
                      <th scope="col">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {casos.map((caso) => (
                      <tr key={caso.id}>
                        <td>{linkProcesso(caso)}</td>
                        <td>{caso.processos?.map(formatarNumeroCNJ).join(', ') || 'Não informado'}</td>
                        <td>{caso.cliente_id === clienteId ? 'Cliente principal' : 'Cliente adicional'}</td>
                        <td>{(() => {
                          const p = caso.polos?.find(x => x.cliente_id === clienteId)
                          return p?.polo
                            ? <Badge color={COR_POLO[p.polo]} variant="soft" title={p.origem === 'manual' ? 'Definido por você' : 'Deduzido da capa e das publicações do processo'}>{ROTULO_POLO[p.polo]}{p.origem === 'manual' ? '' : ' (automático)'}</Badge>
                            : <span className="aj-texto-suave" title="Abra o processo para informar o polo">Não informada</span>
                        })()}</td>
                        <td>{formatarNomeExibicao(caso.status) || 'Não informado'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabelaResponsiva>
            </div>
          ) : (
            <Callout.Root color="blue" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>Nenhum processo vinculado a este cliente ainda.</Callout.Text>
            </Callout.Root>
          )
        ) : itens.length ? (
          <Flex direction="column" gap="5">
            <dl className="contato-vinculos-resumo">
              {resumo.map(([rotulo, valor]) => (
                <div key={rotulo}><dt>{rotulo}</dt><dd>{formatarMoeda(valor / 100)}</dd></div>
              ))}
            </dl>
            <div className="contato-vinculos-tabela" tabIndex={0} role="region" aria-label="Lançamentos do cliente">
              <TabelaResponsiva principais={['Título', 'Descrição', 'Valor']}>
                <table>
                  <caption>{itens.length} lançamento(s) deste cliente</caption>
                  <thead>
                    <tr>
                      {['Vencimento', 'Descrição', 'Processo', 'Tipo', 'Situação', 'Valor'].map((c) => (
                        <th scope="col" key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item) => {
                      const caso = dados.casos.find((c) => c.id === item.caso_id)
                      const despesa = item.direcao === 'DESPESA'
                      return (
                        <tr key={item.id}>
                          <td>{formatarDataSimples(item.vencimento)}</td>
                          <td><TextoTabela texto={item.descricao || 'Não informado'} /></td>
                          <td>{caso ? linkProcesso(caso) : 'Não informado'}</td>
                          <td>{despesa ? 'Despesa' : 'Receita'}</td>
                          <td>{item.pago ? (despesa ? 'Pago' : 'Recebido') : (despesa ? 'A pagar' : 'A receber')}</td>
                          <td>{formatarMoeda(item.valor)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TabelaResponsiva>
            </div>
          </Flex>
        ) : (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum lançamento financeiro para este cliente.</Callout.Text>
          </Callout.Root>
        ))}
      </div>
    </Flex>
  )
}
