import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge, Button, Flex, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../../api/ClienteContext'
import { buscarJson } from '../../api/rest'

// Seletores com busca para os filtros do CJPG. Vara, classe e assunto vêm das árvores de referência
// do e-SAJ (cache local no servidor, endpoint /cjpg-arvore/buscar); a lista de magistrados vem
// inteira de uma vez e é filtrada no navegador. Selecionar do autocomplete usa o código interno do
// e-SAJ, que filtra de verdade no servidor do tribunal (digitar só o nome apenas busca o texto).

export type CampoArvore = 'vara' | 'classe' | 'assunto'
export type OpcaoArvore = { id: string; nome: string; busca?: string }
export type Magistrado = { codigo: string; nome: string }

const DICA_SEM_LISTA = 'Se a lista nunca foi carregada neste servidor, peça ao administrador para atualizar as árvores do CJPG.'

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [atual, setAtual] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setAtual(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return atual
}

const caixaLista: React.CSSProperties = {
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid var(--gray-a6)',
  borderRadius: 'var(--radius-2)',
  background: 'var(--color-panel-solid)',
}

const itemLista: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  width: '100%',
  padding: '0.5rem 0.75rem',
  textAlign: 'start',
  background: 'transparent',
  border: 0,
  borderBlockEnd: '1px solid var(--gray-a3)',
  color: 'var(--gray-12)',
  font: 'inherit',
  cursor: 'pointer',
}

/** Busca vara, classe ou assunto e permite escolher vários; devolve os escolhidos por `onChange`. */
export function SeletorArvore({ campo, id, rotulo, placeholder, valor, onChange }: {
  campo: CampoArvore
  id: string
  rotulo: string
  placeholder: string
  valor: OpcaoArvore[]
  onChange: (valor: OpcaoArvore[]) => void
}) {
  const { cliente } = useCliente()
  const [texto, setTexto] = useState('')
  const termo = useDebounce(texto.trim())
  const ativo = termo.length >= 2
  const consulta = useQuery({
    queryKey: ['cjpg-arvore', campo, termo, cliente?.token],
    enabled: ativo && Boolean(cliente),
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => buscarJson<{ resultados: OpcaoArvore[] }>(
      cliente, `/cjpg-arvore/buscar?campo=${campo}&q=${encodeURIComponent(termo)}`, signal,
    ).then(r => r.resultados ?? []),
  })
  const escolhidos = new Set(valor.map(o => o.id))
  const opcoes = (consulta.data ?? []).filter(o => !escolhidos.has(o.id))

  function escolher(opcao: OpcaoArvore) {
    onChange([...valor, opcao])
    setTexto('')
  }

  return (
    <div className="form-campo">
      <label className="form-campo-label" htmlFor={id}>{rotulo}</label>
      <TextField.Root id={id} placeholder={placeholder} autoComplete="off" value={texto} onChange={e => setTexto(e.target.value)} />
      {valor.length > 0 && (
        <Flex gap="2" wrap="wrap" mt="1">
          {valor.map(o => (
            <Badge key={o.id} size="2" variant="soft">
              {o.nome}
              <button
                type="button"
                aria-label={`Remover ${o.nome}`}
                onClick={() => onChange(valor.filter(x => x.id !== o.id))}
                style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}
              >
                <X size={12} aria-hidden />
              </button>
            </Badge>
          ))}
        </Flex>
      )}
      {ativo && (
        <div style={caixaLista} role="listbox" aria-label={`Resultados de ${rotulo.toLowerCase()}`}>
          {consulta.isLoading && <Text as="p" size="2" color="gray" m="2">Buscando…</Text>}
          {consulta.isError && <Text as="p" size="2" color="red" m="2">Não foi possível buscar agora. Tente de novo.</Text>}
          {consulta.isSuccess && opcoes.length === 0 && (
            <Text as="p" size="2" color="gray" m="2">
              Nada encontrado para &quot;{termo}&quot;. {(consulta.data ?? []).length === 0 ? DICA_SEM_LISTA : ''}
            </Text>
          )}
          {opcoes.map(o => (
            <button key={o.id} type="button" role="option" aria-selected={false} style={itemLista} onClick={() => escolher(o)}>
              <Text size="2">{o.nome}</Text>
              {o.busca && o.busca !== semAcento(o.nome) && <Text size="1" color="gray">{o.busca}</Text>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Magistrado: digite para filtrar a lista do e-SAJ e escolha para usar o código exato. Se só digitar o
 *  nome sem escolher, a consulta busca o nome no texto das decisões (menos preciso). */
export function SeletorMagistrado({ id, texto, onTexto, escolhido, onEscolher }: {
  id: string
  texto: string
  onTexto: (texto: string) => void
  escolhido: Magistrado | null
  onEscolher: (magistrado: Magistrado | null) => void
}) {
  const { cliente } = useCliente()
  const [aberto, setAberto] = useState(false)
  const lista = useQuery({
    queryKey: ['cjpg-magistrados', cliente?.token],
    enabled: Boolean(cliente) && aberto,
    staleTime: 60 * 60_000,
    queryFn: ({ signal }) => buscarJson<{ magistrados: Magistrado[] }>(cliente, '/cjpg-arvore/magistrados', signal)
      .then(r => r.magistrados ?? []),
  })
  const sugestoes = useMemo(() => {
    const consulta = semAcento(texto.trim())
    if (consulta.length < 2 || escolhido) return []
    return (lista.data ?? []).filter(m => semAcento(m.nome).includes(consulta)).slice(0, 20)
  }, [lista.data, texto, escolhido])

  return (
    <div className="form-campo">
      <label className="form-campo-label" htmlFor={id}>Juiz (opcional)</label>
      <TextField.Root
        id={id}
        placeholder="Nome do juiz ou juíza"
        autoComplete="off"
        value={texto}
        onFocus={() => setAberto(true)}
        onChange={e => {
          onTexto(e.target.value)
          if (escolhido) onEscolher(null) // editar o texto desfaz a escolha, para nunca usar um código desatualizado
          setAberto(true)
        }}
      />
      {escolhido ? (
        <Flex align="center" gap="2" mt="1">
          <Badge color="green" size="2" variant="soft">Filtro exato pelo cadastro do tribunal</Badge>
          <Button size="1" variant="ghost" color="gray" type="button" onClick={() => { onEscolher(null); onTexto('') }}>Limpar</Button>
        </Flex>
      ) : (
        <Text size="1" color="gray">
          Necessário para &quot;Como este juiz costuma decidir?&quot;. Escolha na lista para filtrar exatamente por esse juiz; sem escolher, o nome é buscado no texto das sentenças.
        </Text>
      )}
      {aberto && !escolhido && texto.trim().length >= 2 && (
        <div style={caixaLista} role="listbox" aria-label="Sugestões de juízes">
          {lista.isLoading && <Text as="p" size="2" color="gray" m="2">Carregando a lista de juízes…</Text>}
          {lista.isError && <Text as="p" size="2" color="red" m="2">Não foi possível carregar a lista de juízes.</Text>}
          {lista.isSuccess && sugestoes.length === 0 && (
            <Text as="p" size="2" color="gray" m="2">
              Nenhum juiz encontrado na lista. {(lista.data ?? []).length === 0 ? DICA_SEM_LISTA : 'Você ainda pode buscar pelo nome digitado.'}
            </Text>
          )}
          {sugestoes.map(m => (
            <button
              key={m.codigo}
              type="button"
              role="option"
              aria-selected={false}
              style={itemLista}
              onClick={() => { onEscolher(m); onTexto(m.nome); setAberto(false) }}
            >
              <Text size="2">{m.nome}</Text>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
