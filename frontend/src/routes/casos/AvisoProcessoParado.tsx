import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Flex, Switch, Text } from '@radix-ui/themes'
import { useAvisos } from '../../Avisos'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { explicacaoAviso, type AvisoProcessoParado } from './avisoProcessoParado'

/** Interruptor por processo da rotina "Processo parado": ligado = o sistema pode avisar; desligado = silenciado. */
export default function AvisoProcessoParadoOpcao({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const queryClient = useQueryClient()
  const [salvando, setSalvando] = useState(false)
  const chave = ['aviso-processo-parado', cliente?.token, casoId]
  const consulta = useQuery({
    queryKey: chave,
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<AvisoProcessoParado>(cliente, `/casos/${casoId}/aviso-processo-parado`, signal),
  })
  const estado = consulta.data
  if (!estado) return null

  async function alternar(avisarSePardo: boolean) {
    setSalvando(true)
    try {
      const novo = await enviarJson<AvisoProcessoParado>(cliente, `/casos/${casoId}/aviso-processo-parado`, { silenciado: !avisarSePardo }, 'PUT')
      queryClient.setQueryData(chave, novo)
    } catch (e) {
      avisar({ tipo: 'erro', texto: (e as Error).message })
    } finally { setSalvando(false) }
  }

  return (
    <div className="form-campo">
      <Text as="label" size="2" weight="medium">
        <Flex align="center" gap="2">
          <Switch checked={!estado.silenciado} disabled={salvando} onCheckedChange={alternar} aria-describedby="aviso-parado-ajuda" />
          Avisar se o processo ficar parado
        </Flex>
      </Text>
      <Text as="p" size="1" color="gray" id="aviso-parado-ajuda">{explicacaoAviso(estado)}</Text>
    </div>
  )
}
