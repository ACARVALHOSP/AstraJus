import { Fragment, useEffect, useRef, useState } from 'react'
import { Button, Column, Grid, InlineNotification, Tag, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarNomeExibicao, formatarNumeroCNJ } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import { clienteDaParte, dataCapa, poloDaParte, type ClienteCapa, type ParteCapa } from './dadosCapa'
import type { Caso } from './ListaCasos'

type Advogado = { nome?: string; numero_oab?: string; uf_oab?: string; advogado?: Omit<Advogado, 'advogado'> }
type Movimento = { nome?: string; dataHora?: string }
type Capa = {
  aviso?: string
  nome_processo?: string | null; tipo_justica?: string | null; tribunal?: string | null
  classe?: string | null; orgao_julgador?: string | null; data_distribuicao?: string | null
  assuntos?: string[] | null; cidade?: string | null; uf?: string | null; grau?: string | null
  nivel_sigilo?: string | number | null; atualizado_em?: string | null; monitorando?: boolean
  partes?: ParteCapa[] | null; advogados?: Advogado[] | null; movimentos?: Movimento[] | null
  area_direito?: string | null; magistrado?: string | null; valor_causa?: number | null
  fase?: string | null; status_processo?: string | null
}
const campos = [
  ['area_direito', 'Área do direito'], ['magistrado', 'Magistrado'],
  ['valor_causa', 'Valor da causa (R$)'], ['fase', 'Fase'], ['status_processo', 'Status do processo'],
] as const
type Edicao = Record<typeof campos[number][0], string>
const editar = (capa: Capa) => Object.fromEntries(campos.map(([chave]) => [chave, String(capa[chave] ?? '')])) as Edicao

