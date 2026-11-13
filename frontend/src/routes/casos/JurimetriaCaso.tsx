import Carregamento from '../../Carregamento'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Callout, Card, Flex, Heading, Select, Text } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { useModulos } from '../../api/ModulosContext'
import { usePerfil } from '../../api/PerfilContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson } from '../../api/rest'
import { GraficoDesfechos } from '../../modulos/jurimetria/graficos'
import { SeletorArvore, type CampoArvore } from '../../modulos/jurimetria/seletores'
import { formatarNumeroCNJ, formatarPercentual } from '../../utils/formatadores'
import {
  analisar, consultasDe, ehTjsp, escolhaInicial, pendencias, periodoPadrao, textoResumo,
  type Analise, type Candidato, type CampoFiltro, type Consulta, type Escolha, type Resolucao, type ResolucaoCampo, type RespostaConsulta,
} from './jurimetriaCaso'
import './jurimetria-caso.scss'

type Capa = { classe?: string | null; orgao_julgador?: string | null; assuntos?: string[] | null }
type Estado = { fase: 'carregando' } | { fase: 'erro'; mensagem: string } | { fase: 'ok'; dados: RespostaConsulta }

const ROTULO: Record<CampoFiltro, string> = { vara: 'Vara', classe: 'Classe', assunto: 'Assunto' }

/** Aba "Jurimetria" da ficha: como as sentenças de 1º grau do TJSP costumam sair para a vara e o assunto deste processo. */
export default function JurimetriaCaso({ casoId }: { casoId: string }) {
  const { cliente } = useCliente()
  const { modulos, carregado } = useModulos()
  const { abaPermitida } = usePerfil()
  const [escolhido, setEscolhido] = useState<string | null>(null)

  const base = useQuery({
    queryKey: ['caso-jurimetria-base', cliente?.token, casoId],
    enabled: Boolean(cliente),
    queryFn: ({ signal }) => buscarJson<{ processos?: string[] }>(cliente, `/casos/${casoId}`, signal).then(r => (r.processos ?? []).filter(ehTjsp)),
  })
  const numeros = base.data ?? []
  const numero = escolhido && numeros.includes(escolhido) ? escolhido : numeros[0] ?? ''

  const capa = useQuery({
    queryKey: ['caso-capa-jurimetria', cliente?.token, casoId, numero],
    enabled: Boolean(cliente && numero),
    // Sem capa gravada o painel continua útil: a pessoa escolhe os filtros na mão.
    queryFn: ({ signal }) => buscarJson<Capa>(cliente, `/casos/${casoId}/processos/${numero.replace(/\D/g, '')}/capa`, signal).catch((): Capa => ({})),
  })
  const assunto = capa.data?.assuntos?.[0] ?? ''
  const resolucao = useQuery({
    queryKey: ['jurimetria-resolver', cliente?.token, numero, capa.data?.orgao_julgador ?? '', capa.data?.classe ?? '', assunto],
    enabled: Boolean(cliente && numero && capa.data),
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => buscarJson<Resolucao>(cliente,
      `/cjpg-arvore/resolver?numero=${encodeURIComponent(numero)}&vara=${encodeURIComponent(capa.data?.orgao_julgador ?? '')}`
      + `&classe=${encodeURIComponent(capa.data?.classe ?? '')}&assunto=${encodeURIComponent(assunto)}`, signal),
  })

  const ligado = modulos.some(m => m.id === 'jurimetria' && m.ativo)
  if (carregado && !ligado) return <Aviso cor="gray" texto="O módulo Jurimetria está desligado neste escritório. Um administrador pode ligá-lo em Configurações › Módulos." />
  if (!abaPermitida('jurimetria')) return <Aviso cor="gray" texto="Seu perfil não tem acesso à Pesquisa, que inclui a Jurimetria. Peça ao administrador." />
  if (base.isLoading) return <Carregamento tipo="texto" descricao="Lendo o processo…" />
  if (base.isError) return <Aviso cor="red" texto="Não foi possível ler o processo. Tente de novo." />
  if (!numeros.length) return <Aviso cor="gray" texto="A jurimetria cobre só sentenças do TJSP. Este processo não tem número do TJSP (CNJ com .8.26.)." />
  if (capa.isLoading || resolucao.isLoading) return <Carregamento tipo="texto" descricao="Identificando vara, classe e assunto…" />

  return (
    <div className="jurimetria-caso">
      {numeros.length > 1 && (
        <Flex align="center" gap="2">
          <Text size="2">Número:</Text>
          <Select.Root value={numero} onValueChange={setEscolhido}>
            <Select.Trigger aria-label="Número do processo" />
            <Select.Content>{numeros.map(n => <Select.Item key={n} value={n}>{formatarNumeroCNJ(n)}</Select.Item>)}</Select.Content>
          </Select.Root>
        </Flex>
      )}
      {resolucao.isError && <Aviso cor="amber" texto="Não foi possível identificar os filtros automaticamente. Escolha vara, classe e assunto abaixo." />}
      <Painel key={numero} resolucao={resolucao.data} />
    </div>
  )
}

