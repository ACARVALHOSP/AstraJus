import { formatarDataSimples, formatarNumeroCNJ } from '../../utils/formatadores'
import { REGRAS_PRAZO, type calcularPrazo, type CalendarioForense, type RegraPrazo } from './prazos'
import estilos from './impressaoPrazo.css?inline'

type DadosImpressao = {
  titulo: string; numero: string; tribunal: string; municipio: string; base: string; dias: number
  regra: RegraPrazo; suspensaoCpc: boolean; calendario: CalendarioForense | null
  resultado: ReturnType<typeof calcularPrazo>; dataFinal: string; revisado: boolean
}

/** Uses a local document and text nodes only; publication data never becomes HTML. */
export function imprimirDemonstrativoPrazo(dados: DadosImpressao): void {
  // Keep the Window reference while preparing the document, then sever its opener.
  const janela = window.open('', '_blank')
  if (!janela) throw new Error('Não foi possível abrir o demonstrativo. Permita a abertura de pop-ups para este site e tente novamente.')
  janela.opener = null
  const doc = janela.document
  doc.documentElement.lang = 'pt-BR'
  doc.title = `Demonstrativo do prazo — ${formatarNumeroCNJ(dados.numero) || 'AstraJus'}`
  function elemento<K extends keyof HTMLElementTagNameMap>(tag: K, texto?: string) {
    const node = doc.createElement(tag)
    if (texto !== undefined) node.textContent = texto
    return node
  }
  const meta = elemento('meta'); meta.setAttribute('charset', 'utf-8')
  const viewport = elemento('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'
  const css = elemento('style', estilos)
  doc.head.append(meta, viewport, css)
  const header = elemento('header')
  const imprimir = elemento('button', 'Imprimir / salvar PDF')
  imprimir.type = 'button'; imprimir.addEventListener('click', () => janela.print())
  header.append(elemento('strong', 'AstraJus'), imprimir)
  doc.body.append(header, elemento('h1', 'Demonstrativo do prazo'), elemento('p', `Atividade: ${dados.titulo}`), elemento('p', `Processo: ${formatarNumeroCNJ(dados.numero) || 'Não informado'} · ${dados.tribunal.toUpperCase()}`))
  const resumo = elemento('dl'); resumo.className = 'resumo'
  const itens = [
    ['Data-base', formatarDataSimples(dados.base)], ['Quantidade', `${dados.dias} dias úteis`],
    ['Termo inicial', formatarDataSimples(dados.resultado.termoInicial)], ['Data final calculada', formatarDataSimples(dados.resultado.dataFinal)],
    ['Município / comarca', dados.calendario?.municipio || dados.municipio], ['Regra aplicada', REGRAS_PRAZO[dados.regra]],
    ['Suspensão de 20/12 a 20/01', dados.suspensaoCpc ? 'Selecionada' : 'Não selecionada'],
    [dados.revisado ? 'Data final confirmada na revisão' : 'Data final em edição (não confirmada)', dados.dataFinal ? formatarDataSimples(dados.dataFinal) : 'Não informada'],
  ]
  for (const [rotulo, valor] of itens) {
    const par = elemento('div'); par.append(elemento('dt', rotulo), elemento('dd', valor)); resumo.append(par)
  }
  doc.body.append(resumo)
  const situacao = elemento('p', dados.revisado
    ? 'Prazo revisado pelo usuário antes da confirmação da atividade.'
    : 'Pendente de revisão. Sem vencimento confirmado. A data calculada é uma sugestão.')
  situacao.className = 'situacao'; doc.body.append(situacao)
  if (dados.dataFinal && dados.dataFinal !== dados.resultado.dataFinal) {
    doc.body.append(elemento('p', `Ajuste manual: ${formatarDataSimples(dados.dataFinal)}. A tabela abaixo preserva a contagem original, cujo vencimento calculado é ${formatarDataSimples(dados.resultado.dataFinal)}.`))
  }
  const tabela = elemento('table'); tabela.setAttribute('aria-label', 'Demonstrativo dia a dia')
  const cabecalho = elemento('thead'), linhaCabecalho = elemento('tr')
  for (const rotulo of ['Data', 'Dia da semana', 'Dia do prazo', 'Evento']) {
    const th = elemento('th', rotulo); th.scope = 'col'; linhaCabecalho.append(th)
  }
  cabecalho.append(linhaCabecalho)
  const corpo = elemento('tbody')
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
  for (const linha of dados.resultado.linhas) {
    const tr = elemento('tr')
    if (linha.evento === 'Vencimento') tr.className = 'vencimento'
    else if (linha.evento === 'Fim de semana') tr.className = 'nao-util'
    else if (linha.evento.includes('Suspensão')) tr.className = 'suspensao'
    else if (linha.dia === null && !['Publicação', 'Disponibilização DJEN'].includes(linha.evento)) tr.className = 'feriado'
    tr.append(elemento('td', formatarDataSimples(linha.data)), elemento('td', semana.format(new Date(`${linha.data}T12:00:00Z`))), elemento('td', linha.dia === null ? '—' : String(linha.dia)), elemento('td', linha.evento === 'Vencimento' ? 'Vencimento calculado' : linha.evento))
    corpo.append(tr)
  }
  tabela.append(cabecalho, corpo); doc.body.append(tabela)
  const fonte = elemento('p', `Fonte do calendário: ${dados.calendario?.fonte || 'Não informada'}. Cobertura: ${dados.calendario?.completo ? 'completa segundo o provedor' : 'incompleta; verificar suspensões e provimentos'}.`)
  fonte.className = 'fonte'; doc.body.append(fonte)
  if (dados.calendario?.consultadoEm) doc.body.append(elemento('p', `Calendário consultado em: ${new Date(dados.calendario.consultadoEm).toLocaleString('pt-BR')}`))
  janela.focus()
}
