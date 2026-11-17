import { useState, type FormEvent } from 'react'
import { Badge, Button, Callout, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import Carregamento from '../../Carregamento'
import CampoData from '../../CampoData'
import TabelaResponsiva from '../../TabelaResponsiva'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { TRIBUNAIS } from '../../api/tribunais'
import { formatarDataSimples, formatarNumeroCNJ } from '../../utils/formatadores'
import CampoTpu from './CampoTpu'
import { FILTROS_VAZIOS, juntarPaginas, montarArgsBusca, type FiltrosBusca, type ItemTpu, type ResumoProcesso } from './buscaProcessos'

type Resposta = {
  erro?: boolean
  mensagem?: string
  encontrado?: boolean
  total?: number
  processos?: ResumoProcesso[]
  proximo_cursor?: unknown[] | null
  tem_mais?: boolean
}

/** Busca por classe, órgão julgador e assunto (códigos das tabelas do CNJ), com "Carregar mais". */
export default function BuscaProcessos({ onAbrir }: { onAbrir: (tribunal: string, numero: string) => void }) {
  const { cliente } = useCliente()
  const [f, setF] = useState<FiltrosBusca>(FILTROS_VAZIOS)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [itens, setItens] = useState<ResumoProcesso[] | null>(null)
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<unknown[] | null>(null)
  // Tribunal da última busca concluída: "Abrir" e "Carregar mais" valem para ele, mesmo que o formulário mude.
  const [tribunalBuscado, setTribunalBuscado] = useState('')
  // Nomes dos itens escolhidos nas tabelas do CNJ (o filtro guarda só o código).
  const [classeTpu, setClasseTpu] = useState<ItemTpu | null>(null)
  const [assuntoTpu, setAssuntoTpu] = useState<ItemTpu | null>(null)
  // Nome do órgão julgador escolhido na tabela de resultados (o filtro guarda só o código).
  const [orgaoNome, setOrgaoNome] = useState('')
  const mudar = (parcial: Partial<FiltrosBusca>) => setF(atual => ({ ...atual, ...parcial }))

  async function buscar(mais: boolean, filtros: FiltrosBusca = f) {
    if (!cliente) {
      setErro('Informe o seu token na aba Acesso e clique em Conectar antes de consultar.')
      return
    }
    const montado = montarArgsBusca(mais ? { ...filtros, tribunal: tribunalBuscado } : filtros, mais ? cursor : null)
    if ('erro' in montado) {
      setErro(montado.erro)
      return
    }
    setBuscando(true)
    setErro(null)
    try {
      const dados = (await cliente.chamarFerramenta('buscar_processos_datajud', montado.args)) as Resposta
      if (dados.erro) {
        setErro(dados.mensagem ?? 'A busca não pôde ser concluída.')
        return
      }
      const novos = dados.processos ?? []
      setItens(atual => (mais ? juntarPaginas(atual ?? [], novos) : novos))
      setTotal(dados.total ?? novos.length)
      setCursor(dados.tem_mais ? dados.proximo_cursor ?? null : null)
      setTribunalBuscado(String(montado.args.tribunal))
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Não foi possível concluir a busca. Tente de novo.')
    } finally {
      setBuscando(false)
    }
  }

  /** Clique no órgão julgador de um resultado: filtra pelo código dele, no tribunal da busca, e busca de novo. */
  function filtrarPorOrgao(codigo: number, nome: string) {
    const novos = { ...f, tribunal: tribunalBuscado, orgao: String(codigo) }
    setF(novos)
    setOrgaoNome(nome)
    setItens(null)
    setCursor(null)
    buscar(false, novos)
  }

  function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    setItens(null)
    setCursor(null)
    buscar(false)
  }

  return (
    <Flex direction="column" gap="5">
      <form onSubmit={aoEnviar}>
        <Flex direction="column" gap="5">
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-tribunal">Tribunal</label>
              <Select.Root value={f.tribunal || '__none__'} onValueChange={v => { mudar({ tribunal: v === '__none__' ? '' : v, ...(v !== f.tribunal ? { orgao: '' } : {}) }); if (v !== f.tribunal) setOrgaoNome('') }}>
                <Select.Trigger id="busca-tribunal" placeholder="Escolha o tribunal" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="__none__">Escolha o tribunal</Select.Item>
                  {TRIBUNAIS.map(t => <Select.Item key={t} value={t}>{t.toUpperCase()}</Select.Item>)}
                </Select.Content>
              </Select.Root>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-classe">Classe</label>
              <CampoTpu id="busca-classe" tabela="classes" valor={f.classe} escolhido={classeTpu}
                onChange={(classe, item) => { mudar({ classe }); setClasseTpu(item) }} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-orgao">Órgão julgador</label>
              {f.orgao && orgaoNome ? (
                <Flex align="center" justify="between" gap="3" className="aj-busca-escolhido">
                  <Text size="2" weight="medium">{orgaoNome} ({f.orgao})</Text>
                  <Button type="button" variant="ghost" size="1" onClick={() => { mudar({ orgao: '' }); setOrgaoNome('') }}>Trocar</Button>
                </Flex>
              ) : (
                <TextField.Root id="busca-orgao" inputMode="numeric" autoComplete="off" placeholder="Código, ou clique no órgão de um resultado"
                  value={f.orgao} onChange={e => mudar({ orgao: e.target.value })} />
              )}
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-assunto">Assunto</label>
              <CampoTpu id="busca-assunto" tabela="assuntos" valor={f.assunto} escolhido={assuntoTpu}
                onChange={(assunto, item) => { mudar({ assunto }); setAssuntoTpu(item) }} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-inicio">Ajuizado a partir de</label>
              <CampoData id="busca-inicio" value={f.inicio} onChange={inicio => mudar({ inicio })} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="busca-fim">Ajuizado até</label>
              <CampoData id="busca-fim" value={f.fim} onChange={fim => mudar({ fim })} />
            </div>
          </div>
          <Text size="1" color="gray">
            Classe e assunto vêm das Tabelas Processuais Unificadas do CNJ: digite o nome e escolha na lista. Para filtrar por órgão julgador,
            clique no nome dele em um resultado. Informe ao menos um filtro. A busca é feita em um tribunal por vez e não traz as partes
            (o DataJud não as divulga).
          </Text>
          <div>
            <Button size="2" type="submit" disabled={buscando}>Buscar processos</Button>
          </div>
        </Flex>
      </form>
      <div aria-live="polite">
        {buscando && !itens && <Carregamento tipo="detalhe" descricao="Buscando no DataJud (pode levar até dois minutos)…" />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {itens && !itens.length && !erro && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum processo encontrado com esses filtros.</Callout.Text>
          </Callout.Root>
        )}
        {itens && itens.length > 0 && (
          <Flex direction="column" gap="4">
            <Text size="2" color="gray">Mostrando {itens.length} de {total.toLocaleString('pt-BR')} processo(s), dos mais recentes aos mais antigos.</Text>
            <TabelaResponsiva principais={['Processo', 'Classe']}>
              <table aria-label="Processos encontrados no DataJud">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Classe</th>
                    <th>Órgão julgador</th>
                    <th>Ajuizado em</th>
                    <th className="tabela-acoes">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map(p => (
                    <tr key={`${p.numeroProcesso}|${p.grau}`}>
                      <td>
                        {formatarNumeroCNJ(p.numeroProcesso) || 'não informado'}{' '}
                        <Badge color="purple" size="1">{p.grau ?? '?'}</Badge>
                      </td>
                      <td>{p.classe ?? 'não informada'}{p.classe_caminho?.length ? <Text as="div" size="1" color="gray">{p.classe_caminho.slice(-2).join(' › ')}</Text> : null}</td>
                      <td>
                        {p.orgaoJulgador && p.orgao_julgador_codigo
                          ? (
                            <Button type="button" variant="ghost" size="1" disabled={buscando}
                              title="Filtrar por este órgão julgador" onClick={() => filtrarPorOrgao(p.orgao_julgador_codigo as number, p.orgaoJulgador as string)}>
                              {p.orgaoJulgador}
                            </Button>
                          )
                          : (p.orgaoJulgador ?? 'não informado')}
                        {p.orgao_julgador_codigo ? <Text as="div" size="1" color="gray">código {p.orgao_julgador_codigo}</Text> : null}
                      </td>
                      <td>{formatarDataSimples(p.dataAjuizamento)}</td>
                      <td className="tabela-acoes">
                        {p.numeroProcesso && (
                          <Button size="1" variant="soft" onClick={() => onAbrir(tribunalBuscado, p.numeroProcesso as string)}>Abrir</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaResponsiva>
            {cursor && (
              <div>
                <Button size="2" variant="soft" color="gray" disabled={buscando} onClick={() => buscar(true)}>
                  {buscando ? 'Carregando…' : 'Carregar mais'}
                </Button>
              </div>
            )}
          </Flex>
        )}
      </div>
    </Flex>
  )
}
