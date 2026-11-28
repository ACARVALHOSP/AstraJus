import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'
import { useAvisos } from '../../Avisos'
import Carregamento from '../../Carregamento'
import { useCliente } from '../../api/ClienteContext'
import { useClientes } from '../../api/consultas'
import { useNavegacao } from '../../api/NavegacaoContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, requisitar } from '../../api/rest'
import { DialogoGerar, type Catalogo, type ContatoLista, type Documento, type Modelo } from '../Documentos'
import type { PublicacaoOab } from './dados'

/** "Gerar minuta": abre o gerador de documentos com o modelo de peça já preenchido pela publicação. */
export default function MinutaPublicacao({ publicacao, onClose }: { publicacao: PublicacaoOab; onClose: () => void }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const { irPara } = useNavegacao()
  const queryClient = useQueryClient()
  const catalogo = useQuery({ queryKey: ['documentos-catalogo', cliente?.token], enabled: !!cliente, queryFn: ({ signal }) => buscarJson<Catalogo>(cliente, '/documentos/catalogo', signal) })
  const modelos = useQuery({ queryKey: ['documentos-modelos', cliente?.token], enabled: !!cliente, queryFn: ({ signal }) => buscarJson<{ modelos: Modelo[] }>(cliente, '/documentos/modelos', signal).then(r => r.modelos) })
  const contatos = useClientes<ContatoLista>()
  const pecas = (modelos.data ?? []).filter(m => m.tipo === 'peca')

  async function aoGerar(doc: Documento) {
    void queryClient.invalidateQueries({ queryKey: ['documentos'] })
    try {
      const resposta = await requisitar(cliente, `/documentos/${doc.id}/arquivo?tipo=docx`)
      const url = URL.createObjectURL(await resposta.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${doc.nome}.docx`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      avisar({ tipo: 'sucesso', texto: 'Minuta gerada e baixada. Ela também ficou na tela Documentos.' })
    } catch (e) {
      avisar({ tipo: 'erro', texto: `Minuta gerada, mas o download falhou: ${e instanceof ErroMCP ? e.message : 'tente baixar pela tela Documentos.'}` })
    }
    onClose()
  }

  if (modelos.isLoading || catalogo.isLoading) {
    return (
      <Dialog.Root open onOpenChange={o => { if (!o) onClose() }}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Gerar minuta</Dialog.Title>
          <Carregamento tipo="detalhe" descricao="Carregando modelos…" />
        </Dialog.Content>
      </Dialog.Root>
    )
  }
  if (!catalogo.data || !pecas.length) {
    return (
      <Dialog.Root open onOpenChange={o => { if (!o) onClose() }}>
        <Dialog.Content maxWidth="460px">
          <Dialog.Title>Gerar minuta</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            Ainda não há modelo de peça. Um administrador envia o modelo (DOCX com campos como {'{{processo_numero}}'} e {'{{publicacao_texto}}'}) na tela Documentos, escolhendo o tipo "Peça (minuta)".
          </Dialog.Description>
          <Flex gap="3" justify="end" mt="4">
            <Button variant="soft" color="gray" size="2" onClick={onClose}>Fechar</Button>
            <Button size="2" onClick={() => { onClose(); irPara('documentos') }}>Abrir Documentos</Button>
          </Flex>
          {modelos.isError && <Text as="p" size="1" color="red" mt="2">Não foi possível carregar os modelos.</Text>}
        </Dialog.Content>
      </Dialog.Root>
    )
  }
  return (
    <DialogoGerar catalogo={catalogo.data} modelos={pecas} contatos={contatos.data ?? []} onFechar={onClose} onGerado={d => void aoGerar(d)}
      publicacaoHash={publicacao.hash} casoIdInicial={publicacao.caso_id ?? undefined} titulo="Gerar minuta" />
  )
}
