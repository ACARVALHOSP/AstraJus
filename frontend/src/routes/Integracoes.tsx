import { useEffect } from 'react'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import MinhaAgendaGoogle from '../MinhaAgendaGoogle'
import { useNavegacao } from '../api/NavegacaoContext'
import { usePerfil } from '../api/PerfilContext'

/** As integrações do escritório agora ficam em Administração › Integrações. Esta rota continua existindo
 *  para links antigos (#/integracoes) e para a Central de risco: administradores seguem para a nova aba;
 *  os demais veem só a conexão da própria agenda Google. */
export default function Integracoes() {
  const { irPara } = useNavegacao()
  const { nivel } = usePerfil()
  const administrador = nivel === 'administrador'
  useEffect(() => { if (administrador) irPara('administracao', { aba: 'integracoes' }) }, [administrador, irPara])

  if (!nivel || administrador) return <Carregamento tipo="texto" descricao="Abrindo Integrações…" />
  return (
    <>
      <CabecalhoPagina titulo="Minha agenda Google" descricao="Conecte sua conta para criar as atividades como eventos no seu calendário. As demais integrações são configuradas por um administrador." />
      <MinhaAgendaGoogle />
    </>
  )
}
