import { useState } from 'react'
import { Badge, Button, Card, Flex, Heading, Text } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { formatarDataSimples } from '../../utils/formatadores'

export type Destinatario = { nome?: string; polo?: string }
export type Advogado = { nome?: string; numero_oab?: string; uf_oab?: string }

export type ItemPublicacao = {
  siglaTribunal?: string
  tipoComunicacao?: string
  tipoDocumento?: string
  nomeClasse?: string
  numeroprocessocommascara?: string
  nomeOrgao?: string
  data_disponibilizacao?: string
  destinatarios?: Destinatario[]
  destinatarioadvogados?: Advogado[]
  texto?: string
  link?: string
  hash?: string
}

export default function CartaoPublicacao({ item }: { item: ItemPublicacao }) {
  const { cliente } = useCliente()
  const [copiado, setCopiado] = useState(false)
  const [statusCertidao, setStatusCertidao] = useState<{ tipo: 'erro' | 'aviso' | 'sucesso'; texto: string } | null>(null)
  const [gerandoCertidao, setGerandoCertidao] = useState(false)

  const destinatarios = (item.destinatarios ?? []).map((d) => `${d.nome ?? '?'} (${d.polo ?? '?'})`)
  const advogados = (item.destinatarioadvogados ?? []).map(
    (a) => `${a.nome ?? '?'} OAB ${a.numero_oab ?? '?'}/${a.uf_oab ?? '?'}`,
  )

  async function copiarTexto() {
    if (!item.texto) return
    try {
      await navigator.clipboard.writeText(item.texto)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
    setTimeout(() => setCopiado(false), 2000)
  }

  async function baixarCertidao() {
    if (!cliente || !item.hash) return
    setGerandoCertidao(true)
    setStatusCertidao(null)
    try {
      const dados = (await cliente.chamarFerramenta('baixar_certidao_djen', { hash: item.hash })) as {
        erro?: boolean
        mensagem?: string
        link_download?: string
        validade_link?: string
        aviso?: string
      }
      if (dados.erro) {
        setStatusCertidao({ tipo: 'erro', texto: dados.mensagem ?? 'Falha ao gerar certidão.' })
      } else if (dados.link_download) {
        window.open(dados.link_download, '_blank', 'noopener,noreferrer')
        setStatusCertidao({ tipo: 'sucesso', texto: `Link aberto. Válido por ${dados.validade_link ?? '15 minutos'}.` })
      } else {
        setStatusCertidao({ tipo: 'aviso', texto: dados.aviso ?? 'Não foi possível gerar o link.' })
      }
    } catch (e) {
      setStatusCertidao({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha inesperada.' })
    } finally {
      setGerandoCertidao(false)
    }
  }

  return (
    <Card variant="surface">
      <Flex direction="column" gap="3">
        <Flex gap="2">
          <Badge color="blue">{item.siglaTribunal ?? '?'}</Badge>
          {item.tipoComunicacao && <Badge color="teal">{item.tipoComunicacao}</Badge>}
          {item.tipoDocumento && <Badge color="gray">{item.tipoDocumento}</Badge>}
        </Flex>
        <Heading as="h3" size="3">{item.nomeClasse ?? 'Classe não informada'}</Heading>
        <Text as="p" size="2">Processo: {item.numeroprocessocommascara ?? 'não informado'}</Text>
        <Text as="p" size="2">
          {item.nomeOrgao ?? 'Órgão não informado'} · disponibilizado em {formatarDataSimples(item.data_disponibilizacao)}
        </Text>
        {destinatarios.length > 0 && (
          <Text as="p" size="2">
            <Text weight="bold">Partes: </Text>
            {destinatarios.join(' · ')}
          </Text>
        )}
        {advogados.length > 0 && (
          <Text as="p" size="2">
            <Text weight="bold">Advogados: </Text>
            {advogados.join(' · ')}
          </Text>
        )}
        {item.texto && (
          <details>
            <summary>Texto da publicação</summary>
            <Text as="p" size="2" mt="2">{item.texto}</Text>
          </details>
        )}
        <Flex gap="3" align="center" wrap="wrap">
          {item.texto && (
            <Button variant="ghost" size="1" onClick={copiarTexto}>
              {copiado ? 'Copiado!' : 'Copiar texto'}
            </Button>
          )}
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener noreferrer">
              Ver no sistema do tribunal
            </a>
          )}
          {item.hash && (
            <Button variant="soft" size="1" onClick={baixarCertidao} disabled={gerandoCertidao}>
              {gerandoCertidao ? 'Gerando…' : 'Baixar certidão'}
            </Button>
          )}
          {statusCertidao && <Text size="2">{statusCertidao.texto}</Text>}
        </Flex>
      </Flex>
    </Card>
  )
}
