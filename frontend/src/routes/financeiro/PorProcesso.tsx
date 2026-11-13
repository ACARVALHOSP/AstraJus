import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Callout, Flex, Text, TextField } from '@radix-ui/themes'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import { useNavegacao } from '../../api/NavegacaoContext'
import { formatarMoeda } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import { useResumoFinanceiro } from './useResumoFinanceiro'
import type { ResumoProcesso } from './dadosResumo'
import './financeiro.scss'

/** Situação financeira de cada processo: honorários, custas, repasses e saldo. */
export default function PorProcesso({ abas }: { abas: ReactNode }) {
  const { resumo, carregando, erro, nomeCliente, tituloCaso } = useResumoFinanceiro()
  const { irPara } = useNavegacao()
  const estreita = useEstreita()
  const [busca, setBusca] = useState('')
  const linhas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return (resumo?.processos ?? []).filter(p => !termo || `${tituloCaso(p.caso_id)} ${nomeCliente(p.cliente_id)}`.toLocaleLowerCase('pt-BR').includes(termo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumo, busca])
  const soma = (f: (p: ResumoProcesso) => number) => linhas.reduce((t, p) => t + f(p), 0)

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina titulo="Financeiro" abas={abas} descricao="Quanto cada processo rende e custa: honorários, custas adiantadas, repasses e saldo." />
      {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && <Carregamento tipo="tabela" descricao="Carregando…" />}
      {resumo && <>
        <dl className="fin-resumo">
          <div><dt>Honorários a receber</dt><dd>{formatarMoeda(soma(p => p.honorarios.em_aberto))}</dd><p>{formatarMoeda(soma(p => p.honorarios.vencidos))} já vencidos</p></div>
          <div><dt>Honorários recebidos</dt><dd className="fin-receita">{formatarMoeda(soma(p => p.honorarios.recebidos))}</dd><p>de {formatarMoeda(soma(p => p.honorarios.previstos))} previstos</p></div>
          <div><dt>Custas a cobrar do cliente</dt><dd>{formatarMoeda(soma(p => p.custas.a_reembolsar))}</dd><p>{formatarMoeda(soma(p => p.custas.reembolso_pendente))} já cobradas e em aberto</p></div>
          <div><dt>Repasses pendentes</dt><dd className={soma(p => p.repasses.pendente) ? 'fin-despesa' : undefined}>{formatarMoeda(soma(p => p.repasses.pendente))}</dd><p>{formatarMoeda(soma(p => p.repasses.repassado))} já repassados</p></div>
        </dl>
        <div className="form-campo" style={{ maxInlineSize: 420 }}>
          <label className="form-campo-label" htmlFor="fin-proc-busca">Buscar</label>
          <TextField.Root id="fin-proc-busca" type="search" placeholder="Processo ou cliente" autoComplete="off" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        {!linhas.length && <Text as="p" size="2" color="gray" role="status">{resumo.processos.length ? 'Nenhum processo encontrado.' : 'Nenhum lançamento vinculado a processos ainda.'}</Text>}
        {linhas.length > 0 && (estreita ? (
          <ul className="fin-cartoes">
            {linhas.map(p => (
              <li key={p.caso_id} className="fin-cartao">
                <button type="button" className="fin-link" onClick={() => irPara('casos', { id: p.caso_id })}>{tituloCaso(p.caso_id)}</button>
                <Text size="2" color="gray">{nomeCliente(p.cliente_id)}</Text>
                <dl className="fin-mini">
                  <div><dt>Honorários em aberto</dt><dd>{formatarMoeda(p.honorarios.em_aberto)}</dd></div>
                  {p.honorarios.vencidos > 0 && <div><dt>Vencidos</dt><dd className="fin-despesa">{formatarMoeda(p.honorarios.vencidos)}</dd></div>}
                  <div><dt>Custas gastas</dt><dd>{formatarMoeda(p.custas.gastas)}</dd></div>
                  {p.custas.a_reembolsar > 0 && <div><dt>Custas a cobrar</dt><dd>{formatarMoeda(p.custas.a_reembolsar)}</dd></div>}
                  {p.repasses.pendente > 0 && <div><dt>Repasse pendente</dt><dd>{formatarMoeda(p.repasses.pendente)}</dd></div>}
                  <div><dt>Saldo</dt><dd className={p.saldo < 0 ? 'fin-despesa' : 'fin-receita'}>{formatarMoeda(p.saldo)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <div className="fin-rolagem">
            <table aria-label="Situação financeira por processo" className="fin-tabela">
              <thead>
                <tr>
                  <th>Processo</th>
                  <th className="fin-num">Previsto</th><th className="fin-num">Recebido</th><th className="fin-num">Em aberto</th>
                  <th className="fin-num">Custas</th><th className="fin-num">A cobrar</th><th className="fin-num">Repasse pend.</th>
                  <th className="fin-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(p => (
                  <tr key={p.caso_id}>
                    <td>
                      <div className="tabela-celula-limitada">
                        <button type="button" className="fin-link" onClick={() => irPara('casos', { id: p.caso_id })}>{tituloCaso(p.caso_id)}</button>
                        <div className="fin-secundario">{nomeCliente(p.cliente_id)}</div>
                      </div>
                    </td>
                    <td className="fin-num">{formatarMoeda(p.honorarios.previstos)}</td>
                    <td className="fin-num fin-receita">{formatarMoeda(p.honorarios.recebidos)}</td>
                    <td className="fin-num">{formatarMoeda(p.honorarios.em_aberto)}{p.honorarios.vencidos > 0 && <div className="fin-secundario fin-alerta">{formatarMoeda(p.honorarios.vencidos)} vencidos</div>}</td>
                    <td className="fin-num">{formatarMoeda(p.custas.gastas)}</td>
                    <td className="fin-num">{formatarMoeda(p.custas.a_reembolsar)}{p.custas.reembolso_pendente > 0 && <div className="fin-secundario">{formatarMoeda(p.custas.reembolso_pendente)} cobradas</div>}</td>
                    <td className="fin-num">{formatarMoeda(p.repasses.pendente)}</td>
                    <td className={`fin-num fin-valor ${p.saldo < 0 ? 'fin-despesa' : 'fin-receita'}`}>{formatarMoeda(p.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <Text as="p" size="1" color="gray">Saldo = valores recebidos menos valores pagos (custas e repasses já quitados). Valores a receber ou a pagar não entram no saldo.</Text>
      </>}
    </Flex>
  )
}
