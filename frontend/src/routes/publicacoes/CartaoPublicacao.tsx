import { useState } from 'react'
import { Accordion, AccordionItem, Button, Link, Stack, Tag, Tile } from '@carbon/react'
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
    <Tile>
      <Stack gap={3}>
        <div>
          <Tag type="blue">{item.siglaTribunal ?? '?'}</Tag>{' '}
          {item.tipoComunicacao && <Tag type="teal">{item.tipoComunicacao}</Tag>}{' '}
          {item.tipoDocumento && <Tag type="gray">{item.tipoDocumento}</Tag>}
        </div>
        <h3>{item.nomeClasse ?? 'Classe não informada'}</h3>
        <p>Processo: {item.numeroprocessocommascara ?? 'não informado'}</p>
        <p>
          {item.nomeOrgao ?? 'Órgão não informado'} · disponibilizado em {formatarDataSimples(item.data_disponibilizacao)}
        </p>
        {destinatarios.length > 0 && (
          <div>
            <strong>Partes: </strong>
            {destinatarios.join(' · ')}
          </div>
        )}
        {advogados.length > 0 && (
          <div>
            <strong>Advogados: </strong>
            {advogados.join(' · ')}
          </div>
        )}
        {item.texto && (
          <Accordion>
            <AccordionItem title="Texto da publicação">
              <p>{item.texto}</p>
            </AccordionItem>
          </Accordion>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {item.texto && (
            <Button kind="ghost" size="sm" onClick={copiarTexto}>
              {copiado ? 'Copiado!' : 'Copiar texto'}
            </Button>
          )}
          {item.link && (
            <Link href={item.link} target="_blank" rel="noopener noreferrer">
              Ver no sistema do tribunal
            </Link>
          )}
          {item.hash && (
            <Button kind="secondary" size="sm" onClick={baixarCertidao} disabled={gerandoCertidao}>
              {gerandoCertidao ? 'Gerando…' : 'Baixar certidão'}
            </Button>
          )}
          {statusCertidao && <span>{statusCertidao.texto}</span>}
        </div>
      </Stack>
    </Tile>
  )
}
