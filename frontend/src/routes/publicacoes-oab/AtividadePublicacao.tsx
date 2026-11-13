import CampoData from '../../CampoData'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, Callout, Checkbox, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { useCasos, useNomePessoa, useResponsaveis } from '../../api/consultas'
import { buscarJson, enviarJson } from '../../api/rest'
import { formatarDataSimples } from '../../utils/formatadores'
import { siglaTribunalPorNumero } from '../../utils/tribunalPorNumero'
import { numeroPublicacao, type PublicacaoOab } from './dados'
import BuscaProcesso from '../../BuscaProcesso'
import { calcularPrazo, cruzaRecesso, dataValida, detectarDias, PRAZOS_PADRAO, REGRAS_PRAZO, sugerirPrazoPadrao, type CalendarioForense, type Contagem, type ProvedorCalendario, type RegraPrazo } from './prazos'
import { imprimirDemonstrativoPrazo } from './impressaoPrazo'

type CasoOpcao = { id: string; titulo?: string | null; processos?: string[] }
const SEM_CASOS: CasoOpcao[] = []
const SEM_RESPONSAVEIS: string[] = []

/** Calcula um prazo processual e cria a atividade. Com `publicacao`, parte dos dados dela e marca a
 *  publicação como tratada ao salvar; sem ela (calculadora avulsa da Agenda), pede o processo. */
