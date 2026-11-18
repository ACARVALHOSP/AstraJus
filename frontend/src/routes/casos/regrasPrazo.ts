// Regras de prazo: tipos de prazo, escopo (classe/assunto) e expressão de palavras-chave.
// Também calcula a data estimada de um prazo a partir da disponibilização ou do movimento.
import { calcularPrazo, cruzaRecesso, dataValida, type CalendarioForense, type Contagem, type RegraPrazo as RegraDeCalculo } from '../publicacoes-oab/prazos.ts'

export type TipoPrazo = {
  id: string
  nome: string
  /** Dias de 1 a 365. */
  dias: number
  contagem: Contagem
  /** Base legal opcional, até 200 caracteres. */
  base_legal: string | null
  /** 'disponibilizacao' conta a partir do DJEN; 'movimento' a partir da data informada. */
  inicio: 'disponibilizacao' | 'movimento'
  ativo: boolean
}

export type EscopoItem = {
  tipo: 'classe' | 'assunto'
  /** Código da TPU; null quando a regra migrada veio só com o nome. */
  codigo: number | null
  nome: string
}

export type Regra = {
  id: string
  nome: string
  tipo_id: string
  /** Até 20 itens. */
  escopo: EscopoItem[]
  /** Expressão de palavras-chave (até 500 caracteres); pode ser vazia. */
  palavras: string
  /** Tipos de publicação do DJEN (comunicação ou documento); até 20. Regras antigas podem não trazer o campo. */
  tipos_publicacao?: string[]
  combinacao: 'e' | 'ou'
  ativo: boolean
}

/** Regra que casa com o processo e o evento, com o motivo da sugestão. */
export type Sugestao = {
  regra: Regra
  tipo: TipoPrazo
  correspondeu_a: EscopoItem | null
  termos: string[]
  tipo_publicacao_casou?: string | null
}

const ROTULO_ESCOPO = { classe: 'Classe', assunto: 'Assunto' } as const

/** Resumo legível do escopo e das palavras-chave, para a lista de regras.
 *  Com as duas partes, mostra a combinação escolhida ("e" ou "ou"). */
export function resumoDaRegra(regra: Pick<Regra, 'escopo' | 'palavras' | 'combinacao'> & { tipos_publicacao?: string[] }): string {
  const escopo = regra.escopo ?? []
  const nomes = escopo.map(item => `${ROTULO_ESCOPO[item.tipo]} “${item.nome}”`)
  const partes: string[] = []
  if (nomes.length === 1) partes.push(nomes[0])
  else if (nomes.length > 1) partes.push(`${nomes.slice(0, 2).join(', ')}${nomes.length > 2 ? ` e mais ${nomes.length - 2}` : ''}`)
  const tipos = regra.tipos_publicacao ?? []
  if (tipos.length) partes.push(`publicação do tipo ${tipos.slice(0, 3).map(t => `“${t}”`).join(', ')}${tipos.length > 3 ? ` e mais ${tipos.length - 3}` : ''}`)
  const palavras = (regra.palavras ?? '').trim()
  if (palavras) partes.push(`palavras-chave: ${palavras}`)
  // Com mais de um critério preenchido, mostra a combinação escolhida ("e" ou "ou").
  return partes.join(` ${regra.combinacao === 'ou' ? 'ou' : 'e'} `) || 'Nenhum critério preenchido'
}

/** Só precisa da ferramenta de feriados; o ClienteMCP satisfaz esta forma. */
export type ClienteFerramentas = {
  chamarFerramenta: (nome: string, argumentos?: Record<string, unknown>) => Promise<unknown>
}

type RespostaFeriados = {
  erro?: boolean
  mensagem?: string
  municipio?: string
  fonte?: string
  feriados?: Array<{ data: string; descricao: string }>
}

// Sem consulta a feriados locais: só fins de semana e a suspensão do CPC de 20/12 a 20/01.
// A data é sempre uma estimativa que a pessoa revisa antes de criar o prazo.
const SEM_FERIADOS: CalendarioForense = {
  municipio: '', tribunal: '', anos: [], fonte: 'Sem feriados locais', consultadoEm: '', completo: false, impedimentos: [],
}

const MAX_PASSOS_CALENDARIO = 12

/** Busca os feriados de todos os anos pedidos, como o provedor inline da tela de publicações.
 *  O serviço garante a lista de feriados, não as suspensões e provimentos: o calendário fica
 *  marcado como incompleto e a data, como estimativa. */
