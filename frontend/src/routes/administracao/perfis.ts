// Perfis prontos de acesso: preenchem o nível e a matriz de áreas que o servidor já entende.
// Nenhum nível novo existe no servidor; um perfil pronto é só um atalho para um conjunto de permissões.

export type Grau = 'nenhum' | 'ver' | 'editar'
export type Nivel = 'administrador' | 'operador' | 'consulta'

/** As áreas liberáveis por pessoa (mesmos ids do servidor). */
export const AREAS_IDS = ['casos', 'atividades', 'publicacoes_oab', 'contatos', 'pesquisa', 'financeiro', 'pagamentos', 'integracoes'] as const

export type PerfilPronto = {
  id: string; rotulo: string; nivel: Nivel; descricao: string
  /** Acesso de cada área (as que não aparecem seguem o padrão do nível). */
  areas: Partial<Record<(typeof AREAS_IDS)[number], Grau>>
}

export const NIVEIS: Record<Nivel, { rotulo: string; descricao: string; cor: 'red' | 'violet' | 'gray' }> = {
  administrador: { rotulo: 'Administrador', cor: 'red', descricao: 'Acesso total ao sistema, inclusive Administração, financeiro e integrações.' },
  operador: { rotulo: 'Operador', cor: 'violet', descricao: 'Altera dados nas áreas liberadas. Por padrão acessa todas; restrinja por área ou use um perfil pronto.' },
  consulta: { rotulo: 'Consulta', cor: 'gray', descricao: 'Apenas consulta o que foi liberado; não cria nem altera nada.' },
}

export const PERFIS: PerfilPronto[] = [
  { id: 'administrador', rotulo: 'Administrador', nivel: 'administrador', areas: {}, descricao: 'Acesso total, inclusive Administração.' },
  { id: 'advogado', rotulo: 'Advogado', nivel: 'operador', descricao: 'Processos, atividades, publicações, contatos e pesquisa. Sem financeiro nem integrações.',
    areas: { casos: 'editar', atividades: 'editar', publicacoes_oab: 'editar', contatos: 'editar', pesquisa: 'editar', financeiro: 'nenhum', pagamentos: 'nenhum', integracoes: 'nenhum' } },
  { id: 'secretaria', rotulo: 'Secretaria', nivel: 'operador', descricao: 'Atendimento, agenda e contatos; só consulta processos e publicações. Sem financeiro.',
    areas: { casos: 'ver', atividades: 'editar', publicacoes_oab: 'ver', contatos: 'editar', pesquisa: 'ver', financeiro: 'nenhum', pagamentos: 'nenhum', integracoes: 'nenhum' } },
  { id: 'financeiro', rotulo: 'Financeiro', nivel: 'operador', descricao: 'Lançamentos, pagamentos e honorários; consulta contatos. Sem acesso a processos.',
    areas: { casos: 'nenhum', atividades: 'nenhum', publicacoes_oab: 'nenhum', contatos: 'ver', pesquisa: 'nenhum', financeiro: 'editar', pagamentos: 'editar', integracoes: 'nenhum' } },
  { id: 'consulta', rotulo: 'Somente consulta', nivel: 'consulta', areas: {}, descricao: 'Consulta tudo o que o nível permite, sem criar nem alterar.' },
]

/** O que o nível permite quando nada foi personalizado (igual ao servidor). */
export const grauPadrao = (nivel: string): Grau => (nivel === 'consulta' ? 'ver' : 'editar')

/** Acesso efetivo de uma área: o personalizado ou o padrão do nível (consulta nunca passa de "ver"). */
export function grauEfetivo(nivel: string, permissoes: Record<string, Grau> | undefined, area: string): Grau {
  if (nivel === 'administrador') return 'editar'
  const grau = permissoes?.[area] ?? grauPadrao(nivel)
  return nivel === 'consulta' && grau === 'editar' ? 'ver' : grau
}

/** Nível e permissões (só o que difere do padrão do nível, como o servidor espera) de um perfil pronto. */
export function aplicarPerfil(perfil: PerfilPronto): { nivel_acesso: Nivel; permissoes: Record<string, Grau> } {
  const padrao = grauPadrao(perfil.nivel)
  const permissoes: Record<string, Grau> = {}
  if (perfil.nivel !== 'administrador') {
    for (const area of AREAS_IDS) {
      const grau = perfil.areas[area]
      if (grau !== undefined && grau !== padrao) permissoes[area] = grau
    }
  }
  return { nivel_acesso: perfil.nivel, permissoes }
}

/** Qual perfil pronto corresponde ao acesso atual, ou null se foi personalizado. */
export function perfilDe(nivel: string, permissoes: Record<string, Grau> | undefined): PerfilPronto | null {
  return PERFIS.find(p => {
    if (p.nivel !== nivel) return false
    if (nivel === 'administrador') return true
    return AREAS_IDS.every(area => grauEfetivo(nivel, permissoes, area) === grauEfetivo(p.nivel, aplicarPerfil(p).permissoes, area))
  }) ?? null
}