export default function AtividadePublicacao({ publicacao, casoIdInicial, dataBaseInicial, onClose, onConcluido, provedorCalendario }: {
  publicacao?: PublicacaoOab; casoIdInicial?: string; dataBaseInicial?: string
  onClose: () => void; onConcluido: (mensagem: string) => void; provedorCalendario?: ProvedorCalendario
}) {
  const { cliente } = useCliente()
  const nomePessoa = useNomePessoa()
  const [casoId, setCasoId] = useState(publicacao?.caso_id ?? casoIdInicial ?? '')
  // Calculadora avulsa: lista de processos para escolher.
  const { data: casos = SEM_CASOS } = useCasos<CasoOpcao>({ enabled: Boolean(cliente) && !publicacao && !casoIdInicial })
  const [numeroCaso, setNumeroCaso] = useState('')
  const numero = publicacao ? numeroPublicacao(publicacao) : numeroCaso
  const textoPublicacao = publicacao?.dados?.texto || ''
  const sugestao = sugerirPrazoPadrao(textoPublicacao)
  const diasExplicitos = detectarDias(textoPublicacao)
  const [prazoPadrao, setPrazoPadrao] = useState<string>(diasExplicitos ? 'outro' : sugestao?.id ?? 'outro')
  const [titulo, setTitulo] = useState(publicacao ? `Revisar ${publicacao.dados?.tipoComunicacao || 'publicação DJEN'}` : '')
  const [dias, setDias] = useState(String(diasExplicitos ?? sugestao?.dias ?? ''))
  const [contagem, setContagem] = useState<Contagem>('uteis')
  const [emDobro, setEmDobro] = useState(false)
  const [base, setBase] = useState(publicacao?.dados?.data_disponibilizacao?.slice(0, 10) || dataBaseInicial || '')
  const [regra, setRegra] = useState<RegraPrazo>(publicacao || !dataBaseInicial ? 'dje' : 'dje')
  const [municipio, setMunicipio] = useState('')
  const [tribunal, setTribunal] = useState(publicacao?.dados?.siglaTribunal?.toLowerCase() || siglaTribunalPorNumero(numero) || '')
  const [suspensaoCpc, setSuspensaoCpc] = useState(false)
  const [responsavel, setResponsavel] = useState('')
  const { data: responsaveis = SEM_RESPONSAVEIS } = useResponsaveis()
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

  // Calculadora avulsa: número do processo escolhido.
  useEffect(() => {
    if (publicacao || !casoId) return
    let ativo = true
    buscarJson<{ processos?: string[] }>(cliente, `/casos/${encodeURIComponent(casoId)}`)
      .then(c => { if (ativo) { const n = (c.processos ?? [])[0] ?? ''; setNumeroCaso(n); if (n && !tribunal) setTribunal(siglaTribunalPorNumero(n) || '') } })
      .catch(() => {})
    return () => { ativo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, casoId, publicacao])

  useEffect(() => {
    let ativo = true
    Promise.allSettled([
      casoId && numero ? buscarJson<{ cidade?: string; tribunal?: string }>(cliente, `/casos/${encodeURIComponent(casoId)}/processos/${numero}/capa`) : Promise.reject(new Error('sem processo')),
    ]).then(([capa]) => {
      if (!ativo) return
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
          calculo = calcularPrazo(base, Number(dias), regra, calendarioAtual, suspensaoCpc, { contagem, emDobro })
          const anoFinal = Number(calculo.dataFinal.slice(0, 4))
          if (anos.includes(anoFinal)) break
          anos = Array.from({ length: anoFinal - anoBase + 1 }, (_, i) => anoBase + i)
        }
        if (!ativo) return
        setCalendario(calendarioAtual); setResultado(calculo); setFinal(calculo.dataFinal)
      } catch (e) { if (ativo) setErroCalculo((e as Error).message) } finally { if (ativo) setCalculando(false) }
    }, 350)
    return () => { ativo = false; clearTimeout(temporizador) }
  }, [cliente, base, dias, municipio, tribunal, regra, suspensaoCpc, contagem, emDobro, carregandoContexto, provedorCalendario])

  async function salvar() {
    if (trava.current || calculando || carregandoContexto) return
    if (!casoId) { setErro('Escolha o processo do prazo.'); return }
    if (!titulo.trim()) { setErro('Informe o título.'); return }
    if (revisado && !dataValida(final)) { setErro('Informe uma data final válida para o prazo revisado.'); return }
    trava.current = true; setSalvando(true); setErro('')
    try {
      if (!atividadeCriada.current) {
        const memoria = {
          ...(publicacao ? { publicacao: publicacao.hash, link: publicacao.dados?.link || null } : {}), numero_processo: numero || null,
          prazo_padrao: prazoPadrao, contagem, em_dobro: emDobro,
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
          observacoes: `${revisado ? 'Prazo revisado antes da confirmação.' : 'Pendente de revisão do prazo; sem vencimento confirmado.'}${publicacao ? `\nPublicação DJEN: ${publicacao.hash}` : ''}\n${JSON.stringify(memoria)}`,
        })
        atividadeCriada.current = String(a.id); setJaCriada(true)
      }
      if (publicacao) {
        const r = await enviarJson<{ hashes_falharam?: string[] }>(cliente, '/publicacoes-oab/status', { hashes: [publicacao.hash], status: 'tratada' })
        if (r.hashes_falharam?.length) throw new Error('Não foi possível atualizar o status da publicação.')
      }
      const sufixo = publicacao ? ' Publicação marcada como tratada.' : ''
      onConcluido(revisado ? `Prazo criado e revisado.${sufixo}` : `Prazo criado pendente de revisão, sem vencimento confirmado.${sufixo}`)
    } catch (e) { setErro(`${atividadeCriada.current ? 'Atividade já criada. Tentar novamente repetirá somente a atualização de status. ' : ''}${(e as Error).message}`) }
    finally { trava.current = false; setSalvando(false) }
  }
  const bloqueado = salvando || jaCriada
  function imprimir() {
    if (!resultado || calculando || carregandoContexto) return
    setErro('')
    try {
      imprimirDemonstrativoPrazo({ titulo, numero, tribunal, municipio, base, dias: Number(dias), regra, suspensaoCpc, calendario, resultado, dataFinal: final, revisado, contagem, emDobro })
    } catch (e) { setErro((e as Error).message) }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !salvando) onClose() }}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{publicacao ? 'Criar atividade a partir da publicação' : 'Calcular prazo processual'}</Dialog.Title>
        <Flex direction="column" gap="5">
          {!publicacao && !casoIdInicial && (
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-processo">Processo</label>
              <BuscaProcesso id="oab-prazo-processo" casos={casos} valor={casoId} onChange={setCasoId} />
            </div>
          )}
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-prazo-padrao">Tipo de prazo</label>
            <Select.Root value={prazoPadrao} disabled={bloqueado} onValueChange={(v) => {
              setPrazoPadrao(v)
              const p = PRAZOS_PADRAO.find(x => x.id === v)
              if (p) { setDias(String(p.dias)); setContagem('uteis'); if (!publicacao && !titulo.trim()) setTitulo(`Prazo: ${p.rotulo}`) }
            }}>
              <Select.Trigger id="oab-prazo-padrao" style={{ width: '100%' }} />
              <Select.Content>
                {PRAZOS_PADRAO.map(p => <Select.Item key={p.id} value={p.id}>{p.rotulo} — {p.dias} dias úteis ({p.base})</Select.Item>)}
                <Select.Item value="outro">Outro (informar os dias)</Select.Item>
              </Select.Content>
            </Select.Root>
            {publicacao && sugestao && prazoPadrao === sugestao.id && !diasExplicitos && (
              <Text size="1" color="gray">Sugerido pelo texto da publicação ({sugestao.rotulo}, {sugestao.base}). Confira: o prazo pode ser outro.</Text>
            )}
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-atividade-titulo">Título</label>
            <TextField.Root id="oab-atividade-titulo" maxLength={160} value={titulo} disabled={bloqueado} onChange={e => setTitulo(e.target.value)} />
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-base">{regra === 'dje' ? 'Data de disponibilização DJEN' : 'Termo inicial informado'}</label>
              <CampoData id="oab-prazo-base" value={base} disabled={bloqueado} onChange={v => setBase(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-dias">Quantidade de dias</label>
              <TextField.Root id="oab-prazo-dias" type="number" min={1} max={999} value={dias} disabled={bloqueado} onChange={e => { setDias(e.target.value); setPrazoPadrao('outro') }} />
              <Text size="1" color="gray">{publicacao ? 'Sugerida quando o texto traz um prazo numérico explícito e único ou um tipo de manifestação reconhecido.' : 'Preenchida pelo tipo de prazo; pode ser ajustada.'}</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-municipio">Município / comarca</label>
              <TextField.Root id="oab-prazo-municipio" value={municipio} disabled={bloqueado || carregandoContexto} onChange={e => setMunicipio(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-tribunal">Tribunal</label>
              <TextField.Root id="oab-prazo-tribunal" value={tribunal} disabled={bloqueado} onChange={e => setTribunal(e.target.value)} />
            </div>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-prazo-regra">Regra aplicada</label>
            <Select.Root value={regra} disabled={bloqueado} onValueChange={(v) => setRegra(v as RegraPrazo)}>
              <Select.Trigger id="oab-prazo-regra" style={{ width: '100%' }} />
              <Select.Content>
                {Object.entries(REGRAS_PRAZO).map(([v, r]) => <Select.Item key={v} value={v}>{r}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="oab-prazo-contagem">Contagem</label>
              <Select.Root value={contagem} disabled={bloqueado} onValueChange={(v) => setContagem(v as Contagem)}>
                <Select.Trigger id="oab-prazo-contagem" style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="uteis">Dias úteis (CPC art. 219)</Select.Item>
                  <Select.Item value="corridos">Dias corridos (prorroga para dia útil)</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={emDobro} disabled={bloqueado} onCheckedChange={(checked) => setEmDobro(Boolean(checked))} />
              Prazo em dobro (Fazenda Pública, Ministério Público, Defensoria ou litisconsortes com advogados distintos: CPC arts. 180, 183, 186 e 229)
            </Flex>
          </Text>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={suspensaoCpc} disabled={bloqueado} onCheckedChange={(checked) => setSuspensaoCpc(Boolean(checked))} />
              Aplicar suspensão de 20/12 a 20/01 (CPC, art. 220)
            </Flex>
          </Text>
          {calculando && <Text as="p" size="2" role="status">Consultando calendário e calculando prazo…</Text>}
          <div aria-live="polite">
            <Callout.Root color={revisado ? 'blue' : 'yellow'} size="1">
              <Callout.Icon>{revisado ? <Info size={14} /> : <AlertTriangle size={14} />}</Callout.Icon>
              <Callout.Text>{revisado ? 'A data final será salva conforme sua revisão. A cobertura automática de suspensões e provimentos permanece incompleta.' : erroCalculo || 'A cobertura de feriados municipais, suspensões e provimentos precisa ser revisada. Sem confirmação, a atividade será salva sem vencimento.'}</Callout.Text>
            </Callout.Root>
            {resultado && <Text as="p" size="2" mt="2">Termo inicial: {formatarDataSimples(resultado.termoInicial)} · {resultado.diasContados} dias {resultado.contagem === 'corridos' ? 'corridos' : 'úteis'}{resultado.emDobro ? ` (${dias} em dobro)` : ''} · Data final sugerida: {formatarDataSimples(resultado.dataFinal)}{resultado.prorrogado ? ' (prorrogada para o primeiro dia útil)' : ''}</Text>}
            {resultado && !suspensaoCpc && cruzaRecesso(base, resultado.dataFinal) && (
              <Text as="p" size="2" color="amber" role="alert">A contagem passa pelo período de 20/12 a 20/01. Se a suspensão do CPC (art. 220) se aplica a este processo, marque a opção acima: a data final muda.</Text>
            )}
            {calendario && <Text as="p" size="2">Município consultado: {calendario.municipio}. Fonte: {calendario.fonte}.</Text>}
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-prazo-final">Data final (editável)</label>
            <CampoData id="oab-prazo-final" value={final} disabled={bloqueado || calculando} onChange={v => { setFinal(v); setRevisado(false) }} />
            <Text size="1" color="gray">Ajuste após conferir o calendário e a regra aplicável.</Text>
          </div>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={revisado} disabled={bloqueado || calculando || !dataValida(final)} onCheckedChange={(checked) => setRevisado(Boolean(checked))} />
              Revisei o termo inicial, a quantidade de dias, a regra, os feriados e as suspensões aplicáveis e confirmo a data final.
            </Flex>
          </Text>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="oab-atividade-responsavel">Responsável</label>
            <Select.Root value={responsavel || '__eu__'} disabled={bloqueado} onValueChange={(v) => setResponsavel(v === '__eu__' ? '' : v)}>
              <Select.Trigger id="oab-atividade-responsavel" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="__eu__">Eu mesmo</Select.Item>
                {responsaveis.map(r => <Select.Item key={r} value={r}>{nomePessoa(r)}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          {resultado && (
            <details>
              <summary>Demonstrativo da contagem</summary>
              <ol className="oab-demonstrativo">
                {resultado.linhas.map((l, i) => <li key={`${l.data}-${i}`}>{formatarDataSimples(l.data)} · {l.evento}{l.dia ? ` · dia ${l.dia}` : ''}</li>)}
              </ol>
            </details>
          )}
          <div>
            <Button variant="soft" size="1" disabled={!resultado || calculando || carregandoContexto} onClick={imprimir}>Imprimir / salvar PDF</Button>
          </div>
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="2" justify="end">
            <Button variant="soft" color="gray" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button disabled={salvando || calculando || carregandoContexto || !casoId} onClick={salvar}>
              {jaCriada ? 'Concluir atualização de status' : revisado ? 'Confirmar atividade e prazo' : 'Criar com prazo pendente de revisão'}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
