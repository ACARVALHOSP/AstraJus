import { useEffect, useState } from 'react'
import { Flex, Popover, SegmentedControl, Text, Theme } from '@radix-ui/themes'
import {
  Scale, Users, CalendarCheck, Search, Gavel, Briefcase,
  Newspaper, BarChart2, BookOpen, BellRing, History, FileSearch, Receipt, KeyRound,
  Settings, Link, Wallet, CreditCard, ShieldCheck, Menu, X,
  Palette, ChevronDown, ChevronRight, Check, House,
} from 'lucide-react'
import { ClienteProvider, useCliente } from './api/ClienteContext'
import { AvisosProvider } from './Avisos'
import { sincronizarPreferencias } from './utils/listasRapidas'
import { CHAVE_TEMA } from './api/mcpClient'
import BuscaGlobal from './BuscaGlobal'
import ContaUsuario from './ContaUsuario'
import CentralNotificacoes from './CentralNotificacoes'
import { NavegacaoProvider, useNavegacao } from './api/NavegacaoContext'
import Acesso from './routes/Acesso'
import Processo from './routes/Processo'
import Publicacoes from './routes/Publicacoes'
import Historico from './routes/Historico'
import Monitoramentos from './routes/Monitoramentos'
import Jurimetria from './routes/Jurimetria'
import Jurisprudencia from './routes/Jurisprudencia'
import Integracoes from './routes/Integracoes'
import Administracao from './routes/Administracao'
import Financeiro from './routes/Financeiro'
import Pagamentos from './routes/Pagamentos'
import Atividades from './routes/Atividades'
import PublicacoesOab from './routes/PublicacoesOab'
import Contatos from './routes/Contatos'
import Casos from './routes/Casos'
import Home from './routes/Home'
import './app-radix.css'

export type AccentColor = 'indigo' | 'violet' | 'teal' | 'crimson'

const CHAVE_ACCENT = 'astrajus-accent'

// Menu organizado pelo que a pessoa faz: o trabalho do dia, a pesquisa avulsa, o financeiro e
// as configurações. "Início" (Meu dia) fica fixo no topo, fora dos grupos.
const GRUPOS_NAVEGACAO = [
  {
    id: 'trabalho', label: 'Trabalho', icone: Briefcase,
    abas: [
      { id: 'casos', label: 'Processos', icone: Scale },
      { id: 'atividades', label: 'Atividades', icone: CalendarCheck },
      { id: 'publicacoes-oab', label: 'Publicações recebidas', icone: Gavel },
      { id: 'monitoramentos', label: 'Monitoramentos', icone: BellRing },
      { id: 'contatos', label: 'Contatos', icone: Users },
    ],
  },
  {
    id: 'pesquisa', label: 'Pesquisa', icone: Search,
    abas: [
      { id: 'processo', label: 'Consultar processo', icone: FileSearch },
      { id: 'publicacoes', label: 'Buscar no DJEN', icone: Newspaper },
      { id: 'jurisprudencia', label: 'Jurisprudência', icone: BookOpen },
      { id: 'jurimetria', label: 'Jurimetria', icone: BarChart2 },
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
      { id: 'integracoes', label: 'Integrações', icone: Link },
      { id: 'administracao', label: 'Administração', icone: ShieldCheck },
    ],
  },
]

function SincronizarPreferencias() {
  const { cliente } = useCliente()
  useEffect(() => { void sincronizarPreferencias(cliente?.token ?? null) }, [cliente])
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
    <div className="aj-status-pill">
      <span className="aj-status-dot" style={{ background: cores[status] ?? cores['sem-token'] }} />
      <span>{labels[status] ?? status}</span>
    </div>
  )
}

