import CampoData from '../CampoData'
import CabecalhoPagina from '../CabecalhoPagina'
import TabelaResponsiva from '../TabelaResponsiva'
import TextoTabela from '../TextoTabela'
import Carregamento from '../Carregamento'
import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, Callout, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { ErroMCP } from '../api/mcpClient'
import { TRIBUNAIS } from '../api/tribunais'
import { UFS } from '../api/ufs'
import { formatarDataSimples, formatarNumeroCNJ } from '../utils/formatadores'
import { adicionarHistorico } from '../utils/listasRapidas'
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

export type PayloadPublicacoes = ArgsBusca

export default function Publicacoes() {
  const { cliente } = useCliente()
  const { consumirPayload } = useNavegacao()

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
    if (dataInicio) args.data_disponibilizacao_inicio = dataInicio
    if (dataFim) args.data_disponibilizacao_fim = dataFim
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
      if (!dados.erro) {
        setBusca({ args, pagina })
        if (pagina === 1) {
          const resumo = args.numero_processo
            ? `Publicações do processo ${formatarNumeroCNJ(args.numero_processo)}`
            : `Publicações da OAB ${args.numero_oab}/${args.uf_oab ?? '?'}`
          adicionarHistorico({ tipo: 'publicacoes', args, resumo })
        }
      }
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

  useEffect(() => {
    const payload = consumirPayload<PayloadPublicacoes>('publicacoes')
    if (!payload) return
    setNumeroProcesso(payload.numero_processo ?? '')
    setTribunal(payload.sigla_tribunal?.toLowerCase() ?? '')
    setNumeroOab(payload.numero_oab ?? '')
    setUfOab(payload.uf_oab ?? '')
    executarBusca(payload, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const itensPorPaginaBusca = busca?.args.itens_por_pagina ?? 20
  const total = resultado?.total ?? 0
  const temPaginacao = busca && (total > itensPorPaginaBusca || busca.pagina > 1)

  return (
    <Flex direction="column" gap="6">
      <CabecalhoPagina
        titulo="Buscar no DJEN"
        descricao="Busca publicações no DJEN por número do processo ou OAB."
      />
      <form onSubmit={aoEnviar}>
        <Flex direction="column" gap="5">
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-numero-processo">Número do processo</label>
              <TextField.Root
                id="pub-numero-processo"
                placeholder="1006314-27.2023.8.26.0005"
                autoComplete="off"
                value={numeroProcesso}
                onChange={(e) => setNumeroProcesso(e.target.value)}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-sigla-tribunal">Tribunal</label>
              <Select.Root value={tribunal || '__todos__'} onValueChange={(v) => setTribunal(v === '__todos__' ? '' : v)}>
                <Select.Trigger id="pub-sigla-tribunal" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__todos__">Todos os tribunais</Select.Item>
                  {TRIBUNAIS.map((t) => (
                    <Select.Item key={t} value={t}>{t.toUpperCase()}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-numero-oab">Número da OAB</label>
              <TextField.Root
                id="pub-numero-oab"
                placeholder="330659"
                maxLength={6}
                autoComplete="off"
                value={numeroOab}
                onChange={(e) => setNumeroOab(e.target.value)}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-uf-oab">UF da OAB</label>
              <Select.Root value={ufOab || '__todas__'} onValueChange={(v) => setUfOab(v === '__todas__' ? '' : v)}>
                <Select.Trigger id="pub-uf-oab" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__todas__">Todas as UFs</Select.Item>
                  {UFS.map((uf) => (
                    <Select.Item key={uf} value={uf}>{uf}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-data-inicio">Publicado a partir de</label>
              <CampoData id="pub-data-inicio" value={dataInicio} onChange={v => setDataInicio(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-data-fim">Publicado até</label>
              <CampoData id="pub-data-fim" value={dataFim} onChange={v => setDataFim(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-itens">Itens por página</label>
              <TextField.Root
                id="pub-itens"
                type="number"
                min={1}
                max={100}
                value={itensPorPagina}
                onChange={(e) => setItensPorPagina(Number(e.target.value) || 20)}
              />
            </div>
          </div>
          <Text size="2" color="gray">Informe o número do processo ou a OAB. Os demais campos são opcionais.</Text>
          <div>
            <Button size="2" type="submit" disabled={consultando}>
              Buscar
            </Button>
          </div>
        </Flex>
      </form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="tabela" descricao="Consultando o DJEN…" />}
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
        {!consultando && resultado && !resultado.erro && (
          <Flex direction="column" gap="5">
            <Callout.Root color={(resultado.itens ?? []).length ? 'green' : 'blue'} size="1">
              <Callout.Icon><Info size={14} /></Callout.Icon>
              <Callout.Text>
                {total} {total === 1 ? 'publicação encontrada' : 'publicações encontradas'}
                {(resultado.itens ?? []).length
                  ? ` — Mostrando ${resultado.itens!.length} nesta página.`
                  : ' — Tente ajustar os filtros ou o período.'}
              </Callout.Text>
            </Callout.Root>
            <TabelaPublicacoes itens={resultado.itens ?? []} />
          </Flex>
        )}
      </div>
      {temPaginacao && busca && (
        <nav aria-label="Páginas de publicações" className="aj-paginacao">
          <Button variant="ghost" size="1" disabled={busca.pagina <= 1} onClick={() => executarBusca(busca.args, busca.pagina - 1)}>
            Anterior
          </Button>
          <Text size="2">Página {busca.pagina}</Text>
          <Button
            variant="ghost"
            size="1"
            disabled={busca.pagina * itensPorPaginaBusca >= total}
            onClick={() => executarBusca(busca.args, busca.pagina + 1)}
          >
            Próxima
          </Button>
        </nav>
      )}
    </Flex>
  )
}

function TabelaPublicacoes({ itens }: { itens: ItemPublicacao[] }) {
  if (itens.length === 0) return null

  return (
    <TabelaResponsiva principais={['Processo']}>
      <table aria-label="Publicações encontradas">
        <thead>
          <tr>
            <th aria-label="Expandir" />
            <th>Tribunal</th>
            <th>Tipo</th>
            <th>Classe</th>
            <th>Processo</th>
            <th>Disponibilizado em</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => (
            <LinhaPublicacao key={item.hash ?? i} item={item} />
          ))}
        </tbody>
      </table>
    </TabelaResponsiva>
  )
}

function LinhaPublicacao({ item }: { item: ItemPublicacao }) {
  const [expandida, setExpandida] = useState(false)
  return (
    <>
      <tr>
        <td>
          <Button variant="ghost" size="1" onClick={() => setExpandida((v) => !v)} aria-expanded={expandida} aria-label={expandida ? 'Recolher' : 'Expandir'}>
            {expandida ? '▾' : '▸'}
          </Button>
        </td>
        <td>{item.siglaTribunal ?? '?'}</td>
        <td><TextoTabela texto={item.tipoComunicacao ?? '—'} /></td>
        <td><TextoTabela texto={item.nomeClasse ?? 'Classe não informada'} /></td>
        <td>{item.numeroprocessocommascara ?? 'não informado'}</td>
        <td>{formatarDataSimples(item.data_disponibilizacao) || '—'}</td>
      </tr>
      {expandida && (
        <tr>
          <td colSpan={6}>
            <CartaoPublicacao item={item} />
          </td>
        </tr>
      )}
    </>
  )
}
