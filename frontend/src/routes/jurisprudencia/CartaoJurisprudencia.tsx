import { useRef, useState } from 'react'
import { Button, Stack, Tag, Tile } from '@carbon/react'
import { Checkmark, Copy } from '@carbon/icons-react'
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
    if (item.trecho_destacado_html) {
      const div = document.createElement('div')
      div.innerHTML = item.trecho_destacado_html
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

  const temTextoEmenta = Boolean((item.ementa && item.ementa.trim()) || item.trecho_destacado_html)

  return (
    <Tile>
      <Stack gap={3}>
        {/* Barra superior de badges e metadados */}
        <div className="aj-layout-48" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <Tag type="blue">TJSP</Tag>
          {item.classe && <Tag type="gray">{item.classe}</Tag>}
          {item.votacao && (
            <Tag type="teal">
              {item.votacao.toLowerCase().includes('votação') || item.votacao.toLowerCase().includes('votacao')
                ? item.votacao
                : `Votação: ${item.votacao}`}
            </Tag>
          )}
          {item.segredo_justica && <Tag type="red">Segredo de justiça</Tag>}
          {item.ativo === false && <Tag type="outline">Inativo</Tag>}

          <div style={{ flex: '1 1 auto' }} />
          <span>Julgado em {formatarDataSimples(item.data_julgamento)}</span>
        </div>

        {/* Processo de Origem (se presente) */}
        {item.nu_processo_origem && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <span>
              <strong>Processo de origem:</strong> {item.nu_processo_origem}
            </span>
            <Button
              kind="ghost"
              size="sm"
              hasIconOnly
              renderIcon={copiadoProcesso ? Checkmark : Copy}
              iconDescription={copiadoProcesso ? 'Número copiado!' : 'Copiar número do processo de origem'}
              onClick={() => copiarTexto(item.nu_processo_origem!, setCopiadoProcesso, timerProcesso)}
            />
          </div>
        )}

        {/* Ementa ou Trecho Destacado */}
        {item.trecho_destacado_html ? (
          <p className="juris-trecho" dangerouslySetInnerHTML={{ __html: item.trecho_destacado_html }} />
        ) : (
          item.ementa && <p>{item.ementa}</p>
        )}

        {/* Metadados (Relator, Comarca, Órgão, Voto, Prolatores) */}
        {atribuicoes.length > 0 && (
          <p>
            {atribuicoes.map(({ rotulo, valor }, i) => (
              <span key={rotulo}>
                {i > 0 && ' · '}
                <strong>{rotulo}:</strong> {valor}
              </span>
            ))}
          </p>
        )}

        {/* Boletins associados (se houver) */}
        {item.boletins && item.boletins.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem' }}>
              <strong>Boletins:</strong>
            </span>
            {item.boletins.map((b, i) => (
              <Tag key={i} type="warm-gray" size="sm">
                {b}
              </Tag>
            ))}
          </div>
        )}

        {/* Ações inferiores */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.25rem' }}>
          <div>
            {temTextoEmenta && (
              <Button
                kind={copiadoEmenta ? 'primary' : 'ghost'}
                size="sm"
                renderIcon={copiadoEmenta ? Checkmark : Copy}
                onClick={() => copiarTexto(extrairTextoEmenta(), setCopiadoEmenta, timerEmenta)}
              >
                {copiadoEmenta ? 'Ementa copiada!' : 'Copiar ementa'}
              </Button>
            )}
          </div>

          <div>
            {item.pdf_url && (
              <a href={item.pdf_url} target="_blank" rel="noreferrer" className="cds--link">
                Baixar PDF da ementa
              </a>
            )}
          </div>
        </div>
      </Stack>
    </Tile>
  )
}
