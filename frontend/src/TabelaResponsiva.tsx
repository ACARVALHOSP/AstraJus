import { Children, Fragment, cloneElement, isValidElement, useEffect, useId, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { Button } from '@radix-ui/themes'
import './tabelas.scss'

type Estrutura = {
  children?: ReactNode
  texto?: string
  className?: string
  colSpan?: number
  hidden?: boolean
  isSortable?: boolean
  isSortHeader?: boolean
  sortDirection?: string
  onClick?: (evento: MouseEvent<HTMLButtonElement>) => void
  'aria-label'?: string
}
type Elemento = ReactElement<Estrutura>
type Coluna = { cabecalho: Elemento; rotulo: string; controle: boolean; fixa: boolean; numerica: boolean; monetaria: boolean }

// Achata apenas a estrutura da tabela; o conteúdo e os handlers das células são preservados.
function elementos(conteudo: ReactNode, prefixo = ''): Elemento[] {
  return Children.toArray(conteudo).flatMap(no => {
    if (!isValidElement<Estrutura>(no)) return []
    const chave = `${prefixo}/${no.key ?? ''}`
    return no.type === Fragment ? elementos(no.props.children, chave) : [cloneElement(no, { key: chave })]
  })
}
function texto(no: ReactNode): string {
  return Children.toArray(no).map(item => isValidElement<Estrutura>(item) ? (item.props.texto ?? texto(item.props.children)) : typeof item === 'string' || typeof item === 'number' ? String(item) : '').join(' ')
}
function classe(elemento: Elemento, extra: string) {
  return [elemento.props.className, extra].filter(Boolean).join(' ')
}
function celulaExpandida(linha: Elemento) {
  const celulas = elementos(linha.props.children)
  return celulas.length === 1 && (celulas[0].props.colSpan ?? 1) > 1
}
function ajustarExpansao(linha: Elemento, quantidade: number): Elemento {
  return cloneElement(linha, {}, elementos(linha.props.children).map(celula => cloneElement(celula, { colSpan: quantidade })))
}

/** Adapta tabelas nativas à largura do contêiner, inclusive dentro de modais. */
export default function TabelaResponsiva({ children, principais = [] }: { children: Elemento; principais?: string[] }) {
  const raiz = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  useEffect(() => {
    const alvo = raiz.current
    if (!alvo) return
    const observador = new ResizeObserver(([entrada]) => setLargura(Math.round(entrada.contentRect.width)))
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [])

  const partes = elementos(children.props.children)
  const cabeca = partes.find(parte => parte.type === 'thead')
  const linhaCabecalho = elementos(cabeca?.props.children)[0]
  const colunas: Coluna[] = elementos(linhaCabecalho?.props.children).map(cabecalho => {
    const rotulo = texto(cabecalho.props.children).trim() || cabecalho.props['aria-label'] || ''
    // Cabeçalhos sem texto (seleção, expansão, favorito) são colunas de controle estreitas.
    const controle = rotulo === 'Favorito' || rotulo === 'Detalhes' || !texto(cabecalho.props.children).trim() || /\btabela-controle\b/.test(cabecalho.props.className ?? '')
    const monetaria = /^(Valor|Parcela)$/.test(rotulo)
    return { cabecalho, rotulo, controle, fixa: controle || rotulo === 'Ações', monetaria, numerica: monetaria || /^(Vencimento|Data e hora|Data|Cadastro|Último acesso|Disponibilizado em|Quando)$/.test(rotulo) }
  })
  const compacto = largura > 0 && largura < Math.max(600, colunas.length * 128)
  const prioritarias = colunas.map((c, i) => principais.includes(c.rotulo) ? i : -1).filter(i => i >= 0)
  // Se uma coluna configurável foi removida pelo usuário, mantém a primeira coluna de dados disponível.
  if (!prioritarias.length) {
    const primeira = colunas.findIndex(c => !c.fixa)
    if (primeira >= 0) prioritarias.push(primeira)
  }
  const visiveis = new Set(colunas.map((c, i) => !compacto || colunas.length <= 3 || c.fixa || prioritarias.includes(i) ? i : -1).filter(i => i >= 0))
  // Usa o espaço intermediário para revelar progressivamente mais colunas.
  if (compacto && largura >= 600) {
    const limite = Math.max(visiveis.size, Math.floor(largura / 145))
    colunas.forEach((_, i) => { if (visiveis.size < limite) visiveis.add(i) })
  }
  const complementares = colunas.map((_, i) => i).filter(i => !visiveis.has(i))
  const indiceAcoes = colunas.findIndex(c => c.rotulo === 'Ações')
  const temDetalhes = complementares.length > 0
  const adicionarColuna = temDetalhes && indiceAcoes < 0
  const quantidade = visiveis.size + Number(adicionarColuna)
  const prioridade = (i: number) => colunas[i].controle ? -100 + i : colunas[i].rotulo === 'Ações' ? 1000 : principais.includes(colunas[i].rotulo) ? principais.indexOf(colunas[i].rotulo) : 100 + i
  const ordem = [...visiveis].sort((a, b) => compacto && temDetalhes ? prioridade(a) - prioridade(b) : a - b)
  const ordenaveis = colunas.filter(c => c.cabecalho.props.isSortable && c.cabecalho.props.onClick)
  const novaCabeca = cabeca && linhaCabecalho ? cloneElement(cabeca, {}, cloneElement(linhaCabecalho, {}, [
    ...ordem.map(i => { const c = colunas[i]; return cloneElement(c.cabecalho, { className: classe(c.cabecalho, c.controle ? 'tabela-controle' : c.rotulo === 'Ações' ? 'tabela-acoes' : c.monetaria ? 'tabela-numero tabela-valor' : c.numerica ? 'tabela-numero' : '') }, c.controle && c.rotulo ? <span className="aj-sr-only">{c.rotulo}</span> : c.cabecalho.props.children) }),
    adicionarColuna ? <th key="detalhes" scope="col" className="tabela-acoes">Detalhes</th> : null,
  ])) : cabeca

  function adaptarCorpo(corpo: Elemento) {
    const linhas = elementos(corpo.props.children)
    const adaptadas: ReactNode[] = []
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]
      if (celulaExpandida(linha)) {
        adaptadas.push(ajustarExpansao(linha, quantidade))
        continue
      }
      const seguinte = linhas[i + 1]
      const expansao = seguinte && celulaExpandida(seguinte) ? seguinte : undefined
      if (expansao) i++
      adaptadas.push(<LinhaAdaptavel key={linha.key} linha={linha} expansao={expansao} colunas={colunas} ordem={ordem} complementares={complementares} indiceAcoes={indiceAcoes} quantidade={quantidade} />)
    }
    return cloneElement(corpo, {}, adaptadas)
  }

  return <div ref={raiz} className={`tabela-adaptavel${compacto ? ' tabela-adaptavel--compacta' : ''}${colunas.length <= 3 ? ' tabela-adaptavel--simples' : ''}`}>
    {temDetalhes && ordenaveis.length > 0 && <details className="tabela-ordenacao"><summary>Ordenar registros</summary><div>{ordenaveis.map(c => <Button key={c.rotulo} type="button" variant="ghost" size="1" onClick={c.cabecalho.props.onClick}>
      {c.rotulo}{c.cabecalho.props.isSortHeader ? c.cabecalho.props.sortDirection === 'ASC' ? ' · crescente' : c.cabecalho.props.sortDirection === 'DESC' ? ' · decrescente' : '' : ''}
    </Button>)}</div></details>}
    {cloneElement(children, { className: classe(children, 'tabela-fluida') }, partes.map(parte => parte === cabeca ? novaCabeca : parte.type === 'tbody' ? adaptarCorpo(parte) : parte))}
  </div>
}

