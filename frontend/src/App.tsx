import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Callout, Theme } from '@radix-ui/themes'
import type { LucideIcon } from 'lucide-react'
import {
  Scale, Users, CalendarCheck, CalendarDays, Search, Gavel, Briefcase,
  Newspaper, History, FileSearch, Receipt, KeyRound,
  Settings, Wallet, CreditCard, ShieldCheck, Menu, X,
  ChevronDown, ChevronRight, House, ListChecks, Clock, Puzzle,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { ClienteProvider, useCliente } from './api/ClienteContext'
import { PerfilProvider, usePerfil } from './api/PerfilContext'
import { ModulosProvider, useModulos } from './api/ModulosContext'
import { componenteDoModulo, iconeDoModulo } from './modulos/registro'
import { AvisosProvider } from './Avisos'
import { DialogoSaida } from './AlteracoesPendentes'
import { sincronizarPreferencias } from './utils/listasRapidas'
import { CHAVE_TEMA } from './api/mcpClient'
import Carregamento from './Carregamento'
import LimiteDeErro from './LimiteDeErro'
import BuscaGlobal from './BuscaGlobal'
import ContaUsuario from './ContaUsuario'
import type { AccentColor } from './aparencia'
import CentralNotificacoes from './CentralNotificacoes'
import { NavegacaoProvider, useNavegacao } from './api/NavegacaoContext'
import Acesso from './routes/Acesso'
import Home from './routes/Home'

// Telas carregadas sob demanda: o primeiro acesso baixa só o shell, Início e Acesso.
const Processo = lazy(() => import('./routes/Processo'))
const Publicacoes = lazy(() => import('./routes/Publicacoes'))
const Historico = lazy(() => import('./routes/Historico'))
const Modulos = lazy(() => import('./routes/Modulos'))
const Integracoes = lazy(() => import('./routes/Integracoes'))
const Administracao = lazy(() => import('./routes/Administracao'))
const Financeiro = lazy(() => import('./routes/Financeiro'))
const Pagamentos = lazy(() => import('./routes/Pagamentos'))
const Atividades = lazy(() => import('./routes/Atividades'))
const Agenda = lazy(() => import('./routes/Agenda'))
const PublicacoesOab = lazy(() => import('./routes/PublicacoesOab'))
const Contatos = lazy(() => import('./routes/Contatos'))
const Casos = lazy(() => import('./routes/Casos'))
const ModelosPrazo = lazy(() => import('./routes/ModelosPrazo'))
const HorasPagina = lazy(() => import('./routes/Horas'))
import './app-radix.css'

const CHAVE_ACCENT = 'astrajus-accent'

// Menu organizado pelo que a pessoa faz: o trabalho do dia, a pesquisa avulsa, o financeiro e
// as configurações. "Início" (Meu dia) fica fixo no topo, fora dos grupos. As abas dos módulos
// (Jurisprudência, Jurimetria...) vêm do servidor e entram no grupo que o manifesto indica.
const GRUPOS_BASE = [
  {
    id: 'trabalho', label: 'Trabalho', icone: Briefcase,
    abas: [
      { id: 'casos', label: 'Processos', icone: Scale },
      { id: 'agenda', label: 'Agenda', icone: CalendarDays },
      { id: 'atividades', label: 'Atividades', icone: CalendarCheck },
      { id: 'horas', label: 'Horas', icone: Clock },
      { id: 'publicacoes-oab', label: 'Publicações recebidas', icone: Gavel },
      { id: 'contatos', label: 'Contatos', icone: Users },
    ],
  },
  {
    id: 'pesquisa', label: 'Pesquisa', icone: Search,
    abas: [
      { id: 'processo', label: 'Consultar processo', icone: FileSearch },
      { id: 'publicacoes', label: 'Buscar no DJEN', icone: Newspaper },
      { id: 'historico', label: 'Histórico e favoritos', icone: History },
    ],
  },
  {
    id: 'financeiro', label: 'Financeiro', icone: Wallet,
    abas: [
      { id: 'financeiro', label: 'Lançamentos', icone: Receipt },
      { id: 'pagamentos', label: 'Pagamentos', icone: CreditCard },
    ],
  },
  {
    id: 'configuracoes', label: 'Configurações', icone: Settings,
    abas: [
      { id: 'acesso', label: 'Acesso', icone: KeyRound },
      { id: 'modelos-prazo', label: 'Modelos de prazos', icone: ListChecks },
      { id: 'administracao', label: 'Administração', icone: ShieldCheck },
      { id: 'modulos', label: 'Módulos', icone: Puzzle },
    ],
  },
]

type Grupo = { id: string; label: string; icone: LucideIcon; abas: { id: string; label: string; icone: LucideIcon }[] }

const ABAS_BASE = new Set(['inicio', 'monitoramentos', 'integracoes', 'integracoes/admin', ...GRUPOS_BASE.flatMap(g => g.abas.map(a => a.id))])

// Menu final: grupos fixos mais as abas dos módulos ligados a que a pessoa tem acesso.
function useGruposNavegacao(): Grupo[] {
  const { modulos } = useModulos()
  const { areaPermitida } = usePerfil()
  return useMemo(() => GRUPOS_BASE.map(g => ({
    ...g,
    abas: [
      ...g.abas,
      ...modulos
        .filter(m => m.ativo && m.aba.grupo === g.id && areaPermitida(m.area_permissao))
        .map(m => ({ id: m.aba.id, label: m.aba.rotulo, icone: iconeDoModulo(m.aba.icone) })),
    ],
  })), [modulos, areaPermitida])
}

function SincronizarPreferencias() {
  const { cliente } = useCliente()
  useEffect(() => { void sincronizarPreferencias(cliente?.token ?? null) }, [cliente])
  return null
}

// Descarta o cache de dados ao trocar ou encerrar a sessão, para não manter dados de outro usuário.
function LimpaCacheAoTrocarSessao() {
  const { cliente } = useCliente()
  const queryClient = useQueryClient()
  const token = cliente?.token
  useEffect(() => () => queryClient.clear(), [queryClient, token])
  return null
}

function StatusConexao() {
  const { status } = useCliente()
  const cores: Record<string, string> = {
    conectado: 'var(--green-9)',
    'nao-conectado': 'var(--red-9)',
    verificando: 'var(--yellow-9)',
    'sem-token': 'var(--gray-8)',
  }
  const labels: Record<string, string> = {
    conectado: 'Conectado',
    'nao-conectado': 'Desconectado',
    verificando: 'Verificando…',
    'sem-token': 'Sem token',
  }
  return (
    <div className="aj-status-pill" role="status" aria-label={`Conexão: ${labels[status] ?? status}`} title={labels[status] ?? status}>
      <span className="aj-status-dot" aria-hidden="true" style={{ background: cores[status] ?? cores['sem-token'] }} />
      <span className="aj-status-texto" aria-hidden="true">{labels[status] ?? status}</span>
    </div>
  )
}

function SemAcesso({ texto }: { texto: string }) {
  return (
    <Callout.Root color="gray" role="status">
      <Callout.Icon><ShieldCheck size={14} /></Callout.Icon>
      <Callout.Text>{texto}</Callout.Text>
    </Callout.Root>
  )
}

function ConteudoAba({ abaAtiva }: { abaAtiva: string }) {
  const { abaPermitida, areaPermitida } = usePerfil()
  const { modulos, carregado } = useModulos()
  const modulo = modulos.find(m => m.aba.id === abaAtiva)
  if (modulo) {
    if (!areaPermitida(modulo.area_permissao)) return <SemAcesso texto="Seu perfil não tem acesso a esta área. Peça ao administrador para liberar." />
    if (!modulo.ativo) return <SemAcesso texto={`O módulo ${modulo.nome} está desativado. Um administrador pode ativá-lo em Configurações › Módulos.`} />
    const Tela = componenteDoModulo(modulo.id)
    return Tela ? <Tela /> : <SemAcesso texto={`O módulo ${modulo.nome} não tem tela nesta versão do aplicativo.`} />
  }
  // Link direto para a tela de um módulo: espera o servidor dizer quais módulos existem.
  if (!carregado && !ABAS_BASE.has(abaAtiva)) return <Carregamento tipo="detalhe" descricao="Carregando tela…" />
  if (!abaPermitida(abaAtiva)) {
    return <SemAcesso texto="Seu perfil não tem acesso a esta área. Peça ao administrador para liberar." />
  }
  switch (abaAtiva) {
    case 'inicio': return <Home />
    case 'administracao': return <Administracao />
    case 'modelos-prazo': return <ModelosPrazo />
    case 'horas': return <HorasPagina />
    case 'acesso': return <Acesso />
    case 'processo': return <Processo />
    case 'publicacoes': return <Publicacoes />
    case 'historico': return <Historico />
    case 'monitoramentos': return <PublicacoesOab />
    case 'modulos': return <Modulos />
    case 'integracoes/admin': return <Integracoes />
    case 'integracoes': return <Integracoes />  // atalho: administradores vão para Administração › Integrações
    case 'financeiro': return <Financeiro />
    case 'pagamentos': return <Pagamentos />
    case 'atividades': return <Atividades />
    case 'agenda': return <Agenda />
    case 'publicacoes-oab': return <PublicacoesOab />
    case 'contatos': return <Contatos />
    case 'casos': return <Casos />
    default:
      // Rotas desconhecidas (inclusive links antigos) voltam para o início.
      return <Home />
  }
}

function SidebarAstraJus({ aberta, fechar }: { aberta: boolean; fechar: () => void }) {
  const { abaAtiva, irPara } = useNavegacao()
  const { abaPermitida } = usePerfil()
  const grupos = useGruposNavegacao()
  const gruposVisiveis = grupos
    .map(g => ({ ...g, abas: g.abas.filter(a => abaPermitida(a.id)) }))
    .filter(g => g.abas.length > 0)
  // Só guarda o que a pessoa abriu ou fechou; sem escolha, o grupo da página atual fica aberto.
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({})
  // Monitoramentos é uma aba de Publicações recebidas: destaca esse item no menu.
  const abaMenu = abaAtiva === 'monitoramentos' ? 'publicacoes-oab' : abaAtiva
  const grupoAberto = (g: Grupo) => gruposAbertos[g.id] ?? g.abas.some((a) => a.id === abaMenu)

  function toggleGrupo(id: string) {
    const grupo = grupos.find((g) => g.id === id)!
    setGruposAbertos((prev) => ({ ...prev, [id]: !grupoAberto(grupo) }))
  }

  function navegar(abaId: string) {
    irPara(abaId)
    if (window.innerWidth < 1056) fechar()
  }

  return (
    <>
      {aberta && window.innerWidth < 1056 && (
        <div className="aj-overlay" onClick={fechar} />
      )}
      <nav className={`aj-sidebar${aberta ? ' aj-sidebar--open' : ''}`} aria-label="Navegação principal">
        <a
          href="#/inicio"
          className={`aj-nav-inicio${abaAtiva === 'inicio' ? ' aj-nav-inicio--ativo' : ''}`}
          aria-current={abaAtiva === 'inicio' ? 'page' : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            navegar('inicio')
          }}
        >
          <House size={15} />
          Início
        </a>
        {gruposVisiveis.map((grupo) => {
          const GrupoIcon = grupo.icone
          const aberto = grupoAberto(grupo)
          return (
            <div key={grupo.id} className="aj-nav-group">
              <button
                className={`aj-nav-group-btn${grupo.abas.some((a) => a.id === abaMenu) ? ' aj-nav-group-btn--ativo' : ''}`}
                onClick={() => toggleGrupo(grupo.id)}
                aria-expanded={aberto}
              >
                <GrupoIcon size={15} />
                <span>{grupo.label}</span>
                {aberto ? <ChevronDown size={13} className="aj-chevron" /> : <ChevronRight size={13} className="aj-chevron" />}
              </button>
              {aberto && (
                <div className="aj-nav-items">
                  {grupo.abas.map((aba) => {
                    const AbaIcon = aba.icone
                    return (
                      <a
                        key={aba.id}
                        href={`#/${aba.id}`}
                        className={`aj-nav-item${aba.id === abaMenu ? ' aj-nav-item--ativo' : ''}`}
                        aria-current={aba.id === abaMenu ? 'page' : undefined}
                        onClick={(e) => {
                          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
                          e.preventDefault()
                          navegar(aba.id)
                        }}
                      >
                        <AbaIcon size={14} />
                        {aba.label}
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </>
  )
}

function accentSalvo(): AccentColor {
  try {
    const v = localStorage.getItem(CHAVE_ACCENT)
    if (v === 'indigo' || v === 'violet' || v === 'teal' || v === 'crimson') return v
  } catch { /* noop */ }
  return 'indigo'
}

function temaSalvo(): 'light' | 'dark' {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'g100' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export default function App() {
  const [aparencia, setAparencia] = useState<'light' | 'dark'>(temaSalvo)
  const [accent, setAccent] = useState<AccentColor>(accentSalvo)
  const [navAberta, setNavAberta] = useState(() => window.matchMedia('(min-width: 1056px)').matches)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1056px)')
    const resize = () => setNavAberta(media.matches)
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(CHAVE_TEMA, aparencia === 'dark' ? 'g100' : 'white') } catch { /* noop */ }
  }, [aparencia])

  useEffect(() => {
    try { localStorage.setItem(CHAVE_ACCENT, accent) } catch { /* noop */ }
  }, [accent])

  return (
    <Theme accentColor={accent} grayColor="slate" radius="medium" appearance={aparencia}>
      <AvisosProvider>
      <ClienteProvider>
        <LimpaCacheAoTrocarSessao />
        <PerfilProvider>
        <ModulosProvider>
        <SincronizarPreferencias />
        <DialogoSaida />
        <NavegacaoProvider abaInicial="inicio">
          <div className="aj-shell">
            {/* Topbar */}
            <header className="aj-topbar">
              <button
                className="aj-ib"
                aria-label={navAberta ? 'Fechar menu' : 'Abrir menu'}
                onClick={() => setNavAberta((v) => !v)}
              >
                {navAberta ? <X size={18} /> : <Menu size={18} />}
              </button>
              <a href="#/inicio" className="aj-logo">Astra<span>Jus</span></a>

              <div className="aj-topbar-right">
                <StatusConexao />
                <BuscaPaginas />
                <CentralNotificacoes />

                <ContaUsuario aparencia={aparencia} setAparencia={setAparencia} accent={accent} setAccent={setAccent} />
              </div>
            </header>

            <div className="aj-body">
              <SidebarAstraJus aberta={navAberta} fechar={() => setNavAberta(false)} />
              <main id="main-content" className="aj-content" tabIndex={-1}>
                <NavConteudo />
              </main>
            </div>
          </div>
        </NavegacaoProvider>
        </ModulosProvider>
        </PerfilProvider>
      </ClienteProvider>
      </AvisosProvider>
    </Theme>
  )
}

function BuscaPaginas() {
  const grupos = useGruposNavegacao()
  return <BuscaGlobal paginas={[{ id: 'inicio', label: 'Início', grupo: '' }, ...grupos.flatMap(g => g.abas.map(a => ({ id: a.id, label: a.label, grupo: g.label })))]} />
}

function NavConteudo() {
  const { abaAtiva } = useNavegacao()
  const { modulos, carregado } = useModulos()
  // Endereço de tela inexistente (link antigo ou digitado errado) vira o início, na URL também.
  // 'integracoes' e 'integracoes/admin' não estão no menu, mas seguem valendo como atalhos de links antigos.
  // Telas de módulo (mesmo desativado) só são conhecidas depois que o servidor responde.
  const conhecida = ABAS_BASE.has(abaAtiva) || modulos.some(m => m.aba.id === abaAtiva)
  useEffect(() => { if (carregado && !conhecida) window.location.replace('#/inicio') }, [abaAtiva, carregado, conhecida])
  return (
    <LimiteDeErro key={abaAtiva}>
      <Suspense fallback={<Carregamento tipo="detalhe" descricao="Carregando tela…" />}>
        <ConteudoAba abaAtiva={abaAtiva} />
      </Suspense>
    </LimiteDeErro>
  )
}