function Aviso({ cor, texto }: { cor: 'gray' | 'red' | 'amber'; texto: string }) {
  return (
    <Callout.Root color={cor} size="1" role={cor === 'red' ? 'alert' : 'status'}>
      <Callout.Icon>{cor === 'gray' ? <Info size={14} /> : <AlertTriangle size={14} />}</Callout.Icon>
      <Callout.Text>{texto}</Callout.Text>
    </Callout.Root>
  )
}

function Painel({ resolucao }: { resolucao: Resolucao | undefined }) {
  const { cliente } = useCliente()
  const [escolha, setEscolha] = useState<Escolha>(() => escolhaInicial(resolucao))
  const [periodo] = useState(() => periodoPadrao(new Date()))
  const [estados, setEstados] = useState<Partial<Record<Consulta['chave'], Estado>>>({})
  const [calculadoCom, setCalculadoCom] = useState<string | null>(null)
  const consultas = consultasDe(escolha, periodo)
  const faltando = pendencias(escolha)
  const assinatura = JSON.stringify(consultas.map(c => c.params))
  const desatualizado = calculadoCom !== null && calculadoCom !== assinatura
  const calculando = Object.values(estados).some(e => e.fase === 'carregando')

  function trocar(campo: CampoFiltro, valor: Candidato | null) { setEscolha(e => ({ ...e, [campo]: valor })) }

  async function calcular() {
    if (!cliente || calculando || faltando.length) return
    setCalculadoCom(assinatura)
    setEstados(Object.fromEntries(consultas.map(c => [c.chave, { fase: 'carregando' } as Estado])))
    await Promise.all(consultas.map(async c => {
      let estado: Estado
      try {
        const dados = (await cliente.chamarFerramenta('consultar_jurimetria_cjpg', c.params)) as RespostaConsulta
        estado = dados.erro ? { fase: 'erro', mensagem: dados.mensagem || 'O e-SAJ não respondeu como esperado.' } : { fase: 'ok', dados }
      } catch (e) {
        estado = { fase: 'erro', mensagem: e instanceof ErroMCP ? e.message : 'Não foi possível concluir a consulta. Tente de novo.' }
      }
      setEstados(atual => ({ ...atual, [c.chave]: estado }))
    }))
  }

  return (
    <Flex direction="column" gap="4">
      <Card variant="surface">
        <Flex direction="column" gap="3">
          <div>
            <Heading as="h3" size="3">Filtros desta consulta</Heading>
            <Text as="p" size="2" color="gray">Confira vara, classe e assunto: os números valem só para o que estiver selecionado aqui.</Text>
          </div>
          {resolucao?.foro && <Text size="2">Foro pelo número do processo: <strong>{resolucao.foro.nome}</strong></Text>}
          <div className="jurimetria-caso__filtros">
            {(['vara', 'classe', 'assunto'] as CampoFiltro[]).map(campo => (
              <CampoEscolha key={campo} campo={campo} resolucao={resolucao?.[campo]} escolha={escolha[campo]} onEscolher={v => trocar(campo, v)} />
            ))}
          </div>
          <Text size="2" color="gray">Sentenças publicadas de {periodo.inicio} a {periodo.fim} (os últimos 12 meses, o máximo que o e-SAJ aceita por consulta).</Text>
          <Flex gap="3" align="center" wrap="wrap">
            <Button disabled={calculando || faltando.length > 0} onClick={() => void calcular()}>{calculando ? 'Consultando…' : calculadoCom ? 'Calcular de novo' : 'Calcular jurimetria'}</Button>
            {faltando.length > 0 && <Text size="2" color="gray">{faltando.join(' ')}</Text>}
            {calculando && <Text size="2" color="gray" role="status">Consultando o e-SAJ; costuma levar de 5 a 15 segundos.</Text>}
          </Flex>
        </Flex>
      </Card>

      {desatualizado && <Aviso cor="amber" texto="Os filtros mudaram desde o último cálculo. Os números abaixo são dos filtros anteriores; calcule de novo." />}
      <div className={`jurimetria-caso__cartoes${desatualizado ? ' jurimetria-caso__cartoes--antigo' : ''}`} aria-live="polite">
        {consultas.filter(c => estados[c.chave]).map(c => <Cartao key={c.chave} consulta={c} estado={estados[c.chave]!} periodo={periodo} />)}
      </div>
      <Text size="1" color="gray">
        Referência histórica de sentenças de 1º grau do TJSP publicadas no CJPG; o desfecho e o valor são identificados automaticamente
        no texto e podem errar. Não é previsão do resultado nem parecer. Ao e-SAJ vão só códigos de vara, classe e assunto e o período.
      </Text>
    </Flex>
  )
}

