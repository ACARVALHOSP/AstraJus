import { useEffect, useState } from 'react'
import { Button, Flex, Text, TextField } from '@radix-ui/themes'
import { Search } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { rotuloItemTpu, type ItemTpu } from './buscaProcessos'

type Resposta = { erro?: boolean; itens?: ItemTpu[] }

/** Escolha de classe ou assunto das Tabelas Processuais Unificadas (TPU) pelo nome: devolve o código que a busca
 *  no DataJud exige. Digitar um número procura pelo código. */
export default function CampoTpu({ id, tabela, valor, escolhido, onChange }: {
  id: string
  tabela: 'classes' | 'assuntos'
  /** Código escolhido ('' = nenhum). */
  valor: string
  /** Item escolhido, para mostrar o nome em vez do número. */
  escolhido: ItemTpu | null
  onChange: (codigo: string, item: ItemTpu | null) => void
}) {
  const { cliente } = useCliente()
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState<{ termo: string; itens: ItemTpu[] } | null>(null)
  const termo = texto.trim()

  useEffect(() => {
    if (!cliente || termo.length < 2) return
    let ativo = true
    // Espera a pessoa parar de digitar; a TPU é local no servidor, então a resposta é rápida.
    const espera = setTimeout(async () => {
      try {
        const dados = (await cliente.chamarFerramenta('consultar_tpu', { tabela, busca: termo, limite: 8 })) as Resposta
        if (ativo) setResultado({ termo, itens: dados.erro ? [] : dados.itens ?? [] })
      } catch {
        if (ativo) setResultado({ termo, itens: [] })
      }
    }, 300)
    return () => { ativo = false; clearTimeout(espera) }
  }, [cliente, tabela, termo])

  if (valor) {
    return (
      <Flex align="center" justify="between" gap="3" className="aj-busca-escolhido">
        <Text size="2" weight="medium">{escolhido ? `${escolhido.nome} (${escolhido.codigo})` : `Código ${valor}`}</Text>
        <Button type="button" variant="ghost" size="1" onClick={() => { onChange('', null); setTexto(''); setResultado(null) }}>Trocar</Button>
      </Flex>
    )
  }
  const itens = resultado && resultado.termo === termo && termo.length >= 2 ? resultado.itens : []
  return (
    <>
      <TextField.Root id={id} autoComplete="off" role="combobox" aria-expanded={itens.length > 0} aria-controls={`${id}-lista`}
        placeholder={tabela === 'classes' ? 'Nome ou código da classe' : 'Nome ou código do assunto'}
        value={texto} onChange={e => setTexto(e.target.value)}>
        <TextField.Slot><Search size={14} aria-hidden="true" /></TextField.Slot>
      </TextField.Root>
      {itens.length > 0 && (
        <Flex id={`${id}-lista`} direction="column" gap="1" className="busca-resultados" role="listbox" aria-label={tabela === 'classes' ? 'Classes encontradas' : 'Assuntos encontrados'}>
          {itens.map(item => (
            <button key={item.codigo} type="button" role="option" aria-selected={false} className="aj-busca-item"
              onClick={() => { onChange(String(item.codigo), item); setTexto('') }}>
              {item.nome} <Text size="1" color="gray"> · {rotuloItemTpu(item)}</Text>
            </button>
          ))}
        </Flex>
      )}
      {termo.length >= 2 && resultado?.termo === termo && !itens.length && <Text size="1" color="gray" role="status">Nada encontrado nas tabelas do CNJ.</Text>}
    </>
  )
}
