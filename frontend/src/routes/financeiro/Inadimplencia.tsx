import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Download } from 'lucide-react'
import { Badge, Button, Callout, Flex, Text } from '@radix-ui/themes'
import CabecalhoPagina from '../../CabecalhoPagina'
import Carregamento from '../../Carregamento'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { useNavegacao } from '../../api/NavegacaoContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarMoeda } from '../../utils/formatadores'
import { baixarCsv } from '../../utils/csv'
import { useResumoFinanceiro } from './useResumoFinanceiro'
import type { ClienteInadimplente } from './dadosResumo'
import './financeiro.scss'

const dataCurta = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
const corFaixa = (dias: number) => (dias > 90 ? 'red' : dias > 60 ? 'orange' : dias > 30 ? 'amber' : 'gray') as 'red' | 'orange' | 'amber' | 'gray'

/** Quem está devendo, há quanto tempo e quanto: por faixa de atraso e por cliente. */
export default function Inadimplencia({ abas }: { abas: ReactNode }) {
  const { resumo, carregando, erro, carregar, nomeCliente, tituloCaso } = useResumoFinanceiro()
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const { avisar } = useAvisos()
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [cobrando, setCobrando] = useState('')
  const inad = resumo?.inadimplencia

  function alternar(id: string) { setAbertos(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  async function gerarCobranca(id: string) {
    setCobrando(id)
    try {
      await enviarJson(cliente, `/lancamentos/${id}/cobranca`, {})
      avisar({ texto: 'Cobrança gerada no Asaas.' })
      await carregar()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao gerar cobrança.' })
    } finally { setCobrando('') }
  }
  function exportar() {
    if (!inad?.clientes.length) { avisar({ tipo: 'info', texto: 'Não há valores vencidos para exportar.' }); return }
    const linhas = inad.clientes.flatMap(c => c.itens.map(i => ({ ...i, cliente_id: c.cliente_id })))
    baixarCsv('inadimplencia', [
      { titulo: 'Cliente', valor: i => nomeCliente(i.cliente_id) },
      { titulo: 'Processo', valor: i => tituloCaso(i.caso_id) },
      { titulo: 'Descrição', valor: i => i.descricao },
      { titulo: 'Vencimento', valor: i => dataCurta(i.vencimento) },
      { titulo: 'Dias de atraso', valor: i => i.dias_atraso },
      { titulo: 'Valor', valor: i => i.valor },
      { titulo: 'Cobrança no Asaas', valor: i => (i.asaas_cobranca_id ? 'Sim' : 'Não') },
    ], linhas)
    avisar({ texto: `${linhas.length} lançamento(s) vencido(s) exportado(s).` })
  }
  async function copiarLembrete(c: ClienteInadimplente) {
    const linhas = c.itens.map(i => `• ${i.descricao} — ${formatarMoeda(i.valor)}, vencido em ${dataCurta(i.vencimento)}`)
    const texto = `Olá, ${nomeCliente(c.cliente_id).split(' ')[0]}! Identificamos valores em aberto referentes aos seus honorários:\n${linhas.join('\n')}\nTotal: ${formatarMoeda(c.valor)}.\nPodemos ajudar com a regularização? Obrigado.`
    try { await navigator.clipboard.writeText(texto); avisar({ texto: 'Lembrete copiado. É só colar no WhatsApp ou no e-mail.' }) }
    catch { avisar({ tipo: 'erro', texto: 'Não foi possível copiar o lembrete.' }) }
  }

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina titulo="Financeiro" abas={abas} descricao="Valores a receber que já venceram, por tempo de atraso e por cliente."
        acoes={<Button size="2" variant="soft" color="gray" onClick={exportar}><Download size={14} aria-hidden="true" />Exportar CSV</Button>} />
      {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
      {carregando && !resumo && <Carregamento tipo="tabela" descricao="Carregando…" />}
      {inad && <>
        <dl className="fin-resumo">
          <div><dt>Total vencido</dt><dd className={inad.total_vencido ? 'fin-despesa' : undefined}>{formatarMoeda(inad.total_vencido)}</dd><p>{inad.quantidade} lançamento(s)</p></div>
          <div><dt>Clientes em atraso</dt><dd>{inad.clientes_inadimplentes}</dd><p>com algum valor vencido</p></div>
          <div><dt>Taxa de inadimplência</dt><dd>{inad.taxa.toLocaleString('pt-BR')}%</dd><p>do que já deveria ter sido recebido</p></div>
          <div><dt>Acima de 90 dias</dt><dd className={inad.faixas[3].valor ? 'fin-despesa' : undefined}>{formatarMoeda(inad.faixas[3].valor)}</dd><p>{inad.faixas[3].quantidade} lançamento(s)</p></div>
        </dl>
        <div className="fin-faixas" role="list" aria-label="Valor vencido por tempo de atraso">
          {inad.faixas.map(f => (
            <div key={f.faixa} role="listitem" className="fin-faixa">
              <Text size="1" color="gray">{f.faixa === '90+' ? 'Mais de 90 dias' : `${f.faixa} dias`}</Text>
              <Text size="3" weight="bold">{formatarMoeda(f.valor)}</Text>
              <Text size="1" color="gray">{f.quantidade} lançamento(s)</Text>
            </div>
          ))}
        </div>
        {!inad.clientes.length && <Callout.Root color="green" size="1" role="status"><Callout.Text>Nenhum valor vencido em aberto. Tudo em dia.</Callout.Text></Callout.Root>}
        <ul className="fin-inad-lista">
          {inad.clientes.map(c => {
            const aberto = abertos.has(c.cliente_id)
            return (
              <li key={c.cliente_id} className="fin-inad-cliente">
                <Flex align="center" gap="3" wrap="wrap">
                  <button type="button" className="fin-inad-titulo" aria-expanded={aberto} onClick={() => alternar(c.cliente_id)}>
                    {aberto ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    <span>{nomeCliente(c.cliente_id)}</span>
                  </button>
                  <Badge color={corFaixa(c.maior_atraso)} variant="soft">{c.maior_atraso} dias de atraso</Badge>
                  <Text size="2" color="gray">{c.quantidade} lançamento(s)</Text>
                  <Text size="3" weight="bold" className="fin-despesa" style={{ marginLeft: 'auto' }}>{formatarMoeda(c.valor)}</Text>
                  <Button size="1" variant="soft" color="gray" onClick={() => void copiarLembrete(c)}><Copy size={13} aria-hidden="true" />Copiar lembrete</Button>
                </Flex>
                {aberto && (
                  <ul className="fin-inad-itens">
                    {c.itens.map(i => (
                      <li key={i.id}>
                        <div>
                          <Text size="2" weight="medium">{i.descricao}</Text>
                          <div className="fin-secundario">
                            <button type="button" className="fin-link" onClick={() => irPara('casos', { id: i.caso_id })}>{tituloCaso(i.caso_id)}</button>
                            {' · '}venceu em {dataCurta(i.vencimento)} ({i.dias_atraso} dias)
                          </div>
                        </div>
                        <Text size="2" weight="bold">{formatarMoeda(i.valor)}</Text>
                        {i.asaas_cobranca_id
                          ? <Button size="1" variant="ghost" onClick={() => irPara('pagamentos')}>Ver cobrança</Button>
                          : <Button size="1" variant="soft" loading={cobrando === i.id} onClick={() => void gerarCobranca(i.id)}>Gerar cobrança</Button>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </>}
    </Flex>
  )
}
