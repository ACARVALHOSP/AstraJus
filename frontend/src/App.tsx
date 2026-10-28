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
  Theme,
} from '@carbon/react'
import { Asleep, Light } from '@carbon/icons-react'

const ABAS = [
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

export default function App() {
  const [tema, setTema] = useState<'white' | 'g100'>('white')
  const [abaAtiva, setAbaAtiva] = useState(ABAS[0].id)

  return (
    <Theme theme={tema}>
      <Header aria-label="AstraJus">
        <HeaderName href="#" prefix="">
          AstraJus
        </HeaderName>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Alternar tema"
            onClick={() => setTema(tema === 'white' ? 'g100' : 'white')}
          >
            {tema === 'white' ? <Asleep size={20} /> : <Light size={20} />}
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>
      <SideNav aria-label="Navegação principal" expanded isRail>
        <SideNavItems>
          {ABAS.map((aba) => (
            <SideNavLink
              key={aba.id}
              href="#"
              isActive={aba.id === abaAtiva}
              onClick={(e) => {
                e.preventDefault()
                setAbaAtiva(aba.id)
              }}
            >
              {aba.label}
            </SideNavLink>
          ))}
        </SideNavItems>
      </SideNav>
      <Content>
        <h1>Aba: {ABAS.find((a) => a.id === abaAtiva)?.label}</h1>
        <p>Scaffold de migração — conteúdo real vira componente por aba.</p>
      </Content>
    </Theme>
  )
}
