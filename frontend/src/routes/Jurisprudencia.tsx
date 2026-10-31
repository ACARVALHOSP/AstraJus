import Carregamento from '../Carregamento'
import { useState, type FormEvent } from 'react'
import {
  Button,
  DatePicker,
  DatePickerInput,
  Dropdown,
  Form,
  InlineNotification,
  Stack,
  Tag,
  Tile,
} from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { formatarDataSimples, formatarDdMmAaaa } from '../utils/formatadores'

type BuscarEm = 'ementa' | 'inteiro_teor' | 'ambos'

const OPCOES_BUSCAR_EM: { id: BuscarEm; label: string }[] = [
  { id: 'ementa', label: 'Ementa' },
  { id: 'inteiro_teor', label: 'Inteiro teor' },
  { id: 'ambos', label: 'Ementa e inteiro teor' },
]

type ResultadoJurisprudencia = {
  cdJurisprudencia?: number
  cdAcordao?: number
  classe?: string
  relator?: string
  comarca?: string
  orgao_julgador?: string
  data_julgamento?: string
  ementa?: string
  segredo_justica?: boolean
  pdf_url?: string | null
}

type RespostaJurisprudencia = {
  erro?: boolean
  mensagem?: string
  total_servidor?: number
  pagina?: number
  tamanho_pagina?: number
  resultados?: ResultadoJurisprudencia[]
}

