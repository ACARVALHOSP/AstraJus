import { useEffect, useState } from 'react'
import { Button } from '@carbon/react'
import { User } from "@carbon/icons-react";
import { useCliente } from './api/ClienteContext'
import type { ClienteMCP } from './api/mcpClient'
import { useNavegacao } from './api/NavegacaoContext'
import { usePainelShell } from './usePainelShell'

type Perfil = { login: string; nome_completo: string; nivel_acesso: string }
const NIVEIS: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Consulta' }

export default function ContaUsuario() {
  const { cliente } = useCliente()
  return cliente ? <ContaConectada key={cliente.token} cliente={cliente} /> : null
}

function ContaConectada({ cliente }: { cliente: ClienteMCP }) {
  const { esquecer } = useCliente()
  const { irPara } = useNavegacao()
  const [aberto, setAberto] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [erro, setErro] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const raiz = usePainelShell(aberto, () => setAberto(false))

  useEffect(() => {
    const controlador = new AbortController()
    void fetch('/responsaveis/me', {
      headers: { Authorization: `Bearer ${cliente.token}` },
      cache: 'no-store', signal: controlador.signal,
    }).then(async resposta => {
      if (!resposta.ok) throw new Error('Perfil indisponível')
      const dados = await resposta.json() as { usuario: Perfil }
      if (!dados.usuario?.nome_completo) throw new Error('Perfil inválido')
      if (!controlador.signal.aborted) setPerfil(dados.usuario)
    }).catch(() => { if (!controlador.signal.aborted) setErro(true) })
    return () => controlador.abort()
  }, [cliente, tentativa])

  const nome = perfil?.nome_completo || 'Minha conta'
  return (
    <div ref={raiz} className="shell-action shell-conta">
      <button type="button" className="shell-conta__acionador" aria-label={`Conta de ${nome}`} aria-expanded={aberto} aria-controls="shell-conta-painel" title={nome} onClick={() => setAberto(!aberto)}>
        <User size={20} aria-hidden="true" />
        <span className="shell-conta__nome">{nome}</span>
      </button>
      {aberto && <div id="shell-conta-painel" className="shell-panel shell-conta__painel" role="region" aria-label="Minha conta">
        <h2>{nome}</h2>
        {perfil ? <><p>{perfil.login}</p><p>Perfil de acesso: {NIVEIS[perfil.nivel_acesso] || 'Não informado'}</p></> :
          erro ? <div role="alert"><p>Não foi possível carregar seus dados.</p><Button kind="ghost" size="sm" onClick={() => { setErro(false); setTentativa(t => t + 1) }}>Tentar novamente</Button></div> : <p role="status">Carregando seus dados…</p>}
        <Button kind="ghost" size="sm" onClick={() => { setAberto(false); irPara('acesso') }}>Configurações de acesso</Button>
        <Button kind="danger--ghost" size="sm" onClick={() => { setAberto(false); setPerfil(null); esquecer(); irPara('acesso') }}>Sair</Button>
      </div>}
    </div>
  )
}
