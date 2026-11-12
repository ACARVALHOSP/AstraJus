// Modelos de prazos e tarefas por assunto ou classe: tipos e datas sugeridas para cada item.
import { calcularPrazo, cruzaRecesso, type CalendarioForense, type Contagem } from '../publicacoes-oab/prazos.ts'
import { somarDiasIso } from '../home/risco.ts'

export type ItemPrazo = { titulo: string; dias: number; contagem: Contagem }
export type ItemTarefa = { titulo: string; dias: number }
export type Modelo = {
  id: string; nome: string; criterio: string; ativo: boolean
  prazos: ItemPrazo[]; tarefas: ItemTarefa[]
}
export type Sugestao = { modelo: Modelo; correspondeu_a: string }

export type ItemSugerido = { chave: string; tipo: 'prazo' | 'tarefa'; titulo: string; data: string; descricao: string }

// Sem consulta a feriados locais: só fins de semana e, se a contagem passar por 20/12–20/01, a suspensão
// do CPC. A data é sempre uma estimativa que a pessoa revisa antes de criar.
const SEM_FERIADOS: CalendarioForense = {
  municipio: '', tribunal: '', anos: [], fonte: 'Sem feriados locais', consultadoEm: '', completo: false, impedimentos: [],
}

/** Itens que o modelo propõe, com a data estimada a partir de `hoje` (AAAA-MM-DD).
 *  Prazo: contagem a partir de amanhã (se for dia útil, conta como o 1º dia). Tarefa: dias corridos a partir de hoje. */
export function itensDoModelo(modelo: Pick<Modelo, 'prazos' | 'tarefas'>, hoje: string): ItemSugerido[] {
  const amanha = somarDiasIso(hoje, 1)
  const prazos = modelo.prazos.map((p, i): ItemSugerido => {
    const opcoes = { contagem: p.contagem }
    let data: string
    try {
      let calculo = calcularPrazo(amanha, p.dias, 'inicio', SEM_FERIADOS, false, opcoes)
      if (cruzaRecesso(amanha, calculo.dataFinal)) calculo = calcularPrazo(amanha, p.dias, 'inicio', SEM_FERIADOS, true, opcoes)
      data = calculo.dataFinal
    } catch {
      data = somarDiasIso(hoje, p.dias)
    }
    return {
      chave: `prazo-${i}`, tipo: 'prazo', titulo: p.titulo, data,
      descricao: `${p.dias} dias ${p.contagem === 'uteis' ? 'úteis' : 'corridos'}`,
    }
  })
  const tarefas = modelo.tarefas.map((t, i): ItemSugerido => ({
    chave: `tarefa-${i}`, tipo: 'tarefa', titulo: t.titulo, data: somarDiasIso(hoje, t.dias),
    descricao: t.dias === 0 ? 'para hoje' : `em ${t.dias} ${t.dias === 1 ? 'dia' : 'dias'}`,
  }))
  return [...prazos, ...tarefas]
}

export function resumoDoModelo(modelo: Pick<Modelo, 'prazos' | 'tarefas'>): string {
  const partes = []
  const p = modelo.prazos.length, t = modelo.tarefas.length
  if (p) partes.push(`${p} ${p === 1 ? 'prazo' : 'prazos'}`)
  if (t) partes.push(`${t} ${t === 1 ? 'tarefa' : 'tarefas'}`)
  return partes.join(' e ')
}
