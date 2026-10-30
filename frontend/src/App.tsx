import { useEffect, useState } from 'react'
import {
  Content,
  SkipToContent,
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  HeaderMenuButton,
  SideNav,
  SideNavItems,
  SideNavMenu,
  SideNavMenuItem,
  Tag,
  Theme,
} from '@carbon/react'
import { Asleep, Light } from '@carbon/icons-react'
import { Enterprise } from "@carbon/icons-react";
import { Search } from "@carbon/icons-react";
import { Notification } from "@carbon/icons-react";
import { Currency } from "@carbon/icons-react";
import { Settings } from "@carbon/icons-react";
import { ClienteProvider, useCliente } from './api/ClienteContext'
import { CHAVE_TEMA } from './api/mcpClient'
import BuscaGlobal from './BuscaGlobal'
import CentralNotificacoes from './CentralNotificacoes'
import { NavegacaoProvider, useNavegacao } from './api/NavegacaoContext'
import Acesso from './routes/Acesso'
import Processo from './routes/Processo'
import Publicacoes from './routes/Publicacoes'
import Historico from './routes/Historico'
import Monitoramentos from './routes/Monitoramentos'
import Jurimetria from './routes/Jurimetria'
import Integracoes from './routes/Integracoes'
import Administracao from './routes/Administracao'
import Financeiro from './routes/Financeiro'
import Pagamentos from './routes/Pagamentos'
import Atividades from './routes/Atividades'
import PublicacoesOab from './routes/PublicacoesOab'
import Contatos from './routes/Contatos'
import Casos from './routes/Casos'

const GRUPOS_NAVEGACAO = [
  {
    id: 'escritorio', label: 'Escritório', icone: Enterprise,
    abas: [
      { id: 'casos', label: 'Processos' },
      { id: 'contatos', label: 'Contatos' },
      { id: 'atividades', label: 'Atividades' },
    ],
  },
  {
    id: 'consultas', label: 'Consultas', icone: Search,
    abas: [
      { id: 'processo', label: 'Consultar processo' },
      { id: 'publicacoes', label: 'Consultar publicações' },
      { id: 'jurimetria', label: 'Jurimetria' },
      { id: 'historico', label: 'Histórico' },
    ],
  },
  {
    id: 'acompanhamento', label: 'Acompanhamento', icone: Notification,
    abas: [
      { id: 'monitoramentos', label: 'Monitoramentos' },
      { id: 'publicacoes-oab', label: 'Publicações OAB' },
    ],
  },
  {
    id: 'financeiro', label: 'Financeiro', icone: Currency,
    abas: [
      { id: 'financeiro', label: 'Lançamentos' },
      { id: 'pagamentos', label: 'Pagamentos' },
    ],
  },
  {
    id: 'configuracoes', label: 'Configurações', icone: Settings,
    abas: [
      { id: 'acesso', label: 'Acesso' },
      { id: 'integracoes', label: 'Integrações' },
      { id: 'administracao', label: 'Administração' },
    ],
  },
]
const ABAS = GRUPOS_NAVEGACAO.flatMap((grupo) => grupo.abas)

const TOM_STATUS = {
  'sem-token': { texto: 'Sem token', tom: 'gray' as const },
  verificando: { texto: 'Verificando…', tom: 'gray' as const },
  conectado: { texto: 'Conectado', tom: 'green' as const },
  'nao-conectado': { texto: 'Não conectado', tom: 'red' as const },
}

function StatusConexaoTag() {
  const { status } = useCliente()
  const { texto, tom } = TOM_STATUS[status]
  return <Tag type={tom}>{texto}</Tag>
}

function ConteudoAba({ abaAtiva }: { abaAtiva: string }) {
  switch (abaAtiva) {
    case 'administracao':
      return <Administracao />
    case 'acesso':
      return <Acesso />
    case 'processo':
      return <Processo />
    case 'publicacoes':
      return <Publicacoes />
    case 'historico':
      return <Historico />
    case 'monitoramentos':
      return <Monitoramentos />
    case 'jurimetria':
      return <Jurimetria />
    case 'integracoes':
      return <Integracoes />
    case 'financeiro':
      return <Financeiro />
    case 'pagamentos':
      return <Pagamentos />
    case 'atividades':
      return <Atividades />
    case 'publicacoes-oab':
      return <PublicacoesOab />
    case 'contatos':
      return <Contatos />
    case 'casos':
      return <Casos />
    default:
      return (
        <div>
          <h1>Aba: {ABAS.find((a) => a.id === abaAtiva)?.label}</h1>
          <p>Ainda não migrada — pendente conforme docs/migracao-react-carbon.md.</p>
        </div>
      )
  }
}

