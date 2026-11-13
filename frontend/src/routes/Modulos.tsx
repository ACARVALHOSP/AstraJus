import { useState } from 'react'
import { Badge, Callout, Card, Flex, Switch, Text } from '@radix-ui/themes'
import { Info } from 'lucide-react'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useAvisos } from '../Avisos'
import { useModulos } from '../api/ModulosContext'
import { iconeDoModulo } from '../modulos/registro'

// Gerenciador de módulos do escritório: liga e desliga cada módulo (só administrador).
export default function Modulos() {
  const { modulos, carregado, alternar } = useModulos()
  const { avisar } = useAvisos()
  const [alterando, setAlterando] = useState<string | null>(null)

  async function aoAlternar(id: string, nome: string, ativo: boolean) {
    setAlterando(id)
    try {
      await alternar(id, ativo)
      avisar({ texto: ativo ? `Módulo ${nome} ativado.` : `Módulo ${nome} desativado.` })
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível alterar o módulo.' })
    } finally {
      setAlterando(null)
    }
  }

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Módulos"
        descricao="Ative ou desative recursos do escritório. Um módulo desativado some do menu e para de responder, e os dados dele são mantidos."
      />
      {!carregado && <Carregamento tipo="detalhe" descricao="Carregando módulos…" />}
      {carregado && modulos.length === 0 && (
        <Callout.Root color="gray" role="status">
          <Callout.Icon><Info size={14} /></Callout.Icon>
          <Callout.Text>Nenhum módulo instalado.</Callout.Text>
        </Callout.Root>
      )}
      <Flex direction="column" gap="3">
        {modulos.map((m) => {
          const Icone = iconeDoModulo(m.aba.icone)
          const bloqueio = m.ativo
            ? (m.dependentes_ativos.length ? `Necessário para: ${m.dependentes_ativos.join(', ')}.` : null)
            : (m.dependencias.length && !modulos.filter(o => m.dependencias.includes(o.id)).every(o => o.ativo)
              ? 'Ative antes os módulos de que ele depende.' : null)
          return (
            <Card key={m.id}>
              <Flex align="center" justify="between" gap="4">
                <Flex gap="3" align="start">
                  <Icone size={20} aria-hidden="true" />
                  <Flex direction="column" gap="1">
                    <Flex gap="2" align="center">
                      <Text weight="medium">{m.nome}</Text>
                      <Badge color={m.ativo ? 'green' : 'gray'} variant="soft">{m.ativo ? 'Ativo' : 'Desativado'}</Badge>
                      <Text size="1" color="gray">v{m.versao}</Text>
                    </Flex>
                    <Text size="2" color="gray">{m.descricao}</Text>
                    {bloqueio && <Text size="1" color="gray">{bloqueio}</Text>}
                  </Flex>
                </Flex>
                <Switch
                  checked={m.ativo}
                  disabled={alterando === m.id || Boolean(bloqueio)}
                  onCheckedChange={(valor) => void aoAlternar(m.id, m.nome, valor)}
                  aria-label={`${m.ativo ? 'Desativar' : 'Ativar'} o módulo ${m.nome}`}
                />
              </Flex>
            </Card>
          )
        })}
      </Flex>
    </Flex>
  )
}
