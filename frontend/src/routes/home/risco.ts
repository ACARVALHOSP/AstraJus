// Central de risco: junta, numa lista priorizada, o que pede atenção no escritório.
// Só classifica dados que as telas já carregam; não faz consulta nenhuma.

export type Nivel = 'critico' | 'atencao' | 'info'
export type Destino = { aba: string; payload?: Record<string, string> }
export type Risco = { id: string; nivel: Nivel; titulo: string; detalhe: string; acao: string; destino: Destino }

type Atividade = { tipo: string; data?: string | null }
type Execucao = { estado: string; erro?: string | null }

export type DadosRisco = {
  hoje: string // AAAA-MM-DD, no fuso local
  semana: Atividade[] | null // abertas de hoje a hoje+6
  atrasadas: Atividade[] | null // abertas com data anterior a hoje
  publicacoes: number | null // por revisar
  deClientes: number // dessas, as destinadas a clientes
  rotinas: Record<string, Execucao[]> | null // histórico (mais recente primeiro) das rotinas automáticas
  integracoes: { google: boolean; asaas: boolean; agendaPessoal: boolean | null } | null
}

const ORDEM: Record<Nivel, number> = { critico: 0, atencao: 1, info: 2 }
const ROTINAS: Record<string, { nome: string; destino: Destino }> = {
  captura_oab: { nome: 'A captura de publicações por OAB', destino: { aba: 'monitoramentos' } },
  monitoramentos: { nome: 'Os monitoramentos do DJEN', destino: { aba: 'monitoramentos' } },
  movimentos: { nome: 'A atualização de andamentos (DataJud)', destino: { aba: 'casos' } },
}

export function somarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const data = new Date(a, m - 1, d + dias)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

export function montarRiscos(d: DadosRisco): Risco[] {
  const riscos: Risco[] = []
  const prazosAtrasados = d.atrasadas?.filter(a => a.tipo === 'prazo').length ?? 0
  const outrasAtrasadas = (d.atrasadas?.length ?? 0) - prazosAtrasados
  const limite = somarDiasIso(d.hoje, 2)
  const prazosProximos = d.semana?.filter(a => a.tipo === 'prazo' && a.data && a.data <= limite) ?? []
  const prazosHoje = prazosProximos.filter(a => a.data === d.hoje).length
  const audiencias = d.semana?.filter(a => a.tipo === 'audiencia').length ?? 0

  if (prazosAtrasados > 0) riscos.push({
    id: 'prazos-vencidos', nivel: 'critico', titulo: `${plural(prazosAtrasados, 'prazo vencido', 'prazos vencidos')}`,
    detalhe: 'Prazos em aberto com data anterior a hoje. Confira se já foram cumpridos e conclua ou ajuste.',
    acao: 'Ver atrasados', destino: { aba: 'atividades' },
  })
  if (prazosProximos.length > 0) riscos.push({
    id: 'prazos-proximos', nivel: prazosHoje > 0 ? 'critico' : 'atencao',
    titulo: `${plural(prazosProximos.length, 'prazo vence', 'prazos vencem')} em até 2 dias`,
    detalhe: prazosHoje > 0 ? `${plural(prazosHoje, 'vence hoje', 'vencem hoje')}.` : 'Nenhum vence hoje.',
    acao: 'Abrir agenda', destino: { aba: 'agenda' },
  })
  if (d.deClientes > 0) riscos.push({
    id: 'publicacoes-clientes', nivel: 'critico', titulo: `${plural(d.deClientes, 'publicação de cliente', 'publicações de clientes')} por revisar`,
    detalhe: 'Publicações destinadas a clientes do escritório ainda sem tratamento.',
    acao: 'Revisar', destino: { aba: 'publicacoes-oab', payload: { status: 'nao_tratada' } },
  })
  const semRevisao = (d.publicacoes ?? 0) - d.deClientes
  if (semRevisao > 0) riscos.push({
    id: 'publicacoes', nivel: 'atencao', titulo: `${plural(semRevisao, 'publicação sem revisão', 'publicações sem revisão')}`,
    detalhe: 'Recebidas e ainda não tratadas na triagem.',
    acao: 'Revisar', destino: { aba: 'publicacoes-oab', payload: { status: 'nao_tratada' } },
  })
  if (audiencias > 0) riscos.push({
    id: 'audiencias', nivel: 'atencao', titulo: `${plural(audiencias, 'audiência', 'audiências')} nos próximos 7 dias`,
    detalhe: 'Confirme data, hora e documentos.', acao: 'Abrir agenda', destino: { aba: 'agenda' },
  })
  if (outrasAtrasadas > 0) riscos.push({
    id: 'tarefas-atrasadas', nivel: 'atencao', titulo: `${plural(outrasAtrasadas, 'tarefa atrasada', 'tarefas atrasadas')}`,
    detalhe: 'Tarefas e outras atividades abertas com data anterior a hoje.',
    acao: 'Ver atrasadas', destino: { aba: 'atividades' },
  })

  // Rotinas automáticas: avisa quando a última execução terminada falhou.
  for (const [chave, info] of Object.entries(ROTINAS)) {
    const ultima = d.rotinas?.[chave]?.find(e => e.estado !== 'executando')
    if (ultima?.estado === 'falha') riscos.push({
      id: `rotina-${chave}`, nivel: 'atencao', titulo: `${info.nome} falhou na última execução`,
      detalhe: ultima.erro || 'Nova tentativa automática no próximo ciclo. Se continuar, avise o administrador.',
      acao: 'Ver monitoramentos', destino: info.destino,
    })
  }

  // Integrações: só informa; "não configurada" pode ser escolha do escritório.
  if (d.integracoes) {
    if (!d.integracoes.google) riscos.push({
      id: 'google', nivel: 'info', titulo: 'Google não configurado',
      detalhe: 'Pastas dos processos no Drive e sincronização com a Agenda ficam indisponíveis.',
      acao: 'Ver integrações', destino: { aba: 'integracoes' },
    })
    else if (d.integracoes.agendaPessoal === false) riscos.push({
      id: 'agenda-pessoal', nivel: 'info', titulo: 'Sua Google Agenda não está conectada',
      detalhe: 'Prazos e audiências não vão para a sua agenda.',
      acao: 'Conectar', destino: { aba: 'integracoes' },
    })
    if (!d.integracoes.asaas) riscos.push({
      id: 'asaas', nivel: 'info', titulo: 'Cobranças (Asaas) não configuradas',
      detalhe: 'Boleto e Pix pelo sistema ficam indisponíveis.',
      acao: 'Ver integrações', destino: { aba: 'integracoes' },
    })
  }
  return riscos.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel])
}
