import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCliente } from './ClienteContext'

// Áreas que o administrador pode liberar ou restringir por pessoa. O servidor é quem recusa o
// acesso; aqui só se esconde o que a pessoa não pode usar, para o menu não prometer o que falha.
export type Grau = 'nenhum' | 'ver' | 'editar'
export const AREAS: Record<string, string> = {
  casos: 'Processos', atividades: 'Atividades', publicacoes_oab: 'Publicações recebidas', contatos: 'Contatos',
  pesquisa: 'Pesquisa (processo, DJEN, jurisprudência, jurimetria)', financeiro: 'Lançamentos',
  pagamentos: 'Pagamentos', integracoes: 'Integrações',
}
const ABA_AREA: Record<string, string> = {
  casos: 'casos', atividades: 'atividades', agenda: 'atividades', 'modelos-prazo': 'atividades', horas: 'atividades', 'publicacoes-oab': 'publicacoes_oab', monitoramentos: 'publicacoes_oab',
  contatos: 'contatos', processo: 'pesquisa', publicacoes: 'pesquisa', jurisprudencia: 'pesquisa',
  jurimetria: 'pesquisa', financeiro: 'financeiro', pagamentos: 'pagamentos', integracoes: 'integracoes',
}

type Dados = { login: string | null; nome: string | null; email: string; foto: string; nivel: string; permissoes: Record<string, Grau> }
type Valor = { login: string | null; nome: string | null; email: string; foto: string; atualizarPerfil: (novos: Partial<Pick<Dados, 'nome' | 'email' | 'foto'>>) => void; nivel: string | null; permissoes: Record<string, Grau> | null; abaPermitida: (aba: string) => boolean; podeEditar: (area: string) => boolean }
const PerfilContext = createContext<Valor | null>(null)

export function PerfilProvider({ children }: { children: ReactNode }) {
  const { cliente } = useCliente()
  const [perfil, setPerfil] = useState<Dados | null>(null)

  useEffect(() => {
    if (!cliente) return
    const controlador = new AbortController()
    void fetch('/responsaveis/me', { headers: { Authorization: `Bearer ${cliente.token}` }, cache: 'no-store', signal: controlador.signal })
      .then(async r => {
        if (!r.ok) throw new Error('Perfil indisponível')
        const d = await r.json() as { usuario: { login?: string; nome_completo?: string; email?: string; foto?: string; nivel_acesso: string; permissoes?: Record<string, Grau> } }
        if (!controlador.signal.aborted) setPerfil({ login: d.usuario.login ?? null, nome: d.usuario.nome_completo ?? null, email: d.usuario.email ?? '', foto: d.usuario.foto ?? '', nivel: d.usuario.nivel_acesso, permissoes: d.usuario.permissoes ?? {} })
      })
      .catch(() => { if (!controlador.signal.aborted) setPerfil(null) })
    return () => { controlador.abort(); setPerfil(null) }
  }, [cliente])

  const valor = useMemo<Valor>(() => ({
    login: perfil?.login ?? null,
    nome: perfil?.nome ?? null,
    email: perfil?.email ?? '',
    foto: perfil?.foto ?? '',
    atualizarPerfil: novos => setPerfil(atual => atual && { ...atual, ...novos }),
    nivel: perfil?.nivel ?? null,
    permissoes: perfil?.permissoes ?? null,
    // Sem perfil carregado nada é escondido; o servidor continua recusando o que não é permitido.
    abaPermitida: aba => {
      if (!perfil) return true
      if (aba === 'administracao' || aba === 'integracoes/admin') return perfil.nivel === 'administrador'
      const area = ABA_AREA[aba]
      return !area || (perfil.permissoes[area] ?? 'editar') !== 'nenhum'
    },
    podeEditar: area => !perfil || (perfil.permissoes[area] ?? 'editar') === 'editar',
  }), [perfil])

  return <PerfilContext.Provider value={valor}>{children}</PerfilContext.Provider>
}

export function usePerfil(): Valor {
  const v = useContext(PerfilContext)
  if (!v) throw new Error('usePerfil fora do PerfilProvider')
  return v
}
