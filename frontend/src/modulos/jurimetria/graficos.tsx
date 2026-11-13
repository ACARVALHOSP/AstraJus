import { Flex, Text } from '@radix-ui/themes'
import { formatarPercentual, formatarReais } from '../../utils/formatadores'
import { DESFECHOS, type Desfecho, type FaixaHistograma, type PontoMensal, type ResumoValores } from './estatisticas'

// Gráficos em HTML/SVG puro (sem biblioteca), com as cores dos temas do Radix para funcionarem
// no claro e no escuro. Cada gráfico traz um resumo em texto (aria-label) para leitores de tela.

const ROTULO_DESFECHO_GRAFICO: Record<Desfecho, string> = {
  procedente: 'Procedente',
  parcial: 'Parcialmente procedente',
  improcedente: 'Improcedente',
  acordo: 'Acordo homologado',
  extinto: 'Extinto sem mérito',
}

const COR: Record<Desfecho, string> = {
  procedente: 'var(--green-9)',
  parcial: 'var(--teal-9)',
  improcedente: 'var(--red-9)',
  acordo: 'var(--blue-9)',
  extinto: 'var(--gray-8)',
}

function Titulo({ children }: { children: string }) {
  return <Text as="div" size="2" weight="bold" mb="2">{children}</Text>
}

export function GraficoDesfechos({ contagens, total }: { contagens: Record<Desfecho, number>; total: number }) {
  if (total === 0) return null
  const resumo = DESFECHOS.map(d => `${ROTULO_DESFECHO_GRAFICO[d]}: ${contagens[d]}`).join('; ')
  return (
    <div role="img" aria-label={`Distribuição dos desfechos. ${resumo}.`}>
      <Titulo>Distribuição dos desfechos</Titulo>
      <Flex direction="column" gap="2">
        {DESFECHOS.map(d => {
          const fracao = contagens[d] / total
          return (
            <div key={d} style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 12rem) 1fr 7rem', alignItems: 'center', gap: '0.75rem' }}>
              <Text size="2">{ROTULO_DESFECHO_GRAFICO[d]}</Text>
              <div style={{ background: 'var(--gray-a3)', borderRadius: 'var(--radius-2)', height: 14, overflow: 'hidden' }}>
                <div style={{ width: `${fracao * 100}%`, minWidth: contagens[d] ? 2 : 0, height: '100%', background: COR[d] }} />
              </div>
              <Text size="2" color="gray" align="right">{contagens[d]} ({formatarPercentual(fracao)})</Text>
            </div>
          )
        })}
      </Flex>
    </div>
  )
}

const LARG = 600
const ALT = 190
const MARGEM = { topo: 10, dir: 10, base: 34, esq: 34 }

export function GraficoHistograma({ faixas, resumo }: { faixas: FaixaHistograma[]; resumo: ResumoValores | null }) {
  if (faixas.length === 0 || !resumo) return null
  const maxQtd = Math.max(...faixas.map(f => f.quantidade))
  const w = LARG - MARGEM.esq - MARGEM.dir
  const h = ALT - MARGEM.topo - MARGEM.base
  const largBarra = w / faixas.length
  const minimo = faixas[0].de
  const maximo = faixas[faixas.length - 1].ate
  const x = (valor: number) => MARGEM.esq + ((valor - minimo) / (maximo - minimo)) * w
  const descricao = `Histograma dos valores de condenação, de ${formatarReais(minimo)} a ${formatarReais(maximo)}; mediana ${formatarReais(resumo.mediana)}.`
  return (
    <div>
      <Titulo>Como os valores se distribuem</Titulo>
      <svg viewBox={`0 0 ${LARG} ${ALT}`} role="img" aria-label={descricao} style={{ width: '100%', maxWidth: 720, height: 'auto' }}>
        <line x1={MARGEM.esq} x2={LARG - MARGEM.dir} y1={MARGEM.topo + h} y2={MARGEM.topo + h} stroke="var(--gray-7)" />
        {faixas.map((f, i) => {
          const alturaBarra = maxQtd ? (f.quantidade / maxQtd) * h : 0
          return (
            <rect key={i} x={MARGEM.esq + i * largBarra + 1} y={MARGEM.topo + h - alturaBarra} width={largBarra - 2} height={alturaBarra} fill="var(--accent-9)" rx={2}>
              <title>{`${formatarReais(f.de)} a ${formatarReais(f.ate)}: ${f.quantidade} sentença(s)`}</title>
            </rect>
          )
        })}
        {[resumo.p25, resumo.p75].map((v, i) => (
          <line key={i} x1={x(v)} x2={x(v)} y1={MARGEM.topo} y2={MARGEM.topo + h} stroke="var(--gray-9)" strokeDasharray="3 3" />
        ))}
        <line x1={x(resumo.mediana)} x2={x(resumo.mediana)} y1={MARGEM.topo} y2={MARGEM.topo + h} stroke="var(--amber-9)" strokeWidth={2} />
        <text x={x(resumo.mediana)} y={ALT - 6} textAnchor="middle" fontSize="11" fill="var(--gray-12)">mediana {formatarReais(resumo.mediana)}</text>
        <text x={MARGEM.esq} y={ALT - 20} textAnchor="start" fontSize="10" fill="var(--gray-11)">{formatarReais(minimo)}</text>
        <text x={LARG - MARGEM.dir} y={ALT - 20} textAnchor="end" fontSize="10" fill="var(--gray-11)">{formatarReais(maximo)}</text>
        <text x={MARGEM.esq - 6} y={MARGEM.topo + 8} textAnchor="end" fontSize="10" fill="var(--gray-11)">{maxQtd}</text>
        <text x={MARGEM.esq - 6} y={MARGEM.topo + h} textAnchor="end" fontSize="10" fill="var(--gray-11)">0</text>
      </svg>
      <Text size="1" color="gray">Linha cheia: mediana. Linhas tracejadas: 25% e 75% das sentenças.</Text>
    </div>
  )
}