function CampoEscolha({ campo, resolucao, escolha, onEscolher }: {
  campo: CampoFiltro; resolucao: ResolucaoCampo | undefined; escolha: Candidato | null; onEscolher: (c: Candidato | null) => void
}) {
  const candidatos = resolucao?.candidatos ?? []
  return (
    <div className="jurimetria-caso__campo">
      <Text as="div" size="2" weight="bold">{ROTULO[campo]}</Text>
      {escolha ? (
        <Flex direction="column" gap="1" align="start">
          <Badge color="green" variant="soft" size="2">{escolha.nome}</Badge>
          {escolha.caminho && escolha.caminho !== escolha.nome && <Text size="1" color="gray">{escolha.caminho}</Text>}
          <Button variant="ghost" size="1" onClick={() => onEscolher(null)}>Trocar</Button>
        </Flex>
      ) : (
        <Flex direction="column" gap="2">
          <Text size="1" color={candidatos.length ? 'amber' : 'gray'}>
            {resolucao?.ambiguo ? 'Há mais de um com este nome; escolha pelo ramo.' : candidatos.length ? 'Confirme qual é:' : 'Não foi possível identificar sozinho. Busque abaixo.'}
          </Text>
          {candidatos.map(c => (
            <button key={c.id} type="button" className="jurimetria-caso__candidato" onClick={() => onEscolher(c)}>
              <span>{c.nome}</span>
              <small>{c.caminho !== c.nome ? c.caminho : ''}{c.caminho !== c.nome ? ' · ' : ''}{formatarPercentual(c.confianca)} de semelhança</small>
            </button>
          ))}
          <SeletorArvore campo={campo as CampoArvore} id={`jc-${campo}`} rotulo="Buscar outro" placeholder={`Buscar ${ROTULO[campo].toLowerCase()}`} valor={[]}
            onChange={lista => { const o = lista[lista.length - 1]; if (o) onEscolher({ id: o.id, nome: o.nome, caminho: o.nome, confianca: 1 }) }} />
        </Flex>
      )}
    </div>
  )
}

function Cartao({ consulta, estado, periodo }: { consulta: Consulta; estado: Estado; periodo: { inicio: string; fim: string } }) {
  return (
    <Card variant="surface" className="jurimetria-caso__cartao">
      <Flex direction="column" gap="3">
        <div>
          <Heading as="h3" size="3">{consulta.titulo}</Heading>
          <Text as="p" size="2" color="gray">{consulta.descricao}</Text>
        </div>
        {estado.fase === 'carregando' && <Carregamento tipo="texto" descricao="Consultando o e-SAJ…" />}
        {estado.fase === 'erro' && <Aviso cor="red" texto={estado.mensagem} />}
        {estado.fase === 'ok' && <Resultado dados={estado.dados} periodo={periodo} />}
      </Flex>
    </Card>
  )
}

function Resultado({ dados, periodo }: { dados: RespostaConsulta; periodo: { inicio: string; fim: string } }) {
  const a: Analise = analisar(dados)
  return (
    <Flex direction="column" gap="3">
      {a.classificados > 0 && (
        <div>
          {a.amostraPequena ? (
            <Text as="div" size="5" weight="bold">{a.comProcedencia} de {a.classificados}</Text>
          ) : (
            <Text as="div" size="7" weight="bold">{formatarPercentual(a.taxaProcedencia)}</Text>
          )}
          <Text size="2" color="gray">
            {a.amostraPequena ? 'sentenças classificadas com alguma procedência (percentual omitido: amostra pequena)' : 'com alguma procedência (procedente ou parcial)'}
          </Text>
          {a.amostraPequena && <div><Badge color="amber" variant="soft">Amostra pequena</Badge></div>}
        </div>
      )}
      <GraficoDesfechos contagens={a.contagens} total={a.classificados} />
      <Text size="2">{textoResumo(a, periodo)}</Text>
      <Text size="1" color="gray">
        {a.classificados} de {a.buscados} sentenças com desfecho identificado
        {a.cobertura !== null && a.cobertura < 0.6 ? ' (cobertura baixa: muitas decisões sem texto de dispositivo)' : ''}.
      </Text>
      {(dados.avisos ?? []).map((aviso, i) => <Text key={i} size="1" color="gray">{aviso}</Text>)}
    </Flex>
  )
}