function ConteudoAba({ abaAtiva }: { abaAtiva: string }) {
  switch (abaAtiva) {
    case 'inicio': return <Home />
    case 'administracao': return <Administracao />
    case 'acesso': return <Acesso />
    case 'processo': return <Processo />
    case 'publicacoes': return <Publicacoes />
    case 'historico': return <Historico />
    case 'monitoramentos': return <Monitoramentos />
    case 'jurimetria': return <Jurimetria />
    case 'jurisprudencia': return <Jurisprudencia />
    case 'integracoes': return <Integracoes />
    case 'financeiro': return <Financeiro />
    case 'pagamentos': return <Pagamentos />
    case 'atividades': return <Atividades />
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
  // Só guarda o que a pessoa abriu ou fechou; sem escolha, o grupo da página atual fica aberto.
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({})
  const grupoAberto = (g: typeof GRUPOS_NAVEGACAO[number]) => gruposAbertos[g.id] ?? g.abas.some((a) => a.id === abaAtiva)

  function toggleGrupo(id: string) {
    const grupo = GRUPOS_NAVEGACAO.find((g) => g.id === id)!
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
        {GRUPOS_NAVEGACAO.map((grupo) => {
          const GrupoIcon = grupo.icone
          const aberto = grupoAberto(grupo)
          return (
            <div key={grupo.id} className="aj-nav-group">
              <button
                className={`aj-nav-group-btn${grupo.abas.some((a) => a.id === abaAtiva) ? ' aj-nav-group-btn--ativo' : ''}`}
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
                        className={`aj-nav-item${aba.id === abaAtiva ? ' aj-nav-item--ativo' : ''}`}
                        aria-current={aba.id === abaAtiva ? 'page' : undefined}
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

const ACCENTS: { key: AccentColor; label: string; cor: string }[] = [
  { key: 'indigo',  label: 'Índigo',   cor: 'var(--indigo-9)' },
  { key: 'violet',  label: 'Violeta',  cor: 'var(--violet-9)' },
  { key: 'teal',    label: 'Verde-azulado', cor: 'var(--teal-9)' },
  { key: 'crimson', label: 'Carmesim', cor: 'var(--crimson-9)' },
]

function SeletorAparencia({ accent, setAccent, aparencia, setAparencia }: {
  accent: AccentColor
  setAccent: (a: AccentColor) => void
  aparencia: 'light' | 'dark'
  setAparencia: (a: 'light' | 'dark') => void
}) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <button type="button" className="aj-ib" aria-label="Aparência" title="Aparência">
          <Palette size={17} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Content width="240px" align="end">
        <Flex direction="column" gap="3">
          <Flex direction="column" gap="2">
            <Text as="p" size="1" weight="medium" color="gray">Tema</Text>
            <SegmentedControl.Root
              size="1"
              value={aparencia}
              onValueChange={(v) => setAparencia(v as 'light' | 'dark')}
              aria-label="Tema"
            >
              <SegmentedControl.Item value="light">Claro</SegmentedControl.Item>
              <SegmentedControl.Item value="dark">Escuro</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
          <Flex direction="column" gap="2">
            <Text as="p" size="1" weight="medium" color="gray">Cor de destaque</Text>
            <div className="aj-accent-picker" role="radiogroup" aria-label="Cor de destaque">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  className="aj-accent-dot"
                  style={{ background: a.cor }}
                  title={a.label}
                  aria-label={a.label}
                  aria-checked={accent === a.key}
                  onClick={() => setAccent(a.key)}
                >
                  {accent === a.key && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
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
        <SincronizarPreferencias />
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
                <BuscaGlobal />
                <CentralNotificacoes />

                <SeletorAparencia
                  accent={accent}
                  setAccent={setAccent}
                  aparencia={aparencia}
                  setAparencia={setAparencia}
                />

                <ContaUsuario />
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
      </ClienteProvider>
      </AvisosProvider>
    </Theme>
  )
}

function NavConteudo() {
  const { abaAtiva } = useNavegacao()
  return <ConteudoAba abaAtiva={abaAtiva} />
}
