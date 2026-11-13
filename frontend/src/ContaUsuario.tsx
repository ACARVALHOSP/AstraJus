import { useState } from 'react'
import { Box, DropdownMenu, Flex, Switch, Text } from '@radix-ui/themes'
import { KeyRound, LogIn, LogOut, Moon, ShieldCheck, Sun, User } from 'lucide-react'
import type { AccentColor } from './aparencia'
import { useCliente } from './api/ClienteContext'
import { useNavegacao } from './api/NavegacaoContext'
import { usePerfil } from './api/PerfilContext'
import PerfilDialogo from './PerfilDialogo'

const NIVEIS: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Consulta' }

type Props = {
  aparencia: 'light' | 'dark'; setAparencia: (a: 'light' | 'dark') => void
  accent: AccentColor; setAccent: (a: AccentColor) => void
}

/** Menu da conta: perfil, administração, acesso, aparência (tema e cor) e sair.
 *  Sem conexão, continua disponível para trocar a aparência e ir para a tela de Acesso. */
export default function ContaUsuario({ aparencia, setAparencia, accent, setAccent }: Props) {
  const { cliente, esquecer } = useCliente()
  const { irPara } = useNavegacao()
  const { nome, nivel, foto, abaPermitida } = usePerfil()
  const [perfilAberto, setPerfilAberto] = useState(false)
  const conectado = Boolean(cliente)
  const rotulo = conectado ? (nome || 'Minha conta') : 'Conta'

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button type="button" className="aj-ib aj-conta-acionador" aria-label={`Menu da conta: ${rotulo}`} title={rotulo}>
            {conectado && foto ? <img src={foto} alt="" className="aj-conta-foto" /> : <User size={18} aria-hidden="true" />}
            <span className="aj-conta-nome">{rotulo}</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style={{ minWidth: 248 }}>
          <Box px="3" py="2">
            <Text as="div" size="2" weight="bold">{conectado ? (nome || 'Minha conta') : 'Sem conexão'}</Text>
            <Text as="div" size="1" color="gray">
              {conectado ? (nivel ? `Perfil de acesso: ${NIVEIS[nivel] ?? nivel}` : 'Carregando seus dados…') : 'Informe seu token na tela de Acesso.'}
            </Text>
          </Box>
          <DropdownMenu.Separator />
          {conectado ? (
            <>
              <DropdownMenu.Item onSelect={() => setPerfilAberto(true)}><User size={14} aria-hidden="true" />Meu perfil</DropdownMenu.Item>
              {abaPermitida('administracao') && <DropdownMenu.Item onSelect={() => irPara('administracao')}><ShieldCheck size={14} aria-hidden="true" />Administração</DropdownMenu.Item>}
              <DropdownMenu.Item onSelect={() => irPara('acesso')}><KeyRound size={14} aria-hidden="true" />Acesso e token</DropdownMenu.Item>
            </>
          ) : (
            <DropdownMenu.Item onSelect={() => irPara('acesso')}><LogIn size={14} aria-hidden="true" />Conectar</DropdownMenu.Item>
          )}
          <DropdownMenu.Separator />
          {/* Trocar a aparência não fecha o menu, para ver o resultado e experimentar outra cor. */}
          <DropdownMenu.Item onSelect={e => { e.preventDefault(); setAparencia(aparencia === 'dark' ? 'light' : 'dark') }}>
            <Flex align="center" gap="2" width="100%">
              <Sun size={14} aria-hidden="true" />
              <Switch size="1" checked={aparencia === 'dark'} tabIndex={-1} style={{ pointerEvents: 'none' }} aria-label="Tema escuro" />
              <Moon size={14} aria-hidden="true" />
            </Flex>
          </DropdownMenu.Item>
          {conectado && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onSelect={() => { esquecer(); irPara('acesso') }}><LogOut size={14} aria-hidden="true" />Sair</DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {perfilAberto && <PerfilDialogo accent={accent} setAccent={setAccent} onClose={() => setPerfilAberto(false)} />}
    </>
  )
}
