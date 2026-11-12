import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatarMoeda } from '../../utils/formatadores'
import type { ResumoInadimplencia } from '../financeiro/dadosResumo'

type Props = {
  carregando: boolean
  /** Dados incompletos (algo falhou ao carregar): não afirmamos "tudo em ordem" nesse caso. */
  incompleto: boolean
  atrasadas: number
  hoje: number
  publicacoes: number | null
  deClientes: number
  /** null quando o perfil não acessa o financeiro ou a consulta falhou. */
  vencido: ResumoInadimplencia | null
  onPeriodo: (periodo: 'atrasadas' | 'hoje') => void
  onPublicacoes: () => void
  onFinanceiro: () => void
}

type Ponto = { chave: string; texto: string; critico?: boolean; ir: () => void }

/** Faixa única no topo de "Meu dia": o que pede ação agora, numa linha, ou "tudo em ordem". */
export default function FaixaAtencao(p: Props) {
  if (p.carregando) return null
  const pontos: Ponto[] = []
  if (p.atrasadas > 0) pontos.push({ chave: 'atrasadas', critico: true, texto: `${p.atrasadas} ${p.atrasadas === 1 ? 'atrasada' : 'atrasadas'}`, ir: () => p.onPeriodo('atrasadas') })
  if (p.hoje > 0) pontos.push({ chave: 'hoje', texto: `${p.hoje} ${p.hoje === 1 ? 'vence hoje' : 'vencem hoje'}`, ir: () => p.onPeriodo('hoje') })
  if (p.publicacoes) {
    const clientes = p.deClientes > 0 ? ` (${p.deClientes} de ${p.deClientes === 1 ? 'cliente' : 'clientes'})` : ''
    pontos.push({ chave: 'publicacoes', critico: p.deClientes > 0, texto: `${p.publicacoes} ${p.publicacoes === 1 ? 'publicação' : 'publicações'} por revisar${clientes}`, ir: p.onPublicacoes })
  }
  if (p.vencido && p.vencido.total_vencido > 0) pontos.push({ chave: 'vencido', texto: `${formatarMoeda(p.vencido.total_vencido)} vencidos a receber`, ir: p.onFinanceiro })

  if (!pontos.length) {
    if (p.incompleto) return null
    return (
      <div className="home-atencao home-atencao--ok" role="status">
        <CheckCircle2 size={18} aria-hidden="true" />
        <span><strong>Tudo em ordem.</strong> Nada atrasado, nada vencendo hoje e nenhuma publicação por revisar.</span>
      </div>
    )
  }
  const critico = pontos.some(x => x.critico)
  return (
    <section className={`home-atencao${critico ? ' home-atencao--critico' : ''}`} aria-label="Precisa da sua atenção">
      <span className="home-atencao-titulo"><AlertTriangle size={16} aria-hidden="true" />Precisa da sua atenção</span>
      <ul className="home-atencao-lista">
        {pontos.map(x => (
          <li key={x.chave}>
            <button type="button" className={`home-atencao-item${x.critico ? ' home-atencao-item--critico' : ''}`} onClick={x.ir}>{x.texto}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
