// Interpreta uma anotação rápida ("prazo contestação Maria sexta 14h") em atividade: tipo, data, hora,
// processo e título. Função pura, sem React, para ser testada em tests/anotar-rapido.test.mjs.

export type TipoAnotacao = 'tarefa' | 'prazo' | 'audiencia' | 'reuniao'
export type CasoAnotacao = { id: string; titulo?: string | null; cliente?: string | null; processos?: string[] | null }
export type Anotacao = {
  titulo: string
  tipo: TipoAnotacao
  /** Data ISO (aaaa-mm-dd) ou vazio. */
  data: string
  /** Hora (hh:mm) ou vazio. */
  hora: string
  /** Processo quando o texto aponta um só; senão null (o usuário escolhe). */
  casoId: string | null
  candidatos: string[]
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const DIAS_SEMANA: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }
// Palavras que não identificam processo nem pessoa e não ficam nas pontas do título.
const LIGACAO = new Set(['para', 'de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'no', 'na', 'ate', 'em', 'com', 'e', 'por', 'ao', 'que'])
const RE_CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dataValida(ano: number, mes: number, dia: number): Date | null {
  const d = new Date(ano, mes - 1, dia)
  return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia ? d : null
}

function somarDias(base: Date, n: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setDate(d.getDate() + n)
  return d
}

function maiuscula(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s
}

export function interpretar(texto: string, hoje: Date, casos: CasoAnotacao[] = []): Anotacao {
  const original = texto.trim()
  const palavras = original ? original.split(/\s+/) : []
  const norm = palavras.map(p => sem(p).replace(/[.,;:!?]+$/, ''))
  const usadas = new Set<number>()
  const dia0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  let hora = ''
  let data = ''
  let tipo: TipoAnotacao = 'tarefa'
  let tipoEncontrado = false

  const livre = (i: number) => i >= 0 && i < norm.length && !usadas.has(i)
  const consumir = (...idx: number[]) => idx.forEach(i => usadas.add(i))

  // Hora: 14h, 14h30, 14:30 ou "às 9".
  for (let i = 0; i < norm.length && !hora; i++) {
    if (!livre(i)) continue
    const m = /^(\d{1,2})h(\d{2})?$/.exec(norm[i]) ?? /^(\d{1,2}):(\d{2})$/.exec(norm[i])
    let h = -1, min = 0
    if (m) { h = Number(m[1]); min = m[2] ? Number(m[2]) : 0 }
    const comAs = (norm[i - 1] === 'as' || norm[i - 1] === 'a') && livre(i - 1)
    if (!m && norm[i] === 'as' && livre(i + 1) && /^\d{1,2}$/.test(norm[i + 1])) {
      h = Number(norm[i + 1]); min = 0
      if (h <= 23) { hora = `${String(h).padStart(2, '0')}:00`; consumir(i, i + 1); continue }
    }
    if (m && h >= 0 && h <= 23 && min <= 59) {
      hora = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
      consumir(i)
      if (comAs && norm[i - 1] === 'as') consumir(i - 1)
    }
  }

  // Data: hoje, amanhã, depois de amanhã, dia da semana, dd/mm, "dia N", "em N dias".
  for (let i = 0; i < norm.length && !data; i++) {
    if (!livre(i)) continue
    const p = norm[i]
    if (p === 'hoje') { data = iso(dia0); consumir(i); continue }
    if (p === 'depois' && norm[i + 1] === 'de' && norm[i + 2] === 'amanha' && livre(i + 1) && livre(i + 2)) {
      data = iso(somarDias(dia0, 2)); consumir(i, i + 1, i + 2); continue
    }
    if (p === 'amanha') { data = iso(somarDias(dia0, 1)); consumir(i); continue }
    const semana = /^(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira)?$/.exec(p)
    if (semana) {
      const alvo = DIAS_SEMANA[semana[1]]
      const delta = (alvo - dia0.getDay() + 7) % 7 || 7 // o mesmo dia da semana vale para a próxima semana
      data = iso(somarDias(dia0, delta)); consumir(i)
      if (norm[i + 1] === 'que' && norm[i + 2] === 'vem' && livre(i + 1) && livre(i + 2)) consumir(i + 1, i + 2)
      continue
    }
    const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(p)
    if (dm) {
      const dia = Number(dm[1]), mes = Number(dm[2])
      let ano = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : dia0.getFullYear()
      let d = dataValida(ano, mes, dia)
      if (d && !dm[3] && d < dia0) { ano += 1; d = dataValida(ano, mes, dia) }
      if (d) { data = iso(d); consumir(i) }
      continue
    }
    if (p === 'dia' && livre(i + 1) && /^\d{1,2}$/.test(norm[i + 1])) {
      const dia = Number(norm[i + 1])
      let d = dataValida(dia0.getFullYear(), dia0.getMonth() + 1, dia)
      if (!d || d < dia0) {
        const proximo = new Date(dia0.getFullYear(), dia0.getMonth() + 1, 1) // dia já passou (ou não existe no mês): mês seguinte
        d = dataValida(proximo.getFullYear(), proximo.getMonth() + 1, dia)
      }
      if (d) { data = iso(d); consumir(i, i + 1) }
      continue
    }
    if (p === 'em' && livre(i + 1) && livre(i + 2) && /^\d{1,3}$/.test(norm[i + 1]) && /^dias?$/.test(norm[i + 2])) {
      data = iso(somarDias(dia0, Number(norm[i + 1]))); consumir(i, i + 1, i + 2); continue
    }
  }

  // Tipo pela primeira palavra-chave; "prazo" sai do título, as outras ficam (ex.: "Audiência Maria").
  for (let i = 0; i < norm.length && !tipoEncontrado; i++) {
    if (!livre(i)) continue
    if (norm[i] === 'prazo') { tipo = 'prazo'; tipoEncontrado = true; consumir(i) }
    else if (norm[i] === 'audiencia') { tipo = 'audiencia'; tipoEncontrado = true }
    else if (norm[i] === 'reuniao') { tipo = 'reuniao'; tipoEncontrado = true }
  }

  // Processo: número CNJ, ou palavras do texto que aparecem no título do processo ou no nome do cliente.
  let casoId: string | null = null
  let candidatos: string[] = []
  const digitos = (s: string) => s.replace(/\D/g, '')
  for (let i = 0; i < norm.length; i++) {
    if (!livre(i) || !RE_CNJ.test(norm[i])) continue
    const achado = casos.find(c => (c.processos ?? []).some(n => digitos(n) === digitos(norm[i])))
    if (achado) { casoId = achado.id; candidatos = [achado.id]; consumir(i) }
  }
  if (!casoId) {
    const termos = norm
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => livre(i) && p.length >= 3 && !LIGACAO.has(p) && p !== 'dia' && /^[a-z0-9]+$/.test(p))
    const palavrasDe = (c: CasoAnotacao) => sem(`${c.titulo ?? ''} ${c.cliente ?? ''}`).split(/[^a-z0-9]+/).filter(Boolean)
    const pontuados = casos
      .map(c => {
        const base = palavrasDe(c)
        return { c, achados: termos.filter(({ p }) => base.some(w => w.startsWith(p))) }
      })
      .filter(x => x.achados.length > 0)
    const melhor = Math.max(0, ...pontuados.map(x => x.achados.length))
    const topo = pontuados.filter(x => x.achados.length === melhor)
    candidatos = topo.map(x => x.c.id)
    if (topo.length === 1) {
      casoId = topo[0].c.id
      topo[0].achados.forEach(({ i }) => consumir(i))
    }
  }

  const restantes = palavras.filter((_, i) => !usadas.has(i))
  let a = 0, b = restantes.length
  while (a < b && LIGACAO.has(sem(restantes[a]))) a++
  while (b > a && LIGACAO.has(sem(restantes[b - 1]))) b--
  const titulo = maiuscula(restantes.slice(a, b).join(' ') || (usadas.size === palavras.length ? '' : original))
  return { titulo, tipo, data, hora, casoId, candidatos }
}
