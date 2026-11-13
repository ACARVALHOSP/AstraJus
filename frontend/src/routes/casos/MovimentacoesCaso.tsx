import Carregamento from '../../Carregamento'
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Callout, Flex, Select, Text } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { consultaMovimentacoes, rotuloGrau, semRepetidos, type Fonte, type Movimento } from './consultasCaso'
import { formatarNumeroCNJ } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import './movimentacoes.scss'

type RespostaDataJud = {
  erro?: boolean
  mensagem?: string
  encontrado?: boolean
  processos?: Array<{ grau?: string; grau_descricao?: string; movimentos?: Array<{ nome?: string; dataHora?: string }> }>
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const LIMITE_INICIAL = 30
// Atos do juízo recebem marcador em destaque na linha do tempo.
const DESTAQUE = /decis|senten|despach|conclus|tutela|liminar|ac[óo]rd|julgament|homolog/i

function dataHoraPartes(iso?: string) {
  if (!iso) return { data: '—', hora: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { data: iso.slice(0, 10), hora: '' }
  const dois = (n: number) => String(n).padStart(2, '0')
  return { data: `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`, hora: `${dois(d.getHours())}:${dois(d.getMinutes())}` }
}
function chaveMes(iso?: string) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return { chave: 'sem-data', titulo: 'Sem data' }
  const nome = MESES[d.getMonth()]
  return { chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, titulo: `${nome[0].toUpperCase()}${nome.slice(1)} de ${d.getFullYear()}` }
}
function formatarQuando(iso?: string | null) {
  if (!iso) return ''
  const { data, hora } = dataHoraPartes(iso)
  return hora ? `${data} às ${hora}` : data
}

const SEM_NUMEROS: string[] = []
const SEM_MOVIMENTOS: Movimento[] = []

export default function MovimentacoesCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const [consultando, setConsultando] = useState(false)
  const [avisos, setAvisos] = useState<string[]>([])
  const [erroLocal, setErro] = useState<string | null>(null)
  // Resultado de "Atualizar do DataJud": sobrepõe os movimentos gravados na capa.
  const [consultaDataJud, setConsultaDataJud] = useState<{ movimentos: Movimento[]; fonte: Fonte } | null>(null)
  const [grau, setGrau] = useState('')
  const [numero, setNumero] = useState('')
  const [todos, setTodos] = useState(false)

  // Abertura: movimentos já gravados na capa de cada número (sem chamada externa).
  const consulta = useQuery({ ...consultaMovimentacoes(cliente, casoId), enabled: Boolean(cliente) })
  const numeros = consulta.data?.numeros ?? SEM_NUMEROS
  const movimentos = consultaDataJud?.movimentos ?? consulta.data?.movimentos ?? SEM_MOVIMENTOS
  const fonte = consultaDataJud?.fonte ?? consulta.data?.fonte ?? null
  const carregando = consulta.isLoading
  const erro = erroLocal ?? (consulta.error ? (consulta.error instanceof ErroMCP ? consulta.error.message : 'Falha ao carregar as movimentações.') : null)

  // "Atualizar do DataJud": consulta a API agora, sem gravar nada no processo.
  const consultarDataJud = useCallback(async () => {
    if (!numeros.length) { setErro('Informe o número CNJ no Cadastro para consultar as movimentações.'); return }
    setConsultando(true); setErro(null); setAvisos([])
    const todasMovs: Movimento[] = []
    const erros: string[] = []
    for (const n of numeros) {
      const tribunal = siglaTribunalPorNumero(n)
      if (!tribunal) { erros.push(`${formatarNumeroCNJ(n)}: não foi possível determinar o tribunal`); continue }
      try {
        const dados = (await cliente?.chamarFerramenta('consultar_processo_datajud', { numero_processo: n, tribunal })) as RespostaDataJud
        if (dados.erro || !dados.encontrado) { erros.push(`${formatarNumeroCNJ(n)}: ${dados.mensagem || 'não encontrado'}`); continue }
        for (const proc of dados.processos ?? []) {
          for (const m of proc.movimentos ?? []) todasMovs.push({ numero: n, grau: proc.grau_descricao || rotuloGrau(proc.grau), nome: m.nome, dataHora: m.dataHora })
        }
      } catch (e) {
        erros.push(`${formatarNumeroCNJ(n)}: ${e instanceof ErroMCP ? e.message : 'falha inesperada'}`)
      }
    }
    setAvisos(erros)
    if (todasMovs.length || !erros.length) {
      setConsultaDataJud({ movimentos: semRepetidos(todasMovs), fonte: { tipo: 'datajud', quando: new Date().toISOString() } })
    }
    setConsultando(false)
  }, [cliente, numeros])

  const graus = useMemo(() => [...new Set(movimentos.map(m => m.grau).filter((g): g is string => Boolean(g)))].sort(), [movimentos])
  const filtrados = useMemo(() => movimentos
    .filter(m => (!grau || m.grau === grau) && (!numero || m.numero === numero))
    .sort((a, b) => (b.dataHora ?? '').localeCompare(a.dataHora ?? '')), [movimentos, grau, numero])
  const exibidos = todos ? filtrados : filtrados.slice(0, LIMITE_INICIAL)
  const meses = useMemo(() => {
    const grupos: Array<{ chave: string; titulo: string; itens: Movimento[] }> = []
    for (const m of exibidos) {
      const { chave, titulo } = chaveMes(m.dataHora)
      const ultimo = grupos[grupos.length - 1]
      if (ultimo?.chave === chave) ultimo.itens.push(m)
      else grupos.push({ chave, titulo, itens: [m] })
    }
    return grupos
  }, [exibidos])
  const variosNumeros = numeros.length > 1

  return (
    <Flex direction="column" gap="4">
      <div className="aj-filtros-linha">
        {graus.length > 1 && (
          <div className="form-campo">
            <label className="form-campo-label" id="mov-grau-rotulo">Instância</label>
            <Select.Root value={grau || '__todas__'} onValueChange={v => setGrau(v === '__todas__' ? '' : v)}>
              <Select.Trigger aria-labelledby="mov-grau-rotulo" />
              <Select.Content>
                <Select.Item value="__todas__">Todas as instâncias</Select.Item>
                {graus.map(g => <Select.Item key={g} value={g}>{g}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
        )}
        {variosNumeros && (
          <div className="form-campo">
            <label className="form-campo-label" id="mov-numero-rotulo">Número</label>
            <Select.Root value={numero || '__todos__'} onValueChange={v => setNumero(v === '__todos__' ? '' : v)}>
              <Select.Trigger aria-labelledby="mov-numero-rotulo" />
              <Select.Content>
                <Select.Item value="__todos__">Todos os números ({numeros.length})</Select.Item>
                {numeros.map(n => <Select.Item key={n} value={n}>{formatarNumeroCNJ(n)}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
        )}
        <Text size="2" color="gray" className="mov-fonte">
          {fonte?.tipo === 'datajud' ? `DataJud · consultado ${formatarQuando(fonte.quando)}`
            : fonte?.quando ? `Capa do processo · atualizada ${formatarQuando(fonte.quando)}` : ''}
        </Text>
        <Button variant="soft" color="gray" size="2" onClick={consultarDataJud} disabled={consultando || carregando}>
          {consultando ? 'Consultando…' : 'Atualizar do DataJud'}
        </Button>
      </div>

      <div aria-live="polite">
        {(carregando || consultando) && <Carregamento tipo="cartoes" descricao={consultando ? 'Consultando o DataJud…' : 'Carregando…'} />}
        {erro && <Callout.Root color="red" size="1"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
        {avisos.length > 0 && (
          <Callout.Root color="yellow" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{avisos.join(' | ')}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && !consultando && !erro && !movimentos.length && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>
              {numeros.length ? 'Nenhuma movimentação gravada ainda. Use Atualizar do DataJud para consultar agora.' : 'Informe o número CNJ no Cadastro para consultar as movimentações.'}
            </Callout.Text>
          </Callout.Root>
        )}
      </div>

      {!carregando && !consultando && filtrados.length > 0 && (
        <div className="mov-linha-tempo">
          {meses.map(m => (
            <section key={m.chave} aria-label={m.titulo}>
              <h3 className="mov-mes">{m.titulo} <span>· {m.itens.length} movimento{m.itens.length > 1 ? 's' : ''}</span></h3>
              <ol>
                {m.itens.map((mov, i) => {
                  const { data, hora } = dataHoraPartes(mov.dataHora)
                  return (
                    <li key={`${mov.numero}-${mov.dataHora}-${i}`} className="mov-item">
                      <div className="mov-quando"><div className="mov-data">{data}</div>{hora && <div className="mov-hora">{hora}</div>}</div>
                      <span className={DESTAQUE.test(mov.nome ?? '') ? 'mov-marcador mov-marcador-destaque' : 'mov-marcador'} aria-hidden="true" />
                      <div className="mov-nome">
                        {mov.nome || 'Sem descrição'}
                        {variosNumeros && !numero && <div className="mov-numero">{formatarNumeroCNJ(mov.numero)}</div>}
                      </div>
                      <Badge color="gray" variant="soft" className="mov-grau">{mov.grau}</Badge>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {!carregando && !consultando && filtrados.length > LIMITE_INICIAL && (
        <Text size="2" color="gray">
          {todos ? `Mostrando todos os ${filtrados.length} movimentos. ` : `Mostrando os ${LIMITE_INICIAL} movimentos mais recentes de ${filtrados.length}. `}
          <button type="button" className="contato-nome-link" onClick={() => setTodos(v => !v)}>{todos ? 'Mostrar menos' : 'Ver todos'}</button>
        </Text>
      )}
    </Flex>
  )
}
