import { useState } from 'react'
import {
  Content,
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  Tag,
  Theme,
} from '@carbon/react'
import { Asleep, Light } from '@carbon/icons-react'
import { ClienteProvider, useCliente } from './api/ClienteContext'
import { NavegacaoProvider, useNavegacao } from './api/NavegacaoContext'
import Acesso from './routes/Acesso'
import Processo from './routes/Processo'
import Publicacoes from './routes/Publicacoes'
import Historico from './routes/Historico'
import Monitoramentos from './routes/Monitoramentos'
import Jurimetria from './routes/Jurimetria'

const ABAS = [
  { id: 'acesso', label: 'Acesso' },
  { id: 'processo', label: 'Processo' },
  { id: 'publicacoes', label: 'Publicações' },
  { id: 'historico', label: 'Histórico' },
  { id: 'monitoramentos', label: 'Monitoramentos' },
  { id: 'jurimetria', label: 'Jurimetria' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'contatos', label: 'Contatos' },
  { id: 'atividades', label: 'Atividades' },
  { id: 'casos', label: 'Casos' },
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
    default:
      return (
        <div>
          <h1>Aba: {ABAS.find((a) => a.id === abaAtiva)?.label}</h1>
          <p>Ainda não migrada — pendente conforme docs/migracao-react-carbon.md.</p>
        </div>
      )
  }
}

function SideNavAstraJus() {
  const { abaAtiva, irPara } = useNavegacao()
  return (
    <SideNav aria-label="Navegação principal" expanded isRail>
      <SideNavItems>
        {ABAS.map((aba) => (
          <SideNavLink
            key={aba.id}
            href="#"
            isActive={aba.id === abaAtiva}
            onClick={(e) => {
              e.preventDefault()
              irPara(aba.id)
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
    <Content>
      <ConteudoAba abaAtiva={abaAtiva} />
    </Content>
  )
}

export default function App() {
  const [tema, setTema] = useState<'white' | 'g100'>('white')

  return (
    <Theme theme={tema}>
      <ClienteProvider>
        <NavegacaoProvider abaInicial={ABAS[0].id}>
          <Header aria-label="AstraJus">
            <HeaderName href="#" prefix="">
              AstraJus
            </HeaderName>
            <HeaderGlobalBar>
              <div style={{ display: 'flex', alignItems: 'center', marginRight: '1rem' }}>
                <StatusConexaoTag />
              </div>
              <HeaderGlobalAction
                aria-label="Alternar tema"
                onClick={() => setTema(tema === 'white' ? 'g100' : 'white')}
              >
                {tema === 'white' ? <Asleep size={20} /> : <Light size={20} />}
              </HeaderGlobalAction>
            </HeaderGlobalBar>
          </Header>
          <SideNavAstraJus />
          <ConteudoPrincipal />
        </NavegacaoProvider>
      </ClienteProvider>
    </Theme>
  )
}
