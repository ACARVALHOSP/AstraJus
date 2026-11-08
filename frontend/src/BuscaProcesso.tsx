import { useState } from 'react'
import { Button, Flex, Text, TextField } from '@radix-ui/themes'
import { Search } from 'lucide-react'
import { formatarNomeExibicao, formatarNumeroCNJ } from './utils/formatadores'

type CasoOpcao = { id: string; titulo?: string | null; processos?: string[] }
const semAcento = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Escolha de processo por busca (título ou número CNJ). Substitui a lista suspensa, que não
 *  acompanha nomes longos nem centenas de processos. */
export default function BuscaProcesso({ casos, valor, onChange, id }: {
  casos: CasoOpcao[]; valor: string; onChange: (id: string) => void; id: string
}) {
  const [texto, setTexto] = useState('')
  const escolhido = casos.find(c => c.id === valor)
  const termo = semAcento(texto.trim())
  const digitos = texto.replace(/\D/g, '')
  const resultados = !escolhido && termo
    ? casos.filter(c => semAcento(c.titulo ?? '').includes(termo)
        || (digitos.length >= 4 && (c.processos ?? []).some(n => n.replace(/\D/g, '').includes(digitos)))).slice(0, 8)
    : []

  if (escolhido) {
    return (
      <Flex align="center" justify="between" gap="3" className="aj-busca-escolhido">
        <Text size="2" weight="medium">{formatarNomeExibicao(escolhido.titulo || '(sem título)')}</Text>
        <Button type="button" variant="ghost" size="1" onClick={() => { onChange(''); setTexto('') }}>Trocar</Button>
      </Flex>
    )
  }
  return (
    <>
      <TextField.Root id={id} autoComplete="off" placeholder="Busque pelo título ou número do processo" value={texto} onChange={e => setTexto(e.target.value)}>
        <TextField.Slot><Search size={14} aria-hidden="true" /></TextField.Slot>
      </TextField.Root>
      {resultados.length > 0 && (
        <Flex direction="column" gap="1" className="busca-resultados" role="listbox" aria-label="Processos encontrados">
          {resultados.map(c => (
            <button key={c.id} type="button" role="option" aria-selected={false} className="aj-busca-item" onClick={() => onChange(c.id)}>
              {formatarNomeExibicao(c.titulo || '(sem título)')}
              {c.processos?.[0] && <Text size="1" color="gray"> · {formatarNumeroCNJ(c.processos[0])}</Text>}
            </button>
          ))}
        </Flex>
      )}
      {termo && !resultados.length && <Text size="1" color="gray" role="status">Nenhum processo encontrado.</Text>}
    </>
  )
}
