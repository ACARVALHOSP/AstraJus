import { useEffect, useState } from 'react'
import {
  Button,
  DataTable,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react'
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
  const [historico] = useState<ItemHistorico[]>(() => lerHistorico())
  const [casosFavoritos, setCasosFavoritos] = useState<CasoFavorito[]>([])

  useEffect(() => {
    const ids = lerCasosFavoritos()
    if (!ids.length || !cliente) {
      setCasosFavoritos([])
      return
    }
    buscarJson<{ casos: CasoFavorito[] }>(cliente, '/casos')
      .then((r) => setCasosFavoritos((r.casos ?? []).filter((c) => ids.includes(c.id))))
      .catch(() => setCasosFavoritos([]))
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
        <h3>Casos favoritos</h3>
        <p>Casos marcados com ★ na lista de Casos. Abrir pula direto para o caso.</p>
        {casosFavoritos.length === 0 ? (
          <p>Nenhum caso favorito ainda.</p>
        ) : (
          <Stack gap={3}>
            {casosFavoritos.map((caso) => (
              <div key={caso.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span>{caso.titulo ? formatarNomeExibicao(caso.titulo) : '(sem título)'}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button kind="ghost" size="sm" onClick={() => irPara('casos', { id: caso.id })}>
                    Abrir
                  </Button>
                  <Button kind="ghost" size="sm" onClick={() => removerCasoFavorito(caso.id)}>
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </Stack>
        )}
      </section>

      <section>
        <h3>Favoritos de consulta</h3>
        <p>Favoritos deste navegador, sem sincronização. Use Consultar para repetir a consulta ao DataJud.</p>
        {favoritos.length === 0 ? (
          <p>Nenhum favorito ainda.</p>
        ) : (
          <DataTable
            rows={favoritos.map((fav) => ({ id: `${fav.tribunal}:${fav.numero}`, tribunal: (fav.tribunal || '?').toUpperCase(), numero: formatarNumeroCNJ(fav.numero) }))}
            headers={[
              { key: 'tribunal', header: 'Tribunal' },
              { key: 'numero', header: 'Número do processo' },
            ]}
            isSortable
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()} aria-label="Favoritos de consulta">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>
                          {header.header}
                        </TableHeader>
                      ))}
                      <TableHeader>Ações</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const fav = favoritos.find((f) => `${f.tribunal}:${f.numero}` === row.id)
                      return (
                        <TableRow {...getRowProps({ row })}>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>{cell.value}</TableCell>
                          ))}
                          <TableCell>
                            {fav && (
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <Button kind="ghost" size="sm" onClick={() => consultarFavorito(fav)}>
                                  Consultar
                                </Button>
                                <Button kind="ghost" size="sm" onClick={() => remover(fav)}>
                                  Remover
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        )}
      </section>

      <section>
        <h3>Histórico recente</h3>
        <p>Últimas consultas feitas neste navegador. Clique para repetir.</p>
        {historico.length === 0 ? (
          <p>Nenhuma consulta recente.</p>
        ) : (
          <DataTable
            rows={historico.map((item, i) => ({ id: String(i), resumo: item.resumo, quando: formatarData(item.quando) }))}
            headers={[
              { key: 'resumo', header: 'Consulta' },
              { key: 'quando', header: 'Quando' },
            ]}
            isSortable
          >
            {({ rows, headers, getHeaderProps, getRowProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()} aria-label="Histórico recente">
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>
                          {header.header}
                        </TableHeader>
                      ))}
                      <TableHeader>Ações</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const item = historico[Number(row.id)]
                      return (
                        <TableRow {...getRowProps({ row })}>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.id}>{cell.value}</TableCell>
                          ))}
                          <TableCell>
                            {item && (
                              <Button kind="ghost" size="sm" onClick={() => repetirItem(item)}>
                                Repetir
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        )}
      </section>
    </Stack>
  )
}
