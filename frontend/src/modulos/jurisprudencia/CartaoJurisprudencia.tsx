import { useRef, useState } from 'react'
import { Badge, Button, Card, Flex, Text } from '@radix-ui/themes'
import { Check, Copy } from 'lucide-react'
import { formatarDataSimples } from '../../utils/formatadores'
import type { ResultadoJurisprudencia } from './tipos'

export function CartaoJurisprudencia({ item }: { item: ResultadoJurisprudencia }) {
  const [copiadoEmenta, setCopiadoEmenta] = useState(false)
  const [copiadoProcesso, setCopiadoProcesso] = useState(false)
  const timerEmenta = useRef<number | null>(null)
  const timerProcesso = useRef<number | null>(null)

  const atribuicoes: { rotulo: string; valor: string }[] = [
    item.relator && { rotulo: 'Relator(a)', valor: item.relator },
    item.comarca && { rotulo: 'Comarca', valor: item.comarca },
    item.orgao_julgador && { rotulo: 'Órgão julgador', valor: item.orgao_julgador },
    item.voto && { rotulo: 'Voto nº', valor: item.voto },
    item.cdAcordao && { rotulo: 'Acórdão nº', valor: String(item.cdAcordao) },
    item.prolatores && item.prolatores.length > 0 && { rotulo: 'Prolator(es)', valor: item.prolatores.join(', ') },
  ].filter((v): v is { rotulo: string; valor: string } => Boolean(v))

  function extrairTextoEmenta(): string {
    if (item.ementa && item.ementa.trim()) {
      return item.ementa.trim()
    }
    if (item.ementa_html) {
      const div = document.createElement('div')
      div.innerHTML = item.ementa_html
      return (div.textContent || div.innerText || '').trim()
    }
    return ''
  }

  async function copiarTexto(texto: string, setStatus: (val: boolean) => void, refTimer: React.MutableRefObject<number | null>) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(texto)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = texto
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setStatus(true)
      if (refTimer.current) {
        window.clearTimeout(refTimer.current)
      }
      refTimer.current = window.setTimeout(() => {
        setStatus(false)
      }, 2000)
    } catch {
      setStatus(false)
    }
  }

  const temTextoEmenta = Boolean((item.ementa && item.ementa.trim()) || item.ementa_html)

  return (
    <Card variant="surface">
      <Flex direction="column" gap="3">
        {/* Barra superior de badges e metadados */}
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color="blue">TJSP</Badge>
          {item.classe && <Badge color="gray">{item.classe}</Badge>}
          {item.votacao && (
            <Badge color="teal">
              {item.votacao.toLowerCase().includes('votação') || item.votacao.toLowerCase().includes('votacao')
                ? item.votacao
                : `Votação: ${item.votacao}`}
            </Badge>
          )}
          {item.segredo_justica && <Badge color="red">Segredo de justiça</Badge>}
          {item.ativo === false && <Badge color="gray" variant="outline">Inativo</Badge>}

          <div style={{ flex: '1 1 auto' }} />
          <Text size="2">Julgado em {formatarDataSimples(item.data_julgamento)}</Text>
        </Flex>

        {/* Processo de Origem (se presente) */}
        {item.nu_processo_origem && (
          <Flex align="center" gap="2">
            <Text size="2">
              <Text weight="bold">Processo de origem:</Text> {item.nu_processo_origem}
            </Text>
            <Button
              variant="ghost"
              size="1"
              aria-label={copiadoProcesso ? 'Número copiado!' : 'Copiar número do processo de origem'}
              onClick={() => copiarTexto(item.nu_processo_origem!, setCopiadoProcesso, timerProcesso)}
            >
              {copiadoProcesso ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </Flex>
        )}

        {/* Ementa completa, com os termos buscados marcados pelo backend */}
        {item.ementa_html && <p className="juris-trecho" dangerouslySetInnerHTML={{ __html: item.ementa_html }} />}

        {/* Metadados (Relator, Comarca, Órgão, Voto, Prolatores) */}
        {atribuicoes.length > 0 && (
          <Text as="p" size="2">
            {atribuicoes.map(({ rotulo, valor }, i) => (
              <span key={rotulo}>
                {i > 0 && ' · '}
                <Text weight="bold">{rotulo}:</Text> {valor}
              </span>
            ))}
          </Text>
        )}

        {/* Boletins associados (se houver) */}
        {item.boletins && item.boletins.length > 0 && (
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="1">
              <Text weight="bold">Boletins:</Text>
            </Text>
            {item.boletins.map((b, i) => (
              <Badge key={i} color="gray" size="1">
                {b}
              </Badge>
            ))}
          </Flex>
        )}

        {/* Ações inferiores */}
        <Flex align="center" justify="between" wrap="wrap" gap="3" mt="1">
          <div>
            {temTextoEmenta && (
              <Button
                variant={copiadoEmenta ? 'solid' : 'ghost'}
                size="1"
                onClick={() => copiarTexto(extrairTextoEmenta(), setCopiadoEmenta, timerEmenta)}
              >
                {copiadoEmenta ? <Check size={14} /> : <Copy size={14} />}
                {copiadoEmenta ? 'Ementa copiada!' : 'Copiar ementa'}
              </Button>
            )}
          </div>

          <div>
            {item.pdf_url && (
              <a href={item.pdf_url} target="_blank" rel="noreferrer">
                Baixar PDF da ementa
              </a>
            )}
          </div>
        </Flex>
      </Flex>
    </Card>
  )
}
