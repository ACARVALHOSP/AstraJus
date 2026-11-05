import TabelaResponsiva from '../TabelaResponsiva'
import TextoTabela from '../TextoTabela'
import AcoesTabela from '../AcoesTabela'
import Carregamento from '../Carregamento'
import { useEffect, useState } from 'react'
import { Button, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { buscarJson } from '../api/rest'
import type { PayloadProcesso } from './Processo'
import type { PayloadPublicacoes } from './Publicacoes'
import {
  alternarCasoFavorito,
  formatarData,
  lerCasosFavoritos,
  lerFavoritos,
  lerHistorico,
  limparHistorico,
  removerFavorito,
  type Favorito,
  type ItemHistorico,
} from '../utils/listasRapidas'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../utils/formatadores'

type CasoFavorito = { id: string; titulo?: string }

export default function Historico() {
  const { cliente } = useCliente()
  const { irPara } = useNavegacao()
  const [favoritos, setFavoritos] = useState<Favorito[]>(() => lerFavoritos())
  const [historico, setHistorico] = useState<ItemHistorico[]>(() => lerHistorico())
  const [casosFavoritos, setCasosFavoritos] = useState<CasoFavorito[]>([])
  const [filtroFavoritos, setFiltroFavoritos] = useState('')
  const [filtroHistorico, setFiltroHistorico] = useState('')

  const [carregandoFavoritos, setCarregandoFavoritos] = useState(() => !!cliente && lerCasosFavoritos().length > 0)

  useEffect(() => {
    let atual = true
    const ids = lerCasosFavoritos()
    if (!ids.length || !cliente) {
      setCasosFavoritos([])
      setCarregandoFavoritos(false)
      return
    }
    setCarregandoFavoritos(true)
    buscarJson<{ casos: CasoFavorito[] }>(cliente, '/casos')
      .then((r) => { if (atual) setCasosFavoritos((r.casos ?? []).filter((c) => ids.includes(c.id))) })
      .catch(() => { if (atual) setCasosFavoritos([]) })
      .finally(() => { if (atual) setCarregandoFavoritos(false) })
    return () => { atual = false }
  }, [cliente])

  function removerCasoFavorito(id: string) {
    alternarCasoFavorito(id)
    setCasosFavoritos((atual) => atual.filter((c) => c.id !== id))
  }

  function remover(fav: Favorito) {
    removerFavorito(fav.tribunal, fav.numero)
    setFavoritos(lerFavoritos())
  }

  function consultarFavorito(fav: Favorito) {
    const payload: PayloadProcesso = { tribunal: fav.tribunal, numero_processo: fav.numero }
    irPara('processo', payload)
  }

  function apagarHistorico() {
    limparHistorico()
    setHistorico([])
  }

  function repetirItem(item: ItemHistorico) {
    if (item.tipo === 'processo') {
      irPara('processo', item.args as PayloadProcesso)
    } else {
      irPara('publicacoes', item.args as PayloadPublicacoes)
    }
  }

  return (
    <Flex direction="column" gap="7">
      <Heading as="h1" size="6">Histórico e favoritos</Heading>

      <section>
        <Heading as="h3" size="3" mb="2">Processos favoritos</Heading>
        <Text as="p" size="2" color="gray" mb="3">Processos marcados como favoritos na lista de Processos. Abrir leva diretamente ao processo.</Text>
        {carregandoFavoritos ? <Carregamento descricao="Carregando processos favoritos…" /> : casosFavoritos.length === 0 ? (
          <Text as="p" size="2">Nenhum processo favorito ainda.</Text>
        ) : (
          <Flex direction="column" gap="3">
            {casosFavoritos.map((caso) => (
              <Flex key={caso.id} justify="between" align="center" gap="3" wrap="wrap">
                <Text size="2">{caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)'}</Text>
                <Flex gap="2">
                  <Button variant="ghost" size="1" onClick={() => irPara('casos', { id: caso.id })}>
                    Abrir
                  </Button>
                  <Button variant="ghost" size="1" onClick={() => removerCasoFavorito(caso.id)}>
                    Remover
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </section>

      <section>
        <Heading as="h3" size="3" mb="2">Favoritos de consulta</Heading>
        <Text as="p" size="2" color="gray" mb="3">Favoritos deste navegador, sem sincronização. Use Consultar para repetir a consulta ao DataJud.</Text>
        {favoritos.length === 0 ? (
          <Text as="p" size="2">Nenhum favorito ainda.</Text>
        ) : (
          <Flex direction="column" gap="3">
            <div className="form-campo" style={{ maxWidth: 320 }}>
              <TextField.Root placeholder="Filtrar por tribunal ou número…" value={filtroFavoritos} onChange={(e) => setFiltroFavoritos(e.target.value)} />
            </div>
            <TabelaResponsiva principais={['Número do processo', 'Consulta']}>
            <table aria-label="Favoritos de consulta">
              <thead>
                <tr>
                  <th>Tribunal</th>
                  <th>Número do processo</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {favoritos.filter((fav) => {
                  const q = filtroFavoritos.trim().toLowerCase()
                  if (!q) return true
                  return (fav.tribunal || '').toLowerCase().includes(q) || formatarNumeroCNJ(fav.numero).toLowerCase().includes(q)
                }).map((fav) => (
                  <tr key={`${fav.tribunal}:${fav.numero}`}>
                    <td>{(fav.tribunal || '?').toUpperCase()}</td>
                    <td><TextoTabela texto={formatarNumeroCNJ(fav.numero)} /></td>
                    <td>
                      <AcoesTabela rotulo={`favorito ${fav.numero}`} acoes={[
                        { texto: 'Consultar', executar: () => consultarFavorito(fav) },
                        { texto: 'Remover', executar: () => remover(fav) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TabelaResponsiva>
          </Flex>
        )}
      </section>

      <section>
        <Flex justify="between" align="center" mb="2" wrap="wrap" gap="2">
          <Heading as="h3" size="3">Histórico recente</Heading>
          {historico.length > 0 && (
            <Button variant="ghost" color="red" size="1" onClick={apagarHistorico}>
              Apagar histórico
            </Button>
          )}
        </Flex>
        <Text as="p" size="2" color="gray" mb="3">Últimas consultas feitas neste navegador. Clique para repetir.</Text>
        {historico.length === 0 ? (
          <Text as="p" size="2">Nenhuma consulta recente.</Text>
        ) : (
          <Flex direction="column" gap="3">
            <div className="form-campo" style={{ maxWidth: 320 }}>
              <TextField.Root placeholder="Filtrar histórico…" value={filtroHistorico} onChange={(e) => setFiltroHistorico(e.target.value)} />
            </div>
            <TabelaResponsiva principais={['Número do processo', 'Consulta']}>
              <table aria-label="Histórico recente">
                <thead>
                  <tr>
                    <th>Consulta</th>
                    <th>Quando</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {historico
                    .filter((item) => item.resumo.toLowerCase().includes(filtroHistorico.trim().toLowerCase()))
                    .map((item, i) => (
                    <tr key={i}>
                      <td><TextoTabela texto={item.resumo} /></td>
                      <td>{formatarData(item.quando)}</td>
                      <td>
                        <AcoesTabela rotulo={item.resumo} acoes={[{ texto: 'Repetir', executar: () => repetirItem(item) }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaResponsiva>
          </Flex>
        )}
      </section>
    </Flex>
  )
}
