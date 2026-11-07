import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Callout, Card, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info, Star } from 'lucide-react'
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
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Consultar processo"
        descricao="Consulta a capa e as movimentações de um processo no DataJud (CNJ)."
      />
      <form onSubmit={aoEnviar}>
        <Flex direction="column" gap="5">
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="tribunal">Tribunal</label>
              <Select.Root value={tribunal || '__none__'} onValueChange={(v) => setTribunal(v === '__none__' ? '' : v)}>
                <Select.Trigger id="tribunal" placeholder="Selecione o tribunal" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__none__">Selecione o tribunal</Select.Item>
                  {TRIBUNAIS.map((t) => (
                    <Select.Item key={t} value={t}>{t.toUpperCase()}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo" style={{ gridColumn: 'span 2' }}>
              <label className="form-campo-label" htmlFor="numero-processo">Número do processo</label>
              <TextField.Root
                id="numero-processo"
                placeholder="1006314-27.2023.8.26.0005"
                autoComplete="off"
                required
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
              <Text size="1" color="gray">20 dígitos, com ou sem máscara.</Text>
            </div>
          </div>
          <div>
            <Button size="2" type="submit" disabled={consultando}>
              Consultar processo
            </Button>
          </div>
        </Flex>
      </form>
      <Text size="2" color="gray">A consulta ao DataJud pode levar até dois minutos em horários de pico.</Text>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="detalhe" descricao="Consultando o DataJud (pode levar até dois minutos)…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {resultado?.erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{resultado.mensagem}</Callout.Text>
          </Callout.Root>
        )}
        {!consultando && resultado && !resultado.erro && !resultado.encontrado && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>{resultado.mensagem}</Callout.Text>
          </Callout.Root>
        )}
        {!consultando && resultado && !resultado.erro && resultado.encontrado && (
          <Flex direction="column" gap="5">
            <Callout.Root color="green" size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>{resultado.total ?? resultado.processos?.length ?? 0} registro(s) encontrado(s)</Callout.Text>
            </Callout.Root>
            {(resultado.processos ?? []).map((proc, i) => (
              <CartaoProcesso key={proc.numeroProcesso ?? i} proc={proc} />
            ))}
          </Flex>
        )}
      </div>
    </Flex>
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
    <Card variant="surface">
      <Flex direction="column" gap="3">
        <Flex gap="2">
          <Badge color="blue">{(proc.tribunal ?? '?').toUpperCase()}</Badge>
          <Badge color="purple">{proc.grau_descricao ?? proc.grau ?? 'grau não informado'}</Badge>
        </Flex>
        <Heading as="h3" size="3">{proc.classe ?? 'Classe não informada'}</Heading>
        <Text size="2">Número: {formatarNumeroCNJ(proc.numeroProcesso) || 'não informado'}</Text>
        <Text size="2">Órgão julgador: {proc.orgaoJulgador ?? 'não informado'}</Text>
        <Text size="2">Distribuído em: {formatarDataSimples(proc.dataAjuizamento)}</Text>
        {movimentos.length > 0 && (
          <details>
            <summary>{proc.totalMovimentos ?? movimentos.length} movimentações</summary>
            <Flex direction="column" gap="3" mt="2">
              {movimentos.map((mov, i) => (
                <Text as="p" size="2" key={i}>
                  {formatarDataSimples(mov.dataHora)} — {mov.nome ?? 'sem descrição'}
                </Text>
              ))}
            </Flex>
          </details>
        )}
        {proc.numeroProcesso && (
          <div>
            <Button variant="ghost" size="1" color={favorito ? 'yellow' : 'gray'} onClick={alternarFavoritoClick} style={{ alignSelf: 'flex-start' }}>
              <Star size={14} fill={favorito ? 'currentColor' : 'none'} /> {favorito ? 'Favorito' : 'Favoritar'}
            </Button>
          </div>
        )}
      </Flex>
    </Card>
  )
}