async function consultarFeriados(
  cliente: ClienteFerramentas,
  local: { municipio: string; tribunal: string },
  anos: number[],
): Promise<{ calendario: CalendarioForense; falhou: boolean }> {
  try {
    const respostas = await Promise.all(anos.map(async ano => {
      const r = await cliente.chamarFerramenta('buscar_feriados_forenses', {
        municipio: local.municipio, tribunal: local.tribunal, ano,
      }) as RespostaFeriados
      if (r?.erro || !Array.isArray(r?.feriados)) throw new Error(r?.mensagem || 'Calendário indisponível.')
      return r
    }))
    return {
      falhou: false,
      calendario: {
        ...local, anos, completo: false,
        fonte: respostas.some(r => r.fonte === 'calculado')
          ? 'Feriados nacionais e estaduais calculados; cobertura municipal não verificada'
          : 'Feriados do tribunal por município; suspensões e provimentos ainda não verificados',
        consultadoEm: new Date().toISOString(),
        impedimentos: respostas.flatMap(r => (r.feriados ?? [])
          .filter(f => dataValida(f.data))
          .map(f => ({ inicio: f.data, fim: f.data, descricao: f.descricao }))),
      },
    }
  } catch {
    return { calendario: { ...SEM_FERIADOS, ...local, anos }, falhou: true }
  }
}

function calcularComRecesso(base: string, tipo: TipoPrazo, regra: RegraDeCalculo, calendario: CalendarioForense) {
  const opcoes = { contagem: tipo.contagem }
  // Sem marcar a suspensão, a contagem atravessa 20/12–20/01 como se fosse dia útil. Calcula sem,
  // e refaz com a suspensão quando o intervalo cruza o recesso (mesma decisão do modelo antigo).
  let calculo = calcularPrazo(base, tipo.dias, regra, calendario, false, opcoes)
  if (cruzaRecesso(base, calculo.dataFinal)) calculo = calcularPrazo(base, tipo.dias, regra, calendario, true, opcoes)
  return calculo
}

/** Data estimada do vencimento a partir de `base` (AAAA-MM-DD).
 *  Disponibilização no DJEN usa a regra de publicação (dje); movimento usa o início simples.
 *  Sem tribunal/município, ou se a consulta falhar, usa calendário sem feriados e sinaliza
 *  `aConfirmar`. A busca é repetida por ano até cobrir o ano da data final. */
export async function calcularVencimento(
  cliente: ClienteFerramentas | null,
  { base, tipo, tribunal, municipio }: { base: string; tipo: TipoPrazo; tribunal: string; municipio: string },
): Promise<{ data: string; aConfirmar: boolean; fonte: string }> {
  const regra: RegraDeCalculo = tipo.inicio === 'disponibilizacao' ? 'dje' : 'inicio'
  const local = { tribunal: (tribunal ?? '').trim(), municipio: (municipio ?? '').trim() }
  const semFeriados: CalendarioForense = { ...SEM_FERIADOS, ...local }
  if (!cliente || !local.tribunal || !local.municipio) {
    const calculo = calcularComRecesso(base, tipo, regra, semFeriados)
    return { data: calculo.dataFinal, aConfirmar: true, fonte: semFeriados.fonte }
  }
  const anoBase = Number(base.slice(0, 4))
  let anos = [anoBase]
  for (let passo = 0; passo < MAX_PASSOS_CALENDARIO; passo++) {
    const consulta = await consultarFeriados(cliente, local, anos)
    // Falha da consulta: segue sem feriados e avisa que a data é estimativa. Nada é inventado.
    if (consulta.falhou) {
      const calculo = calcularComRecesso(base, tipo, regra, semFeriados)
      return { data: calculo.dataFinal, aConfirmar: true, fonte: semFeriados.fonte }
    }
    const calculo = calcularComRecesso(base, tipo, regra, consulta.calendario)
    const anoFinal = Number(calculo.dataFinal.slice(0, 4))
    if (anos.includes(anoFinal)) {
      return {
        data: calculo.dataFinal,
        aConfirmar: !consulta.calendario.completo,
        fonte: consulta.calendario.fonte,
      }
    }
    anos = Array.from({ length: anoFinal - anoBase + 1 }, (_, i) => anoBase + i)
  }
  throw new Error('Intervalo de calendário não suportado.')
}