function rotuloMes(mes: string): string {
  const [ano, m] = mes.split('-')
  return `${m}/${ano.slice(2)}`
}

export function GraficoSerieMensal({ pontos }: { pontos: PontoMensal[] }) {
  if (pontos.length < 2) return null
  const recorte = pontos.slice(-24)
  const maxTotal = Math.max(...recorte.map(p => p.total))
  const w = LARG - MARGEM.esq - MARGEM.dir
  const h = ALT - MARGEM.topo - MARGEM.base
  const largBarra = w / recorte.length
  const passoRotulo = Math.ceil(recorte.length / 12)
  const descricao = `Sentenças por mês de publicação, de ${rotuloMes(recorte[0].mes)} a ${rotuloMes(recorte[recorte.length - 1].mes)}, divididas por desfecho.`
  return (
    <div>
      <Titulo>Sentenças por mês de publicação</Titulo>
      <svg viewBox={`0 0 ${LARG} ${ALT}`} role="img" aria-label={descricao} style={{ width: '100%', maxWidth: 720, height: 'auto' }}>
        <line x1={MARGEM.esq} x2={LARG - MARGEM.dir} y1={MARGEM.topo + h} y2={MARGEM.topo + h} stroke="var(--gray-7)" />
        {recorte.map((p, i) => {
          let acumulado = 0
          return (
            <g key={p.mes}>
              {DESFECHOS.map(d => {
                const altura = maxTotal ? (p.contagens[d] / maxTotal) * h : 0
                const y = MARGEM.topo + h - acumulado - altura
                acumulado += altura
                return altura > 0 ? (
                  <rect key={d} x={MARGEM.esq + i * largBarra + 1} y={y} width={largBarra - 2} height={altura} fill={COR[d]}>
                    <title>{`${rotuloMes(p.mes)} - ${ROTULO_DESFECHO_GRAFICO[d]}: ${p.contagens[d]}`}</title>
                  </rect>
                ) : null
              })}
              {i % passoRotulo === 0 && (
                <text x={MARGEM.esq + i * largBarra + largBarra / 2} y={ALT - 18} textAnchor="middle" fontSize="10" fill="var(--gray-11)">{rotuloMes(p.mes)}</text>
              )}
            </g>
          )
        })}
        <text x={MARGEM.esq - 6} y={MARGEM.topo + 8} textAnchor="end" fontSize="10" fill="var(--gray-11)">{maxTotal}</text>
        <text x={MARGEM.esq - 6} y={MARGEM.topo + h} textAnchor="end" fontSize="10" fill="var(--gray-11)">0</text>
      </svg>
      <Flex gap="3" wrap="wrap" mt="1">
        {DESFECHOS.map(d => (
          <Flex key={d} align="center" gap="1">
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: COR[d], display: 'inline-block' }} />
            <Text size="1" color="gray">{ROTULO_DESFECHO_GRAFICO[d]}</Text>
          </Flex>
        ))}
      </Flex>
    </div>
  )
}
