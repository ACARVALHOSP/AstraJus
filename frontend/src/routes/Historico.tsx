import { useState } from 'react'
import { Button, Stack, Tile } from '@carbon/react'
import { useNavegacao } from '../api/NavegacaoContext'
import type { PayloadProcesso } from './Processo'
import type { PayloadPublicacoes } from './Publicacoes'
import {
  formatarData,
  lerFavoritos,
  lerHistorico,
  removerFavorito,
  type Favorito,
  type ItemHistorico,
} from '../utils/listasRapidas'
import { formatarNumeroCNJ } from '../utils/formatadores'

export default function Historico() {
  const { irPara } = useNavegacao()
  const [favoritos, setFavoritos] = useState<Favorito[]>(() => lerFavoritos())
  const [historico] = useState<ItemHistorico[]>(() => lerHistorico())

  function remover(fav: Favorito) {
    removerFavorito(fav.tribunal, fav.numero)
    setFavoritos(lerFavoritos())
  }

  function consultarFavorito(fav: Favorito) {
    const payload: PayloadProcesso = { tribunal: fav.tribunal, numero_processo: fav.numero }
    irPara('processo', payload)
  }

  function repetirItem(item: ItemHistorico) {
    if (item.tipo === 'processo') {
      irPara('processo', item.args as PayloadProcesso)
    } else {
      irPara('publicacoes', item.args as PayloadPublicacoes)
    }
  }

  return (
    <Stack gap={7}>
      <div>
        <h2>Histórico e favoritos</h2>
      </div>

      <section>
        <h3>Favoritos de consulta</h3>
        <p>Favoritos deste navegador, sem sincronização. Use Consultar para repetir a consulta ao DataJud.</p>
        <Stack gap={3}>
          {favoritos.length === 0 && <p>Nenhum favorito ainda.</p>}
          {favoritos.map((fav) => (
            <Tile key={`${fav.tribunal}:${fav.numero}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span>
                  {(fav.tribunal || '?').toUpperCase()} · {formatarNumeroCNJ(fav.numero)}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button kind="ghost" size="sm" onClick={() => consultarFavorito(fav)}>
                    Consultar
                  </Button>
                  <Button kind="ghost" size="sm" onClick={() => remover(fav)}>
                    Remover
                  </Button>
                </div>
              </div>
            </Tile>
          ))}
        </Stack>
      </section>

      <section>
        <h3>Histórico recente</h3>
        <p>Últimas consultas feitas neste navegador. Clique para repetir.</p>
        <Stack gap={3}>
          {historico.length === 0 && <p>Nenhuma consulta recente.</p>}
          {historico.map((item, i) => (
            <Tile key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span>
                  {item.resumo} · {formatarData(item.quando)}
                </span>
                <Button kind="ghost" size="sm" onClick={() => repetirItem(item)}>
                  Repetir
                </Button>
              </div>
            </Tile>
          ))}
        </Stack>
      </section>
    </Stack>
  )
}
