import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Column, Grid, InlineNotification, Modal, Select, SelectItem, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples, formatarNomeExibicao } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import { numeroPublicacao, type PublicacaoOab } from './dados'
import { calcularPrazo, dataValida, detectarDias, REGRAS_PRAZO, type CalendarioForense, type ProvedorCalendario, type RegraPrazo } from './prazos'
import { imprimirDemonstrativoPrazo } from './impressaoPrazo'

export default function AtividadePublicacao({ publicacao, onClose, onConcluido, provedorCalendario }: {
  publicacao: PublicacaoOab; onClose: () => void; onConcluido: (mensagem: string) => void; provedorCalendario?: ProvedorCalendario
}) {
  const { cliente } = useCliente()
  const numero = numeroPublicacao(publicacao), casoId = publicacao.caso_id!
  const [titulo, setTitulo] = useState(`Revisar ${publicacao.dados?.tipoComunicacao || 'publicação DJEN'}`)
  const [dias, setDias] = useState(String(detectarDias(publicacao.dados?.texto || '') ?? ''))
  const [base, setBase] = useState(publicacao.dados?.data_disponibilizacao?.slice(0, 10) || '')
  const [regra, setRegra] = useState<RegraPrazo>('dje')
  const [municipio, setMunicipio] = useState('')
  const [tribunal, setTribunal] = useState(publicacao.dados?.siglaTribunal?.toLowerCase() || siglaTribunalPorNumero(numero) || '')
  const [suspensaoCpc, setSuspensaoCpc] = useState(false)
  const [responsavel, setResponsavel] = useState('')
  const [responsaveis, setResponsaveis] = useState<string[]>([])
  const [calendario, setCalendario] = useState<CalendarioForense | null>(null)
  const [resultado, setResultado] = useState<ReturnType<typeof calcularPrazo> | null>(null)
  const [final, setFinal] = useState('')
  const [revisado, setRevisado] = useState(false)
  const [calculando, setCalculando] = useState(false)
  const [erroCalculo, setErroCalculo] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const atividadeCriada = useRef<string | null>(null)
  const [jaCriada, setJaCriada] = useState(false)
  const trava = useRef(false)
  const [carregandoContexto, setCarregandoContexto] = useState(true)

  useEffect(() => {
    let ativo = true
    Promise.allSettled([
      buscarJson<{ responsaveis: string[] }>(cliente, '/responsaveis'),
      buscarJson<{ cidade?: string; tribunal?: string }>(cliente, `/casos/${encodeURIComponent(casoId)}/processos/${numero}/capa`),
    ]).then(([equipe, capa]) => {
      if (!ativo) return
      if (equipe.status === 'fulfilled') setResponsaveis(equipe.value.responsaveis)
      if (capa.status === 'fulfilled') { setMunicipio(capa.value.cidade || ''); if (capa.value.tribunal) setTribunal(capa.value.tribunal.toLowerCase()) }
      setCarregandoContexto(false)
    })
    return () => { ativo = false }
  }, [cliente, casoId, numero])

  useEffect(() => {
    let ativo = true
    // Reset derived results whenever the external calendar query context changes.
    // eslint-disable-next-line react/set-state-in-effect
    setResultado(null); setFinal(''); setRevisado(false); setCalendario(null); setErroCalculo(''); setCalculando(false)
    if (carregandoContexto || !dataValida(base) || !Number.isInteger(Number(dias)) || Number(dias) < 1 || Number(dias) > 999 || !municipio.trim() || !tribunal.trim() || !cliente) return
    const temporizador = setTimeout(async () => {
      setCalculando(true)
      try {
        // This adapter can be replaced with a provider covering official acts/suspensions.
        // Existing API only guarantees a holiday list, so completeness stays false.
        const provedor: ProvedorCalendario = provedorCalendario ?? (async contexto => {
          const respostas = await Promise.all(contexto.anos.map(async ano => {
            const r = await cliente.chamarFerramenta('buscar_feriados_forenses', { municipio: contexto.municipio, tribunal: contexto.tribunal, ano }) as { erro?: boolean; mensagem?: string; municipio?: string; fonte?: string; feriados?: Array<{ data: string; descricao: string }> }
            if (r.erro || !Array.isArray(r.feriados)) throw new Error(r.mensagem || 'Calendário indisponível.')
            return r
          }))
          return {
            ...contexto, municipio: respostas[0].municipio || contexto.municipio, completo: false,
            fonte: respostas.some(r => r.fonte === 'calculado') ? 'Feriados nacionais e estaduais calculados; cobertura municipal não verificada' : 'Feriados TJSP por município; suspensões e provimentos ainda não verificados',
            consultadoEm: new Date().toISOString(), impedimentos: respostas.flatMap(r => r.feriados!.filter(f => dataValida(f.data)).map(f => ({ inicio: f.data, fim: f.data, descricao: f.descricao }))),
          }
        })
        // Fetch every intervening year and recompute until the entire result is covered.
        const anoBase = Number(base.slice(0, 4))
        let anos = [anoBase], calendarioAtual: CalendarioForense, calculo: ReturnType<typeof calcularPrazo>
        for (let passo = 0; ; passo++) {
          if (passo > 12) throw new Error('Intervalo de calendário não suportado.')
          calendarioAtual = await provedor({ municipio: municipio.trim(), tribunal: tribunal.trim().toLowerCase(), anos })
          calculo = calcularPrazo(base, Number(dias), regra, calendarioAtual, suspensaoCpc)
          const anoFinal = Number(calculo.dataFinal.slice(0, 4))
          if (anos.includes(anoFinal)) break
          anos = Array.from({ length: anoFinal - anoBase + 1 }, (_, i) => anoBase + i)
        }
        if (!ativo) return
        setCalendario(calendarioAtual); setResultado(calculo); setFinal(calculo.dataFinal)
      } catch (e) { if (ativo) setErroCalculo((e as Error).message) } finally { if (ativo) setCalculando(false) }
    }, 350)
    return () => { ativo = false; clearTimeout(temporizador) }
  }, [cliente, base, dias, municipio, tribunal, regra, suspensaoCpc, carregandoContexto, provedorCalendario])

  async function salvar() {
    if (trava.current || calculando || carregandoContexto) return
    if (!titulo.trim()) { setErro('Informe o título.'); return }
    if (revisado && !dataValida(final)) { setErro('Informe uma data final válida para o prazo revisado.'); return }
    trava.current = true; setSalvando(true); setErro('')
    try {
      if (!atividadeCriada.current) {
        const memoria = {
          publicacao: publicacao.hash, numero_processo: numero, link: publicacao.dados?.link || null,
          situacao_prazo: revisado ? 'revisado' : 'pendente_revisao', data_final: revisado ? final : null,
          sugestao_data_final: resultado?.dataFinal || null, quantidade_dias: Number(dias) || null,
          data_base: base || null, termo_inicial: resultado?.termoInicial || null, regra: REGRAS_PRAZO[regra],
          suspensao_cpc: suspensaoCpc, calendario: calendario ? {
            municipio: calendario.municipio, tribunal: calendario.tribunal, anos: calendario.anos,
            fonte: calendario.fonte, consultadoEm: calendario.consultadoEm, completo: calendario.completo,
            quantidade_impedimentos: calendario.impedimentos.length,
          } : null, ajuste_manual: revisado && final !== resultado?.dataFinal,
        }
        const a = await enviarJson<{ id: string | number }>(cliente, `/casos/${encodeURIComponent(casoId)}/atividades`, {
          tipo: 'prazo', titulo: titulo.trim(), data: revisado ? final : null, responsavel: responsavel || null,
          observacoes: `${revisado ? 'Prazo revisado antes da confirmação.' : 'Pendente de revisão do prazo; sem vencimento confirmado.'}\nPublicação DJEN: ${publicacao.hash}\n${JSON.stringify(memoria)}`,
        })
        atividadeCriada.current = String(a.id); setJaCriada(true)
      }
      const r = await enviarJson<{ hashes_falharam?: string[] }>(cliente, '/publicacoes-oab/status', { hashes: [publicacao.hash], status: 'tratada' })
      if (r.hashes_falharam?.length) throw new Error('Não foi possível atualizar o status da publicação.')
      onConcluido(revisado ? 'Atividade criada com prazo revisado. Publicação marcada como tratada.' : 'Atividade criada com prazo pendente de revisão, sem vencimento confirmado. Publicação marcada como tratada.')
    } catch (e) { setErro(`${atividadeCriada.current ? 'Atividade já criada. Tentar novamente repetirá somente a atualização de status. ' : ''}${(e as Error).message}`) }
    finally { trava.current = false; setSalvando(false) }
  }
  const bloqueado = salvando || jaCriada
  function imprimir() {
    if (!resultado || calculando || carregandoContexto) return
    setErro('')
    try {
      imprimirDemonstrativoPrazo({ titulo, numero, tribunal, municipio, base, dias: Number(dias), regra, suspensaoCpc, calendario, resultado, dataFinal: final, revisado })
    } catch (e) { setErro((e as Error).message) }
  }
  return <Modal open={true} size="md" modalHeading="Criar atividade a partir da publicação" closeButtonLabel="Fechar" primaryButtonText={jaCriada ? 'Concluir atualização de status' : revisado ? 'Confirmar atividade e prazo' : 'Criar com prazo pendente de revisão'} secondaryButtonText="Cancelar" primaryButtonDisabled={salvando || calculando || carregandoContexto} onRequestSubmit={salvar} onRequestClose={() => { if (!salvando) onClose() }}>
    <Stack gap={5}>
      <TextInput id="oab-atividade-titulo" labelText="Título" maxLength={160} value={titulo} disabled={bloqueado} onChange={e => setTitulo(e.target.value)} />
      <Grid withRowGap narrow fullWidth>
        <Column sm={4} md={4} lg={8}><TextInput id="oab-prazo-base" type="date" labelText={regra === 'dje' ? 'Data de disponibilização DJEN' : 'Termo inicial informado'} value={base} disabled={bloqueado} onChange={e => setBase(e.target.value)} /></Column>
        <Column sm={4} md={4} lg={8}><TextInput id="oab-prazo-dias" type="number" min={1} max={999} labelText="Quantidade de dias" helperText="Sugerida somente quando há um prazo numérico explícito e único no texto." value={dias} disabled={bloqueado} onChange={e => setDias(e.target.value)} /></Column>
        <Column sm={4} md={4} lg={8}><TextInput id="oab-prazo-municipio" labelText="Município / comarca" value={municipio} disabled={bloqueado || carregandoContexto} onChange={e => setMunicipio(e.target.value)} /></Column>
        <Column sm={4} md={4} lg={8}><TextInput id="oab-prazo-tribunal" labelText="Tribunal" value={tribunal} disabled={bloqueado} onChange={e => setTribunal(e.target.value)} /></Column>
      </Grid>
      <Select id="oab-prazo-regra" labelText="Regra aplicada" value={regra} disabled={bloqueado} onChange={e => setRegra(e.target.value as RegraPrazo)}>{Object.entries(REGRAS_PRAZO).map(([v, r]) => <SelectItem key={v} value={v} text={r} />)}</Select>
      <Checkbox id="oab-prazo-suspensao" labelText="Aplicar suspensão de 20/12 a 20/01 (CPC, art. 220)" checked={suspensaoCpc} disabled={bloqueado} onChange={(_, { checked }) => setSuspensaoCpc(checked)} />
      {calculando && <p role="status">Consultando calendário e calculando prazo…</p>}
      <div aria-live="polite">
        <InlineNotification kind={revisado ? 'info' : 'warning'} title={revisado ? 'Prazo revisado para confirmação' : 'Prazo pendente de revisão'} subtitle={revisado ? 'A data final será salva conforme sua revisão. A cobertura automática de suspensões e provimentos permanece incompleta.' : erroCalculo || 'A cobertura de feriados municipais, suspensões e provimentos precisa ser revisada. Sem confirmação, a atividade será salva sem vencimento.'} lowContrast hideCloseButton />
        {resultado && <p>Termo inicial: {formatarDataSimples(resultado.termoInicial)} · {dias} dias úteis · Data final sugerida: {formatarDataSimples(resultado.dataFinal)}</p>}
        {calendario && <p>Município consultado: {calendario.municipio}. Fonte: {calendario.fonte}.</p>}
      </div>
      <TextInput id="oab-prazo-final" type="date" labelText="Data final (editável)" helperText="Ajuste após conferir o calendário e a regra aplicável." value={final} disabled={bloqueado || calculando} onChange={e => { setFinal(e.target.value); setRevisado(false) }} />
      <Checkbox id="oab-prazo-revisado" labelText="Revisei o termo inicial, a quantidade de dias, a regra, os feriados e as suspensões aplicáveis e confirmo a data final." checked={revisado} disabled={bloqueado || calculando || !dataValida(final)} onChange={(_, { checked }) => setRevisado(checked)} />
      <Select id="oab-atividade-responsavel" labelText="Responsável" value={responsavel} disabled={bloqueado} onChange={e => setResponsavel(e.target.value)}><SelectItem value="" text="Eu mesmo" />{responsaveis.map(r => <SelectItem key={r} value={r} text={formatarNomeExibicao(r)} />)}</Select>
      {resultado && <details><summary>Demonstrativo da contagem</summary><ol className="oab-demonstrativo">{resultado.linhas.map((l, i) => <li key={`${l.data}-${i}`}>{formatarDataSimples(l.data)} · {l.evento}{l.dia ? ` · dia ${l.dia}` : ''}</li>)}</ol></details>}
      <div><Button kind="tertiary" size="sm" disabled={!resultado || calculando || carregandoContexto} onClick={imprimir}>Imprimir / salvar PDF</Button></div>
      {erro && <InlineNotification kind="error" title="Não foi possível concluir" subtitle={erro} lowContrast hideCloseButton />}
    </Stack>
  </Modal>
}