export default function CapaProcesso({ caso, numero, onAtualizado, onMovimentacoes }: {
  caso: Caso; numero: string; onAtualizado: (caso: Caso) => void; onMovimentacoes: () => void
}) {
  const { cliente } = useCliente()
  const [capa, setCapa] = useState<Capa | null>(null)
  const [edicao, setEdicao] = useState<Edicao>(() => editar({}))
  const [registros, setRegistros] = useState<ClienteCapa[]>([])
  const [erroClientes, setErroClientes] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [operacao, setOperacao] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState<{ erro: boolean; aviso?: boolean; texto: string } | null>(null)
  const [erroCarga, setErroCarga] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const vivo = useRef(true)
  const url = `/casos/${encodeURIComponent(caso.id)}/processos/${numero.replace(/\D/g, '')}/capa`

  useEffect(() => {
    let atual = true
    vivo.current = true
    Promise.allSettled([
      buscarJson<Capa>(cliente, url),
      buscarJson<{ clientes: ClienteCapa[] }>(cliente, '/clientes'),
    ]).then(([resultado, clientes]) => {
      if (!atual) return
      if (resultado.status === 'fulfilled') {
        setCapa(resultado.value)
        setEdicao(editar(resultado.value))
        setMensagem(null)
      } else {
        setErroCarga(true)
        setMensagem({ erro: true, texto: 'Falha ao carregar a capa. Tente novamente.' })
      }
      setRegistros(clientes.status === 'fulfilled' ? clientes.value.clientes ?? [] : [])
      setErroClientes(clientes.status === 'rejected')
      setCarregando(false)
    })
    return () => { atual = false; vivo.current = false }
  }, [cliente, url, tentativa])

  const pendente = Boolean(capa && campos.some(([chave]) => edicao[chave] !== String(capa[chave] ?? '')))
  const bloqueado = carregando || operacao !== null
  const tribunal = capa?.tribunal?.toLowerCase() || siglaTribunalPorNumero(numero)
  const invalido = edicao.valor_causa !== '' && (!Number.isFinite(Number(edicao.valor_causa)) || Number(edicao.valor_causa) < 0)

  async function executar(acao: 'salvar' | 'atualizar' | 'monitorar') {
    if (bloqueado || (acao === 'salvar' && invalido)) return
    setOperacao(acao)
    setMensagem(null)
    let avisoAtualizacao: string | undefined
    try {
      if (acao === 'salvar') {
        const corpo = Object.fromEntries(campos.map(([chave]) => [chave, chave === 'valor_causa'
          ? (edicao[chave] === '' ? null : Number(edicao[chave])) : edicao[chave].trim() || null]))
        const salva = await enviarJson<Capa>(cliente, url, corpo, 'PATCH')
        if (!vivo.current) return
        setCapa(anterior => ({ ...anterior, ...salva }))
        setEdicao(editar(salva))
      } else if (acao === 'atualizar') {
        const nova = await enviarJson<Capa>(cliente, `${url}/atualizar`, { tribunal })
        avisoAtualizacao = nova.aviso
        if (!vivo.current) return
        setCapa(nova)
        setEdicao(editar(nova))
        // A atualização também pode mudar título, classe e foro no cadastro.
        try {
          const atualizado = await buscarJson<Caso>(cliente, `/casos/${encodeURIComponent(caso.id)}`)
          if (vivo.current) onAtualizado(atualizado)
        } catch {
          if (vivo.current) setMensagem({ erro: true, texto: 'Capa atualizada. Não foi possível recarregar a identificação do processo.' })
          return
        }
      } else {
        const resultado = await enviarJson<{ monitorando: boolean }>(cliente, `${url}/monitorar`, {}, capa?.monitorando ? 'DELETE' : 'POST')
        if (!vivo.current) return
        setCapa(anterior => ({ ...anterior, monitorando: resultado.monitorando }))
      }
      if (vivo.current) setMensagem({ erro: false, aviso: Boolean(avisoAtualizacao), texto: acao === 'salvar' ? 'Capa salva.' : acao === 'atualizar' ? avisoAtualizacao || 'Capa atualizada com DataJud e DJEN.' : 'Monitoramento atualizado.' })
    } catch (erro) {
      if (vivo.current) setMensagem({ erro: true, texto: erro instanceof Error ? erro.message : 'Não foi possível concluir a operação.' })
    } finally {
      if (vivo.current) setOperacao(null)
    }
  }

  const vinculados = [caso.cliente_id, ...(caso.clientes_adicionais ?? [])].filter((id): id is string => Boolean(id))
  const partes = (capa?.partes ?? []).filter(p => p.nome?.trim())
  function participantes(polo: 'ativo' | 'passivo' | 'outro') {
    const grupo = partes.filter(p => poloDaParte(p) === polo)
    return grupo.length ? grupo.map((parte, i) => {
      const registro = clienteDaParte(parte, registros, vinculados)
      return <span className="capa-parte" key={`${parte.nome}-${i}`}>
        {formatarNomeExibicao(parte.nome)}
        {registro && <Tag type="blue" size="sm" title={`Cliente vinculado ao processo: ${registro.nome ?? ''}`}>Cliente</Tag>}
      </span>
    }) : 'Não informado pelo DJEN'
  }
  const advogados = [...new Set((capa?.advogados ?? []).map(item => {
    const a = item.advogado ?? item
    return a.nome ? `${formatarNomeExibicao(a.nome)}${a.numero_oab ? ` — OAB ${a.numero_oab}${a.uf_oab ? `/${a.uf_oab.toUpperCase()}` : ''}` : ''}` : ''
  }).filter(Boolean))].join('; ')
  const ultimo = [...(capa?.movimentos ?? [])].sort((a, b) => (b.dataHora ?? '').localeCompare(a.dataHora ?? ''))[0]
  const principais = [
    ['Tipo de justiça', capa?.tipo_justica], ['Nome do processo', formatarNomeExibicao(capa?.nome_processo || caso.titulo)],
    ['Tribunal', capa?.tribunal], ['Órgão julgador', capa?.orgao_julgador || caso.foro],
    ['Classe / ação', capa?.classe || caso.acao], ['Distribuição', dataCapa(capa?.data_distribuicao)],
  ]
  const mais = [
    ['Assuntos', capa?.assuntos?.join('; ')], ['Município / UF', [capa?.cidade, capa?.uf].filter(Boolean).join(' / ')],
    ['Grau', capa?.grau], ['Nível de sigilo', capa?.nivel_sigilo],
  ]
  return <section className="casos-resumo capa-processo" aria-label={`Capa do processo ${formatarNumeroCNJ(numero)}`} aria-busy={bloqueado}>
    <div className="casos-titulo-linha">
      <h2>Capa do processo</h2>
      <Button kind="secondary" size="sm" disabled={bloqueado || !capa || !tribunal || pendente} onClick={() => executar('atualizar')}>
        {operacao === 'atualizar' ? 'Atualizando capa…' : 'Atualizar capa (DataJud + DJEN)'}
      </Button>
    </div>
    <p className="capa-numero">{formatarNumeroCNJ(numero)}</p>
    <div aria-live="polite">
      {carregando && <p>Carregando capa…</p>}
      {mensagem && <InlineNotification kind={mensagem.erro ? 'error' : mensagem.aviso ? 'warning' : 'success'} title={mensagem.erro ? 'Não foi possível concluir' : mensagem.aviso ? 'Atualização parcial' : 'Sucesso'} subtitle={mensagem.texto} lowContrast hideCloseButton />}
    </div>
    {erroCarga && <Button kind="tertiary" size="sm" disabled={carregando} onClick={() => { setCarregando(true); setErroCarga(false); setTentativa(n => n + 1) }}>Tentar novamente</Button>}
    {capa && !carregando && <>
      <Grid withRowGap narrow fullWidth className="casos-formulario-grade">
        {principais.map(([rotulo, valor]) => <Column key={rotulo} sm={4} md={4} lg={8}><dl><dt>{rotulo}</dt><dd>{valor || 'Não informado'}</dd></dl></Column>)}
        <Column sm={4} md={8} lg={16}><dl>
          <dt>Polo ativo</dt><dd>{participantes('ativo')}</dd>
          <dt>Polo passivo</dt><dd>{participantes('passivo')}</dd>
          {partes.some(p => poloDaParte(p) === 'outro') && <><dt>Partes sem polo informado</dt><dd>{participantes('outro')}</dd></>}
          <dt>Advogados</dt><dd>{advogados || 'Não informado pelo DJEN'}</dd>
        </dl></Column>
        <Column sm={4} md={8} lg={16}><dl><dt>Última movimentação</dt><dd>{ultimo ? `${dataCapa(ultimo.dataHora)} · ${ultimo.nome || 'Sem descrição'}` : 'Nenhuma movimentação disponível.'}</dd></dl>
          <Button kind="ghost" size="sm" onClick={onMovimentacoes}>Ver movimentações</Button>
        </Column>
      </Grid>
      {erroClientes && <p className="casos-ajuda">Não foi possível identificar os clientes vinculados. As tags de cliente estão indisponíveis.</p>}
      <details className="capa-mais"><summary>Mais informações</summary><dl>{mais.map(([rotulo, valor]) => <Fragment key={rotulo}><dt>{rotulo}</dt><dd>{valor ?? 'Não informado'}</dd></Fragment>)}</dl></details>
      <form onSubmit={e => { e.preventDefault(); void executar('salvar') }}>
        <Grid withRowGap narrow fullWidth className="casos-formulario-grade">
          {campos.map(([chave, rotulo]) => <Column key={chave} sm={4} md={4} lg={8}>
            <TextInput id={`capa-${numero}-${chave}`} labelText={rotulo} value={edicao[chave]} disabled={bloqueado}
              type={chave === 'valor_causa' ? 'number' : 'text'} min={chave === 'valor_causa' ? 0 : undefined} step={chave === 'valor_causa' ? '0.01' : undefined}
              invalid={chave === 'valor_causa' && invalido} invalidText="Informe um valor maior ou igual a zero."
              onChange={e => setEdicao(anterior => ({ ...anterior, [chave]: e.target.value }))} />
          </Column>)}
        </Grid>
        <div className="capa-acoes"><Button kind="primary" size="sm" type="submit" disabled={bloqueado || !pendente || invalido}>{operacao === 'salvar' ? 'Salvando capa…' : 'Salvar capa'}</Button>
          <Button kind="ghost" size="sm" type="button" disabled={bloqueado} onClick={() => executar('monitorar')}>{operacao === 'monitorar' ? 'Atualizando monitoramento…' : capa.monitorando ? 'Parar avisos de publicações' : 'Receber avisos de publicações'}</Button>
        </div>
      </form>
      {pendente && <p className="casos-ajuda">Há alterações não salvas. Salve a capa antes de atualizar os dados externos.</p>}
      {!tribunal && <p className="casos-ajuda">Não foi possível determinar o tribunal pelo número CNJ.</p>}
      <p className="casos-ajuda">Monitoramento de publicações: {capa.monitorando ? 'ativo para seu usuário' : 'não ativo para seu usuário'}. A atualização diária da capa é independente desses avisos.</p>
      <p className="casos-ajuda">Fontes da consulta: DataJud (dados judiciais) e DJEN (partes e advogados). Os campos editáveis são mantidos pelo escritório.</p>
      <p className="casos-ajuda">Última gravação da capa: {dataCapa(capa.atualizado_em)}. A data também é alterada ao salvar campos manuais.</p>
    </>}
  </section>
}
