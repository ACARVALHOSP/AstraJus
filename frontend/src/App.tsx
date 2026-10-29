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
  SideNavLink,
  Tag,
  Theme,
} from '@carbon/react'
import { Asleep, Light } from '@carbon/icons-react'
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
import Financeiro from './routes/Financeiro'
import Pagamentos from './routes/Pagamentos'
import Atividades from './routes/Atividades'
import PublicacoesOab from './routes/PublicacoesOab'
import Contatos from './routes/Contatos'
import Casos from './routes/Casos'

const ABAS = [
  { id: 'acesso', label: 'Acesso' },
  { id: 'processo', label: 'Processo' },
  { id: 'publicacoes', label: 'Publicações' },
  { id: 'historico', label: 'Histórico' },
  { id: 'monitoramentos', label: 'Monitoramentos' },
  { id: 'jurimetria', label: 'Jurimetria' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'financeiro', label: 'Lançamentos' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'contatos', label: 'Contatos' },
  { id: 'atividades', label: 'Atividades' },
  { id: 'casos', label: 'Processos' },
  { id: 'publicacoes-oab', label: 'Publicações OAB' },
]

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
      <SideNavItems>
        {ABAS.map((aba) => (
          <SideNavLink
            key={aba.id}
            href="#"
            isActive={aba.id === abaAtiva}
            onClick={(e) => {
              e.preventDefault()
              irPara(aba.id)
              fechar()
            }}
          >
            {aba.label}
          </SideNavLink>
        ))}
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
        <NavegacaoProvider abaInicial={ABAS[0].id}>
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
