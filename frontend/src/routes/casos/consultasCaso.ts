// Consultas por processo compartilhadas entre as abas e a Linha do tempo: a mesma chave e a mesma
// função de busca, então os dados vêm do cache em vez de serem buscados duas vezes.
import { buscarJson } from '../../api/rest'
import type { ClienteMCP } from '../../api/mcpClient'
import type { PublicacaoOab } from '../publicacoes-oab/dados'
import type { Atividade } from './AtividadesCaso'

export type Movimento = { numero: string; grau?: string; nome?: string; dataHora?: string }
export type Capa = { grau?: string | null; movimentos?: Array<{ nome?: string; dataHora?: string; grau?: string }> | null; atualizado_em?: string | null }
export type Fonte = { tipo: 'capa' | 'datajud'; quando?: string | null }
export type VinculoCaso = { caso_id: string; titulo?: string; cliente_nome?: string; acao?: string; tipo: string; criado_em?: string | null }
export type AtividadeResumo = { id: string | number; titulo: string; origem_djen_hash?: string | null }

/** Mesmo andamento (processo, instância, data e texto) mostrado uma vez só. */
export function semRepetidos(lista: Movimento[]): Movimento[] {
  const vistos = new Set<string>()
  return lista.filter(m => {
    const chave = [m.numero, m.grau, m.dataHora, m.nome].join('|')
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })
}
export function rotuloGrau(grau?: string | null) {
  const g = (grau || '').toUpperCase()
  if (g === 'G1') return '1º grau'
  if (g === 'G2') return '2º grau'
  if (g === 'JE') return 'Juizado'
  if (g === 'TR') return 'Turma recursal'
  if (g === 'SUP') return 'Tribunal superior'
  return grau || 'Grau não informado'
}

/** Movimentos já gravados na capa de cada número do processo (sem chamada externa). */
export const consultaMovimentacoes = (cliente: ClienteMCP | null, casoId: string) => ({
  queryKey: ['caso-movimentacoes', cliente?.token, casoId],
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const caso = await buscarJson<{ processos?: string[] }>(cliente, `/casos/${casoId}`, signal)
    const numeros = caso.processos ?? []
    const todasMovs: Movimento[] = []
    let atualizado: string | null = null
    for (const n of numeros) {
      try {
        const capa = await buscarJson<Capa>(cliente, `/casos/${casoId}/processos/${n}/capa`, signal)
        // Cada andamento guarda a própria instância; sem ela, vale a da capa.
        for (const m of capa.movimentos ?? []) todasMovs.push({ numero: n, grau: rotuloGrau(m.grau || capa.grau), nome: m.nome, dataHora: m.dataHora })
        if (capa.atualizado_em && (!atualizado || capa.atualizado_em > atualizado)) atualizado = capa.atualizado_em
      } catch { /* número sem capa gravada: segue para o próximo */ }
    }
    return { numeros, movimentos: semRepetidos(todasMovs), fonte: { tipo: 'capa', quando: atualizado } as Fonte }
  },
})

export const consultaAtividades = (cliente: ClienteMCP | null, casoId: string) => ({
  queryKey: ['caso-atividades', cliente?.token, casoId],
  queryFn: ({ signal }: { signal: AbortSignal }) => buscarJson<{ atividades: Atividade[]; agenda_disponivel?: boolean }>(cliente, `/casos/${casoId}/atividades`, signal)
    .then(r => ({ atividades: r.atividades ?? [], agendaDisponivel: Boolean(r.agenda_disponivel) })),
})

export const consultaPublicacoes = (cliente: ClienteMCP | null, casoId: string) => ({
  queryKey: ['caso-publicacoes', cliente?.token, casoId],
  queryFn: ({ signal }: { signal: AbortSignal }) => Promise.all([
    buscarJson<{ publicacoes: PublicacaoOab[] }>(cliente, `/casos/${casoId}/publicacoes`, signal),
    // Só para mostrar qual atividade nasceu de cada publicação; falha não impede a lista.
    buscarJson<{ atividades: AtividadeResumo[] }>(cliente, `/casos/${casoId}/atividades`, signal).catch(() => ({ atividades: [] as AtividadeResumo[] })),
  ]).then(([r, ra]) => ({ publicacoes: r.publicacoes ?? [], atividades: ra.atividades ?? [] })),
})

export const consultaVinculos = (cliente: ClienteMCP | null, casoId: string) => ({
  queryKey: ['caso-vinculos', cliente?.token, casoId],
  queryFn: ({ signal }: { signal: AbortSignal }) => buscarJson<{ vinculos: VinculoCaso[] }>(cliente, `/casos/${casoId}/vinculos`, signal).then(r => r.vinculos ?? []),
})