function SideNavAstraJus({ expandida, fechar }: { expandida: boolean; fechar: () => void }) {
  const { abaAtiva, irPara } = useNavegacao()
  return (
    <SideNav aria-label="Navegação principal" expanded={expandida} isPersistent={false} onOverlayClick={fechar}>
      {/* Reabre o grupo de destino também ao navegar por links internos ou pela hash. */}
      <SideNavItems key={abaAtiva}>
        {GRUPOS_NAVEGACAO.map((grupo) => {
          const ativo = grupo.abas.some((aba) => aba.id === abaAtiva)
          return (
            <SideNavMenu key={grupo.id} title={grupo.label} renderIcon={grupo.icone} defaultExpanded={ativo} isActive={ativo}>
              {grupo.abas.map((aba) => (
                <SideNavMenuItem
                  key={aba.id}
                  href={`#/${aba.id}`}
                  isActive={aba.id === abaAtiva}
                  aria-current={aba.id === abaAtiva ? 'page' : undefined}
                  onClick={(e) => {
                    // Preserva abrir em nova aba/janela com os atalhos nativos do navegador.
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
                    e.preventDefault()
                    irPara(aba.id)
                    fechar()
                  }}
                >
                  {aba.label}
                </SideNavMenuItem>
              ))}
            </SideNavMenu>
          )
        })}
      </SideNavItems>
    </SideNav>
  )
}

function ConteudoPrincipal() {
  const { abaAtiva } = useNavegacao()
  return (
    <Content id="main-content" tabIndex={-1} className="app-content">
      <ConteudoAba abaAtiva={abaAtiva} />
    </Content>
  )
}

function temaSalvo(): 'white' | 'g100' {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'g100' ? 'g100' : 'white'
  } catch {
    return 'white'
  }
}

export default function App() {
  const [tema, setTema] = useState<'white' | 'g100'>(temaSalvo)
  const [navExpandida, setNavExpandida] = useState(() => window.matchMedia('(min-width: 1056px)').matches)

  useEffect(() => {
    function teclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && navExpandida) {
        setNavExpandida(false)
        document.querySelector<HTMLButtonElement>('.cds--header__menu-toggle')?.focus()
      }
    }
    const media = window.matchMedia('(min-width: 1056px)')
    const redimensionar = () => setNavExpandida(media.matches)
    media.addEventListener('change', redimensionar)
    document.addEventListener('keydown', teclado)
    return () => { media.removeEventListener('change', redimensionar); document.removeEventListener('keydown', teclado) }
  }, [navExpandida])

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_TEMA, tema)
    } catch {
      // armazenamento indisponível: tema aplicado só nesta sessão
    }
  }, [tema])

  return (
    <Theme theme={tema} className="app-theme">
      <ClienteProvider>
        <NavegacaoProvider abaInicial="acesso">
          <Header aria-label="AstraJus">
            <SkipToContent href="#main-content">Pular para o conteúdo</SkipToContent>
            <HeaderMenuButton
              isCollapsible
              aria-label={navExpandida ? 'Fechar menu' : 'Abrir menu'}
              isActive={navExpandida}
              aria-expanded={navExpandida}
              onClick={() => setNavExpandida((atual) => !atual)}
            />
            <HeaderName href="#" prefix="">
              AstraJus
            </HeaderName>
            <HeaderGlobalBar>
              <div className="shell-status">
                <StatusConexaoTag />
              </div>
              <BuscaGlobal />
              <CentralNotificacoes />
              <HeaderGlobalAction
                aria-label="Alternar tema"
                onClick={() => setTema(tema === 'white' ? 'g100' : 'white')}
              >
                {tema === 'white' ? <Asleep size={20} /> : <Light size={20} />}
              </HeaderGlobalAction>
            </HeaderGlobalBar>
          </Header>
          <SideNavAstraJus expandida={navExpandida} fechar={() => setNavExpandida(false)} />
          <ConteudoPrincipal />
        </NavegacaoProvider>
      </ClienteProvider>
    </Theme>
  )
}
