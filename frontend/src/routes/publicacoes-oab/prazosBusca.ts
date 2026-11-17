import { PRAZOS_PADRAO, type Contagem } from './prazos'
import { PRAZOS_CATALOGO, type PrazoCatalogo, type RamoPrazo } from './prazosCatalogo'

export type PrazoEscolhido = { id: string; rotulo: string; dias: number; base: string; contagem: Contagem; ramo: RamoPrazo }

/** Os 15 mais usados e os prazos fixados em dias das tabelas do CPC, da CLT e do CPP, com a contagem de cada ramo. */
export function buscarPrazo(id: string): PrazoEscolhido | null {
  const padrao = PRAZOS_PADRAO.find(p => p.id === id)
  if (padrao) return { ...padrao, contagem: 'uteis', ramo: 'cpc' }
  const c: PrazoCatalogo | undefined = PRAZOS_CATALOGO.find(p => p.id === id)
  return c ? { id: c.id, rotulo: c.rotulo, dias: c.dias, base: c.base, contagem: c.contagem, ramo: c.ramo } : null
}
