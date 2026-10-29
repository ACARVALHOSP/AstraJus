import { useEffect, useState, type FormEvent } from 'react'
import {
  Accordion,
  AccordionItem,
  Button,
  Form,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Stack,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { ErroMCP } from '../api/mcpClient'
import { TRIBUNAIS } from '../api/tribunais'
import { formatarDataSimples, formatarNumeroCNJ } from '../utils/formatadores'
import { adicionarHistorico, alternarFavorito, ehFavorito } from '../utils/listasRapidas'

type Movimento = {
  nome?: string
  dataHora?: string
}

type ProcessoEncontrado = {
  tribunal?: string
  grau?: string
  grau_descricao?: string
  classe?: string
  numeroProcesso?: string
  orgaoJulgador?: string
  dataAjuizamento?: string
  totalMovimentos?: number
  movimentos?: Movimento[]
}

type RespostaConsulta = {
  erro?: boolean
  mensagem?: string
  encontrado?: boolean
  total?: number
  processos?: ProcessoEncontrado[]
}

export type PayloadProcesso = { tribunal: string; numero_processo: string }

export default function Processo() {
  const { cliente } = useCliente()
  const { consumirPayload } = useNavegacao()
  const [tribunal, setTribunal] = useState('')
  const [numero, setNumero] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaConsulta | null>(null)

  async function consultar(tribunalValor: string, numeroValor: string) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    setConsultando(true)
    setErro(null)
    setResultado(null)
    try {
      const dados = (await cliente.chamarFerramenta('consultar_processo_datajud', {
        tribunal: tribunalValor.trim().toLowerCase(),
        numero_processo: numeroValor.trim(),
      })) as RespostaConsulta
      setResultado(dados)
      if (!dados.erro) {
        adicionarHistorico({
          tipo: 'processo',
          args: { tribunal: tribunalValor, numero_processo: numeroValor },
          resumo: `Processo ${numeroValor} (${tribunalValor.toUpperCase()})`,
        })
      }
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
    } finally {
      setConsultando(false)
    }
  }

  useEffect(() => {
    const payload = consumirPayload<PayloadProcesso>('processo')
    if (!payload) return
    setTribunal(payload.tribunal)
    setNumero(payload.numero_processo)
    consultar(payload.tribunal, payload.numero_processo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    consultar(tribunal, numero)
  }

  return (
    <Stack gap={6}>
      <div>
        <h2>Consultar processo</h2>
      </div>
      <Form onSubmit={aoEnviar}>
        <Stack gap={5}>
          <div style={{ maxWidth: 'calc(24ch + 3.5rem)' }}>
            <Select id="tribunal" labelText="Tribunal" value={tribunal} onChange={(e) => setTribunal(e.target.value)} required>
              <SelectItem value="" text="— selecione o tribunal —" />
              {TRIBUNAIS.map((t) => (
                <SelectItem key={t} value={t} text={t.toUpperCase()} />
              ))}
            </Select>
          </div>
          <TextInput
            id="numero-processo"
            labelText="Número do processo"
            helperText="20 dígitos, com ou sem máscara."
            placeholder="1006314-27.2023.8.26.0005"
            autoComplete="off"
            required
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
          <div>
            <Button type="submit" disabled={consultando}>
              Consultar processo
            </Button>
          </div>
        </Stack>
      </Form>
      <p>A consulta ao DataJud pode levar até dois minutos em horários de pico.</p>
      <div aria-live="polite">
        {consultando && <InlineLoading description="Consultando o DataJud (pode levar até dois minutos)…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && (
          <InlineNotification kind="error" title="Erro na consulta ao DataJud" subtitle={resultado.mensagem} lowContrast hideCloseButton />
        )}
        {resultado && !resultado.erro && !resultado.encontrado && (
          <InlineNotification kind="info" title="Processo não encontrado" subtitle={resultado.mensagem} lowContrast hideCloseButton />
        )}
        {resultado && !resultado.erro && resultado.encontrado && (
          <Stack gap={5}>
            <InlineNotification
              kind="success"
              title={`${resultado.total ?? resultado.processos?.length ?? 0} registro(s) encontrado(s)`}
              lowContrast
              hideCloseButton
            />
            {(resultado.processos ?? []).map((proc, i) => (
              <CartaoProcesso key={proc.numeroProcesso ?? i} proc={proc} />
            ))}
          </Stack>
        )}
      </div>
    </Stack>
  )
}

function CartaoProcesso({ proc }: { proc: ProcessoEncontrado }) {
  const movimentos = proc.movimentos ?? []
  const [favorito, setFavorito] = useState(() =>
    proc.numeroProcesso ? ehFavorito(proc.tribunal ?? '', proc.numeroProcesso) : false,
  )

  function alternarFavoritoClick() {
    if (!proc.numeroProcesso) return
    setFavorito(alternarFavorito(proc.tribunal ?? '', proc.numeroProcesso))
  }

  return (
    <Tile>
      <Stack gap={3}>
        <div>
          <Tag type="blue">{(proc.tribunal ?? '?').toUpperCase()}</Tag>{' '}
          <Tag type="purple">{proc.grau_descricao ?? proc.grau ?? 'grau não informado'}</Tag>
        </div>
        <h3>{proc.classe ?? 'Classe não informada'}</h3>
        <p>Número: {formatarNumeroCNJ(proc.numeroProcesso) || 'não informado'}</p>
        <p>Órgão julgador: {proc.orgaoJulgador ?? 'não informado'}</p>
        <p>Distribuído em: {formatarDataSimples(proc.dataAjuizamento)}</p>
        {movimentos.length > 0 && (
          <Accordion>
            <AccordionItem title={`${proc.totalMovimentos ?? movimentos.length} movimentações`}>
              <Stack gap={3}>
                {movimentos.map((mov, i) => (
                  <p key={i}>
                    {formatarDataSimples(mov.dataHora)} — {mov.nome ?? 'sem descrição'}
                  </p>
                ))}
              </Stack>
            </AccordionItem>
          </Accordion>
        )}
        {proc.numeroProcesso && (
          <div>
            <Button kind="ghost" size="sm" onClick={alternarFavoritoClick}>
              {favorito ? '★ Favorito' : '☆ Favoritar'}
            </Button>
          </div>
        )}
      </Stack>
    </Tile>
  )
}
