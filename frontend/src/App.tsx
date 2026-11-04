import { useEffect, useState } from 'react'
import { Theme } from '@radix-ui/themes'
import {
  Scale, Users, CalendarCheck, Folder, Search,
  Newspaper, BarChart2, BookOpen, Bell, ClipboardList,
  Settings, Link, Wallet, CreditCard, Shield, Menu, X,
  Sun, Moon, ChevronDown, ChevronRight,
} from 'lucide-react'
import { ClienteProvider, useCliente } from './api/ClienteContext'
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

const GRUPOS_NAVEGACAO = [
  {
    id: 'escritorio', label: 'Escritório', icone: Scale,
    abas: [
      { id: 'casos', label: 'Processos', icone: Scale },
      { id: 'contatos', label: 'Contatos', icone: Users },
      { id: 'atividades', label: 'Atividades', icone: CalendarCheck },
      { id: 'pastas', label: 'Pastas', icone: Folder },
    ],
  },
  {
    id: 'consultas', label: 'Consultas', icone: Search,
    abas: [
      { id: 'processo', label: 'Consultar processo', icone: Search },
      { id: 'publicacoes', label: 'Publicações', icone: Newspaper },
      { id: 'jurimetria', label: 'Jurimetria', icone: BarChart2 },
      { id: 'jurisprudencia', label: 'Jurisprudência', icone: BookOpen },
      { id: 'historico', label: 'Histórico', icone: ClipboardList },
    ],
  },
  {
    id: 'acompanhamento', label: 'Acompanhamento', icone: Bell,
    abas: [
      { id: 'monitoramentos', label: 'Monitoramentos', icone: Bell },
      { id: 'publicacoes-oab', label: 'Publicações OAB', icone: ClipboardList },
    ],
  },
  {
    id: 'financeiro', label: 'Financeiro', icone: Wallet,
    abas: [
      { id: 'financeiro', label: 'Lançamentos', icone: Wallet },
      { id: 'pagamentos', label: 'Pagamentos', icone: CreditCard },
    ],
  },
  {
    id: 'configuracoes', label: 'Configurações', icone: Settings,
    abas: [
      { id: 'acesso', label: 'Acesso', icone: Shield },
      { id: 'integracoes', label: 'Integrações', icone: Link },
      { id: 'administracao', label: 'Administração', icone: Settings },
    ],
  },
]

const ABAS = GRUPOS_NAVEGACAO.flatMap((g) => g.abas)

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
      return (
        <div style={{ padding: '2rem' }}>
          <h1>{ABAS.find((a) => a.id === abaAtiva)?.label ?? abaAtiva}</h1>
          <p>Ainda não migrada.</p>
        </div>
      )
  }
}

function SidebarAstraJus({ aberta, fechar }: { aberta: boolean; fechar: () => void }) {
  const { abaAtiva, irPara } = useNavegacao()
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GRUPOS_NAVEGACAO.map((g) => [g.id, g.abas.some((a) => a.id === abaAtiva)]))
  )

  function toggleGrupo(id: string) {
    setGruposAbertos((prev) => ({ ...prev, [id]: !prev[id] }))
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
        {GRUPOS_NAVEGACAO.map((grupo) => {
          const GrupoIcon = grupo.icone
          const aberto = gruposAbertos[grupo.id]
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

  const ACCENTS: { key: AccentColor; label: string; cor: string }[] = [
    { key: 'indigo',  label: 'Índigo',   cor: 'var(--indigo-9)' },
    { key: 'violet',  label: 'Violeta',  cor: 'var(--violet-9)' },
    { key: 'teal',    label: 'Teal',     cor: 'var(--teal-9)' },
    { key: 'crimson', label: 'Carmesim', cor: 'var(--crimson-9)' },
  ]

  return (
    <Theme accentColor={accent} grayColor="slate" radius="medium" appearance={aparencia}>
      <ClienteProvider>
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

                {/* Seletor de accent */}
                <div className="aj-accent-picker" role="group" aria-label="Escolher tema de cor">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.key}
                      className={`aj-accent-dot${accent === a.key ? ' aj-accent-dot--sel' : ''}`}
                      style={{ background: a.cor }}
                      title={a.label}
                      aria-label={a.label}
                      aria-pressed={accent === a.key}
                      onClick={() => setAccent(a.key)}
                    />
                  ))}
                </div>

                {/* Toggle claro/escuro */}
                <button
                  className="aj-ib"
                  aria-label="Alternar tema"
                  onClick={() => setAparencia((v) => v === 'light' ? 'dark' : 'light')}
                >
                  {aparencia === 'light' ? <Moon size={17} /> : <Sun size={17} />}
                </button>

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
    </Theme>
  )
}

function NavConteudo() {
  const { abaAtiva } = useNavegacao()
  return <ConteudoAba abaAtiva={abaAtiva} />
}
