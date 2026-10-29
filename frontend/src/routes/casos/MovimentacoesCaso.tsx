import { useCallback, useState } from 'react'
import { Button, InlineLoading, InlineNotification, Stack } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson } from '../../api/rest'
import { formatarDataSimples, formatarNumeroCNJ } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'

type Movimento = { numero: string; grau?: string; nome?: string; dataHora?: string }

type RespostaDataJud = {
  erro?: boolean
  mensagem?: string
  encontrado?: boolean
  processos?: Array<{ grau?: string; grau_descricao?: string; movimentos?: Array<{ nome?: string; dataHora?: string }> }>
}

export default function MovimentacoesCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(false)
  const [avisos, setAvisos] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[] | null>(null)

  const buscar = useCallback(async () => {
    setCarregando(true)
    setAvisos([])
    setStatus(null)
    setMovimentos(null)
    try {
      const caso = await buscarJson<{ processos?: string[] }>(cliente, `/casos/${casoId}`)
      const numeros = caso.processos ?? []
      if (!numeros.length) {
        setStatus('Informe o número CNJ no Cadastro para consultar as movimentações.')
        return
      }
      setStatus(`Consultando ${numeros.length} processo(s) no DataJud…`)
      const todasMovs: Movimento[] = []
      const erros: string[] = []
      for (const numero of numeros) {
        const tribunal = siglaTribunalPorNumero(numero)
        if (!tribunal) {
          erros.push(`${numero}: não foi possível determinar o tribunal`)
          continue
        }
        try {
          const dados = (await cliente?.chamarFerramenta('consultar_processo_datajud', { numero_processo: numero, tribunal })) as RespostaDataJud
          if (dados.erro || !dados.encontrado) {
            erros.push(`${numero}: ${dados.mensagem || 'não encontrado'}`)
            continue
          }
          for (const proc of dados.processos ?? []) {
            for (const m of proc.movimentos ?? []) {
              todasMovs.push({ numero, grau: proc.grau_descricao || proc.grau, nome: m.nome, dataHora: m.dataHora })
            }
          }
        } catch (e) {
          erros.push(`${numero}: ${e instanceof ErroMCP ? e.message : 'falha inesperada'}`)
        }
      }
      if (!todasMovs.length && !erros.length) {
        setStatus('Nenhuma movimentação encontrada.')
        return
      }
      setAvisos(erros)
      setStatus(null)
      todasMovs.sort((a, b) => (b.dataHora ?? '').localeCompare(a.dataHora ?? ''))
      setMovimentos(todasMovs)
    } finally {
      setCarregando(false)
    }
  }, [cliente, casoId])

  return (
    <Stack gap={5}>
      <div className="aj-layout-24">
        <h3>Movimentações</h3>
        <Button kind="secondary" size="sm" onClick={buscar} disabled={carregando}>
          Buscar no DataJud
        </Button>
      </div>
      <div aria-live="polite">
        {carregando && <InlineLoading description="Consultando…" />}
        {status && <InlineNotification kind="info" title="Status" subtitle={status} lowContrast hideCloseButton />}
        {avisos.length > 0 && <InlineNotification kind="warning" title="Aviso" subtitle={avisos.join(' | ')} lowContrast hideCloseButton />}
      </div>
      {movimentos && movimentos.length > 0 && (
        <Stack gap={3}>
          {movimentos.map((m, i) => (
            <div key={i} className="cds--tile">
              <p>
                {formatarDataSimples(m.dataHora)} — {m.nome ?? 'sem descrição'}
              </p>
              <p>
                Processo {formatarNumeroCNJ(m.numero)} · {m.grau ?? 'grau não informado'}
              </p>
            </div>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