function LinhaAdaptavel({ linha, expansao, colunas, ordem, complementares, indiceAcoes, quantidade }: {
  linha: Elemento; expansao?: Elemento; colunas: Coluna[]; ordem: number[]; complementares: number[]; indiceAcoes: number; quantidade: number
}) {
  const [aberta, setAberta] = useState(false)
  const id = useId()
  const celulas = elementos(linha.props.children)
  const rotulo = ordem.filter(i => !colunas[i].fixa && !colunas[i].numerica).map(i => texto(celulas[i]?.props.children)).find(Boolean) || 'registro'
  const botao = <Button type="button" className="tabela-detalhes-botao" variant="ghost" size="1" aria-expanded={aberta} aria-controls={id} onClick={() => setAberta(!aberta)}>
    {aberta ? 'Fechar' : 'Detalhes'}<span className="aj-sr-only"> de {rotulo}</span>
  </Button>
  const conteudo = ordem.flatMap(indice => {
    const celula = celulas[indice]
    if (!celula) return []
    const coluna = colunas[indice]
    return [cloneElement(celula, { className: classe(celula, coluna?.controle ? 'tabela-controle' : indice === indiceAcoes ? 'tabela-acoes' : coluna?.monetaria ? 'tabela-numero tabela-valor' : coluna?.numerica ? 'tabela-numero' : '') }, <>
      {indice === indiceAcoes && complementares.length > 0
        ? <div className="tabela-acoes-grupo">{celula.props.children}{botao}</div>
        : celula.props.children}
    </>)]
  })
  if (indiceAcoes < 0 && complementares.length > 0) conteudo.push(<td key="detalhes" className="tabela-acoes">{botao}</td>)
  const detalhes = <dl className="tabela-detalhes-lista">{complementares.map(i => <div key={colunas[i].cabecalho.key}>
    <dt>{colunas[i].rotulo}</dt><dd>{celulas[i]?.props.children}</dd>
  </div>)}</dl>
  const propsDetalhes = { id, hidden: !aberta, className: 'tabela-detalhes-linha' }
  return <>
    {cloneElement(linha, {}, conteudo)}
    {expansao && ajustarExpansao(expansao, quantidade)}
    {complementares.length > 0 && <tr {...propsDetalhes}><td colSpan={quantidade}>{aberta && detalhes}</td></tr>}
  </>
}