export default function Jurisprudencia() {
  const { cliente } = useCliente()
  const [termo, setTermo] = useState('')
  const [buscarEm, setBuscarEm] = useState<BuscarEm>('ementa')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [relator, setRelator] = useState('')
  const [classe, setClasse] = useState('')
  const [comarca, setComarca] = useState('')
  const [orgaoJulgador, setOrgaoJulgador] = useState('')
  const [pagina, setPagina] = useState(1)

  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<RespostaJurisprudencia | null>(null)

  async function executar(paginaAlvo: number) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    if (!termo.trim()) {
      setErro('Informe o termo de pesquisa.')
      return
    }
    setConsultando(true)
    setErro(null)
    setPagina(paginaAlvo)
    try {
      const dados = (await cliente.chamarFerramenta('consultar_jurisprudencia_tjsp', {
        termo: termo.trim(),
        buscar_em: buscarEm,
        data_julgamento_inicio: dataInicio || null,
        data_julgamento_fim: dataFim || null,
        relator: relator.trim() || null,
        classe: classe.trim() || null,
        comarca: comarca.trim() || null,
        orgao_julgador: orgaoJulgador.trim() || null,
        pagina: paginaAlvo,
      })) as RespostaJurisprudencia
      setResultado(dados)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao consultar.')
    } finally {
      setConsultando(false)
    }
  }

  function aoEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    executar(1)
  }

  const totalPaginas = resultado?.total_servidor
    ? Math.ceil(resultado.total_servidor / (resultado.tamanho_pagina || 10))
    : 0

  return (
    <Stack gap={6}>
      <div>
        <h1>Jurisprudência</h1>
        <p>
          Consulta a acórdãos da base "Jurisprudência Selecionada" do TJSP. Os resultados vêm direto do tribunal —
          nada é digitado manualmente. Integração não oficial (sem API pública documentada), sujeita a mudanças sem
          aviso do tribunal.
        </p>
      </div>
      <Form onSubmit={aoEnviar}>
        <Stack gap={5}>
          <div className="aj-layout-49">
            <div style={{ flex: '1 1 auto' }}>
              <label htmlFor="juris-termo" className="cds--label">
                Pesquisa por termos
              </label>
              <input
                id="juris-termo"
                className="cds--text-input"
                placeholder="Ex.: danos morais, rescisão contratual, guarda compartilhada"
                autoComplete="off"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <Dropdown
              id="juris-buscar-em"
              titleText="Buscar em"
              label="Buscar em"
              items={OPCOES_BUSCAR_EM}
              itemToString={(item) => item?.label ?? ''}
              selectedItem={OPCOES_BUSCAR_EM.find((o) => o.id === buscarEm)}
              onChange={({ selectedItem }) => setBuscarEm((selectedItem?.id as BuscarEm) ?? 'ementa')}
            />
          </div>
          <DatePicker
            datePickerType="range"
            dateFormat="d/m/Y"
            onChange={(datas: Date[]) => {
              const [inicio, fim] = datas
              setDataInicio(inicio ? formatarDdMmAaaa(inicio) : '')
              setDataFim(fim ? formatarDdMmAaaa(fim) : '')
            }}
          >
            <DatePickerInput id="juris-data-inicio" labelText="Julgamento - início" placeholder="dd/mm/aaaa" />
            <DatePickerInput id="juris-data-fim" labelText="Julgamento - fim" placeholder="dd/mm/aaaa" />
          </DatePicker>
          <div className="aj-layout-49">
            <div style={{ flex: '1 1 auto' }}>
              <label htmlFor="juris-relator" className="cds--label">
                Relator(a)
              </label>
              <input
                id="juris-relator"
                className="cds--text-input"
                autoComplete="off"
                value={relator}
                onChange={(e) => setRelator(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: '1 1 auto' }}>
              <label htmlFor="juris-classe" className="cds--label">
                Classe
              </label>
              <input
                id="juris-classe"
                className="cds--text-input"
                autoComplete="off"
                value={classe}
                onChange={(e) => setClasse(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div className="aj-layout-49">
            <div style={{ flex: '1 1 auto' }}>
              <label htmlFor="juris-comarca" className="cds--label">
                Comarca
              </label>
              <input
                id="juris-comarca"
                className="cds--text-input"
                autoComplete="off"
                value={comarca}
                onChange={(e) => setComarca(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: '1 1 auto' }}>
              <label htmlFor="juris-orgao" className="cds--label">
                Órgão julgador
              </label>
              <input
                id="juris-orgao"
                className="cds--text-input"
                autoComplete="off"
                value={orgaoJulgador}
                onChange={(e) => setOrgaoJulgador(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <Button type="submit" disabled={consultando}>
            Pesquisar
          </Button>
        </Stack>
      </Form>
      <div aria-live="polite">
        {consultando && <Carregamento tipo="cartoes" descricao="Consultando a jurisprudência do TJSP…" />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {resultado?.erro && <InlineNotification kind="error" title="Erro" subtitle={resultado.mensagem} lowContrast hideCloseButton />}
        {!consultando && resultado && !resultado.erro && (
          <Stack gap={5}>
            <p>
              <strong>{resultado.total_servidor ?? 0}</strong> acórdãos encontrados
              {totalPaginas > 1 && ` — página ${resultado.pagina} de ${totalPaginas}`}
            </p>
            {(resultado.resultados ?? []).map((item, i) => (
              <CartaoJurisprudencia key={item.cdJurisprudencia ?? i} item={item} />
            ))}
            {!resultado.resultados?.length && (
              <InlineNotification kind="info" title="Nenhum resultado" subtitle="Tente ampliar os filtros ou o termo de busca." lowContrast hideCloseButton />
            )}
            {totalPaginas > 1 && (
              <div className="aj-layout-49">
                <Button kind="secondary" size="sm" disabled={consultando || pagina <= 1} onClick={() => executar(pagina - 1)}>
                  « Anterior
                </Button>
                <Button kind="secondary" size="sm" disabled={consultando || pagina >= totalPaginas} onClick={() => executar(pagina + 1)}>
                  Próxima »
                </Button>
              </div>
            )}
          </Stack>
        )}
      </div>
    </Stack>
  )
}

function CartaoJurisprudencia({ item }: { item: ResultadoJurisprudencia }) {
  return (
    <Tile>
      <Stack gap={3}>
        <div className="aj-layout-49">
          <Tag type="blue">TJSP</Tag>
          {item.classe && <Tag type="gray">{item.classe}</Tag>}
          {item.segredo_justica && <Tag type="red">Segredo de justiça</Tag>}
          <div style={{ flex: '1 1 auto' }} />
          <span>Julgado em {formatarDataSimples(item.data_julgamento)}</span>
        </div>
        {item.ementa && <p>{item.ementa}</p>}
        <p>
          {item.relator && (
            <>
              <strong>Relator(a):</strong> {item.relator}{' '}
            </>
          )}
          {item.comarca && (
            <>
              · <strong>Comarca:</strong> {item.comarca}{' '}
            </>
          )}
          {item.orgao_julgador && (
            <>
              · <strong>Órgão julgador:</strong> {item.orgao_julgador}
            </>
          )}
        </p>
        {item.pdf_url && (
          <a href={item.pdf_url} target="_blank" rel="noreferrer">
            Baixar PDF da ementa
          </a>
        )}
      </Stack>
    </Tile>
  )
}
