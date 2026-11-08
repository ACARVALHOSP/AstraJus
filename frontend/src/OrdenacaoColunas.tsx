import { useState, type ReactNode } from 'react'
import { Button, Checkbox, Flex, Popover, Text } from '@radix-ui/themes'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

// Ordenação por cabeçalho e escolha de colunas, iguais em todas as listas. As escolhas ficam
// guardadas neste navegador (conveniência por pessoa; não precisam ir ao servidor).

export type Ordem = { campo: string; direcao: 'asc' | 'desc' }
type Valor = string | number | null | undefined

function ler<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave)
    return bruto ? { ...padrao, ...JSON.parse(bruto) } : padrao
  } catch {
    return padrao
  }
}
function gravar(chave: string, valor: unknown) {
  try { localStorage.setItem(chave, JSON.stringify(valor)) } catch { /* só nesta sessão */ }
}

export function useOrdenacao(chave: string, padrao: Ordem) {
  const [ordem, setOrdem] = useState<Ordem>(() => ler(`astrajus-ordem-${chave}`, padrao))
  function alternar(campo: string) {
    const nova: Ordem = ordem.campo === campo
      ? { campo, direcao: ordem.direcao === 'asc' ? 'desc' : 'asc' }
      : { campo, direcao: 'asc' }
    setOrdem(nova)
    gravar(`astrajus-ordem-${chave}`, nova)
  }
  function definir(nova: Ordem) {
    setOrdem(nova)
    gravar(`astrajus-ordem-${chave}`, nova)
  }
  return { ordem, alternar, definir }
}

/** Ordena uma cópia da lista. Vazios ficam sempre no fim; texto em ordem alfabética brasileira. */
export function ordenarLista<T>(lista: T[], ordem: Ordem, acessores: Record<string, (item: T) => Valor>): T[] {
  const acessar = acessores[ordem.campo]
  if (!acessar) return lista
  const fator = ordem.direcao === 'asc' ? 1 : -1
  return lista
    .map((item, i) => ({ item, i, v: acessar(item) }))
    .sort((a, b) => {
      const va = a.v, vb = b.v
      const vazioA = va === null || va === undefined || va === '', vazioB = vb === null || vb === undefined || vb === ''
      if (vazioA || vazioB) return vazioA === vazioB ? a.i - b.i : vazioA ? 1 : -1
      const r = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base', numeric: true })
      return r * fator || a.i - b.i
    })
    .map(x => x.item)
}

/** Conteúdo do <th>: botão que ordena pela coluna. Use com aria-sort={ariaSort(...)} no <th>. */
export function BotaoOrdenar({ campo, ordem, onOrdenar, children }: {
  campo: string; ordem: Ordem; onOrdenar: (campo: string) => void; children: ReactNode
}) {
  const ativo = ordem.campo === campo
  const Icone = !ativo ? ArrowUpDown : ordem.direcao === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" className={`aj-th-ordenar${ativo ? ' aj-th-ordenar--ativo' : ''}`} onClick={() => onOrdenar(campo)}>
      {children}
      <Icone size={13} aria-hidden="true" />
    </button>
  )
}

export function ariaSort(campo: string, ordem: Ordem): 'ascending' | 'descending' | 'none' {
  return ordem.campo !== campo ? 'none' : ordem.direcao === 'asc' ? 'ascending' : 'descending'
}

export type ColunaOpcional = { chave: string; rotulo: string }

export function useColunas(chave: string, opcionais: ColunaOpcional[], escondidasPadrao: string[] = []) {
  const [escondidas, setEscondidas] = useState<string[]>(() => {
    try {
      const bruto = localStorage.getItem(`astrajus-colunas-${chave}`)
      return bruto ? JSON.parse(bruto) : escondidasPadrao
    } catch { return escondidasPadrao }
  })
  const visivel = (coluna: string) => !escondidas.includes(coluna)
  function alternar(coluna: string, mostrar: boolean) {
    const novas = mostrar ? escondidas.filter(c => c !== coluna) : [...new Set([...escondidas, coluna])]
    setEscondidas(novas)
    gravar(`astrajus-colunas-${chave}`, novas)
  }
  return { visivel, alternar, opcionais }
}

export function EscolherColunas({ colunas }: { colunas: ReturnType<typeof useColunas> }) {
  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button size="2" variant="soft" color="gray">Colunas</Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="280px">
        <Text as="p" size="2" weight="bold" mb="2">Mostrar colunas</Text>
        <Flex direction="column" gap="2">
          {colunas.opcionais.map(c => (
            <Text as="label" size="2" key={c.chave}>
              <Flex gap="2" align="center">
                <Checkbox checked={colunas.visivel(c.chave)} onCheckedChange={v => colunas.alternar(c.chave, v === true)} />
                {c.rotulo}
              </Flex>
            </Text>
          ))}
        </Flex>
      </Popover.Content>
    </Popover.Root>
  )
}
