import { useState, type FormEvent } from 'react'
import {
  Button,
  DatePicker,
  DatePickerInput,
  Form,
  InlineLoading,
  InlineNotification,
  NumberInput,
  Select,
  SelectItem,
  Stack,
  TextInput,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { TRIBUNAIS } from '../api/tribunais'
import { UFS } from '../api/ufs'
import { ddmmaaaaParaIso, formatarDdMmAaaa } from '../utils/formatadores'
import CartaoPublicacao, { type ItemPublicacao } from './publicacoes/CartaoPublicacao'

type ArgsBusca = {
  numero_processo?: string
  numero_oab?: string
  sigla_tribunal?: string
  uf_oab?: string
  data_disponibilizacao_inicio?: string
  data_disponibilizacao_fim?: string
  itens_por_pagina?: number
}

type RespostaPublicacoes = {
  erro?: boolean
  mensagem?: string
  itens?: ItemPublicacao[]
  total?: number
}

export default function Publicacoes() {
  const { cliente } = useCliente()

  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [tribunal, setTribunal] = useState('')
  const [numeroOab, setNumeroOab] = useState('')
  const [ufOab, setUfOab] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [itensPorPagina, setItensPorPagina] = useState(20)

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaPublicacoes | null>(null)
  const [busca, setBusca] = useState<{ args: ArgsBusca; pagina: number } | null>(null)

  function montarArgs(): ArgsBusca | null {
    const numero = numeroProcesso.trim()
    const oab = numeroOab.trim()
    if (!numero && !oab) {
      setErro('Informe o número do processo ou o número da OAB.')
      return null
    }
    const args: ArgsBusca = {}
    if (numero) args.numero_processo = numero
    if (oab) args.numero_oab = oab
    if (tribunal) args.sigla_tribunal = tribunal.toUpperCase()
    if (ufOab) args.uf_oab = ufOab.toUpperCase()
    const inicio = ddmmaaaaParaIso(dataInicio)
    if (inicio) args.data_disponibilizacao_inicio = inicio
    const fim = ddmmaaaaParaIso(dataFim)
    if (fim) args.data_disponibilizacao_fim = fim
    if (itensPorPagina > 0) args.itens_por_pagina = itensPorPagina
    return args
  }

  async function executarBusca(args: ArgsBusca, pagina: number) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    setConsultando(true)
    setErro(null)
    try {
      const dados = (await cliente.chamarFerramenta('consultar_publicacoes_djen', { ...args, pagina })) as RespostaPublicacoes
      setResultado(dados)
      if (!dados.erro) setBusca({ args, pagina })
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
    } finally {
      setConsultando(false)
    }
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    const args = montarArgs()
    if (args) executarBusca(args, 1)
  }

  const itensPorPaginaBusca = busca?.args.itens_por_pagina ?? 20
  const total = resultado?.total ?? 0
  const temPaginacao = busca && (total > itensPorPaginaBusca || busca.pagina > 1)

  return (
    <Stack gap={6}>
      <div>
        <h2>Consultar publicações</h2>
      </div>
      <Form onSubmit={aoEnviar}>
        <Stack gap={5}>
          <TextInput
            id="pub-numero-processo"
            labelText="Número do processo"
            placeholder="1006314-27.2023.8.26.0005"
            autoComplete="off"
            value={numeroProcesso}
            onChange={(e) => setNumeroProcesso(e.target.value)}
          />
          <Select id="pub-sigla-tribunal" labelText="Tribunal" value={tribunal} onChange={(e) => setTribunal(e.target.value)}>
            <SelectItem value="" text="— todos —" />
            {TRIBUNAIS.map((t) => (
              <SelectItem key={t} value={t} text={t.toUpperCase()} />
            ))}
          </Select>
          <TextInput
            id="pub-numero-oab"
            labelText="Número da OAB"
            placeholder="330659"
            autoComplete="off"
            value={numeroOab}
            onChange={(e) => setNumeroOab(e.target.value)}
          />
          <Select id="pub-uf-oab" labelText="UF da OAB" value={ufOab} onChange={(e) => setUfOab(e.target.value)}>
            <SelectItem value="" text="— todas —" />
            {UFS.map((uf) => (
              <SelectItem key={uf} value={uf} text={uf} />
            ))}
          </Select>
          <DatePicker
            datePickerType="range"
            dateFormat="d/m/Y"
            onChange={(datas: Date[]) => {
              const [inicio, fim] = datas
              setDataInicio(inicio ? formatarDdMmAaaa(inicio) : '')
              setDataFim(fim ? formatarDdMmAaaa(fim) : '')
            }}
          >
            <DatePickerInput id="pub-data-inicio" labelText="Publicado a partir de" placeholder="dd/mm/aaaa" />
            <DatePickerInput id="pub-data-fim" labelText="Publicado até" placeholder="dd/mm/aaaa" />
          </DatePicker>
          <NumberInput
            id="pub-itens"
            label="Itens por página"
            min={1}
            max={100}
            value={itensPorPagina}
            onChange={(_e, { value }) => setItensPorPagina(Number(value) || 20)}
          />
          <p>Informe o número do processo ou a OAB. Os demais campos são opcionais.</p>
          <div>
            <Button type="submit" disabled={consultando}>
              Consultar publicações
            </Button>
          </div>
        </Stack>
      </Form>
      <div aria-live="polite">
        {consultando && <InlineLoading description="Consultando o DJEN…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && (
          <InlineNotification kind="error" title="Erro na consulta ao DJEN" subtitle={resultado.mensagem} lowContrast hideCloseButton />
        )}
        {resultado && !resultado.erro && (
          <Stack gap={5}>
            <InlineNotification
              kind={(resultado.itens ?? []).length ? 'success' : 'info'}
              title={`${total} ${total === 1 ? 'publicação encontrada' : 'publicações encontradas'}`}
              subtitle={
                (resultado.itens ?? []).length
                  ? `Mostrando ${resultado.itens!.length} nesta página.`
                  : 'Tente ajustar os filtros ou o período.'
              }
              lowContrast
              hideCloseButton
            />
            {(resultado.itens ?? []).map((item, i) => (
              <CartaoPublicacao key={item.hash ?? i} item={item} />
            ))}
          </Stack>
        )}
      </div>
      {temPaginacao && busca && (
        <nav aria-label="Páginas de publicações" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Button kind="ghost" size="sm" disabled={busca.pagina <= 1} onClick={() => executarBusca(busca.args, busca.pagina - 1)}>
            « Anterior
          </Button>
          <span>Página {busca.pagina}</span>
          <Button
            kind="ghost"
            size="sm"
            disabled={busca.pagina * itensPorPaginaBusca >= total}
            onClick={() => executarBusca(busca.args, busca.pagina + 1)}
          >
            Próxima »
          </Button>
        </nav>
      )}
    </Stack>
  )
}
