import LinhaFiltros from '../../LinhaFiltros'
import { ariaSort, BotaoOrdenar, EscolherColunas, ordenarLista, useColunas, useOrdenacao } from '../../OrdenacaoColunas'
import CabecalhoPagina from '../../CabecalhoPagina'
import TabelaResponsiva from '../../TabelaResponsiva'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCasos, useClientes } from '../../api/consultas'
import { AlertDialog, Avatar, Badge, Button, Callout, Checkbox, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Building2, Download, Info, Mail, Pencil, Phone, Tag, User } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { useEstreita } from '../../utils/useEstreita'
import ClientesLoteModal from './ClientesLoteModal'

export type ClienteItem = {
  id: string
  nome: string
  cpf_cnpj?: string | null
  tipo_pessoa?: string
  perfil?: string
  telefone?: string
  email?: string
  etiquetas?: string[]
}
type CasoResumo = { id: string; cliente_id?: string; clientes_adicionais?: string[] }
const SEM_CASOS: CasoResumo[] = []
type Atalho = 'cliente' | 'contato' | ''

const POR_PAGINA = 20

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

function SeloTipoPessoa({ tipo }: { tipo?: string }) {
  if (tipo !== 'juridica' && tipo !== 'fisica') return <Text size="1" color="gray">Não informado</Text>
  const juridica = tipo === 'juridica'
  const rotulo = juridica ? 'Pessoa jurídica' : 'Pessoa física'
  // Só o ícone: o rótulo fica no tooltip e para leitores de tela.
  return (
    <Avatar size="1" radius="full" variant="soft" color={juridica ? 'orange' : 'blue'} role="img" aria-label={rotulo} title={rotulo}
      fallback={juridica ? <Building2 size={14} aria-hidden="true" /> : <User size={14} aria-hidden="true" />} />
  )
}

function csvCampo(valor: unknown) {
  const texto = String(valor ?? '')
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export default function ListaContatos({ onAbrir, onNovo }: { onAbrir: (id: string) => void; onNovo: () => void }) {
  const { cliente } = useCliente()
  const estreita = useEstreita()
  const queryClient = useQueryClient()
  const consulta = useClientes<ClienteItem>()
  // A contagem de processos é complementar: se falhar, a lista de contatos continua.
  const consultaCasos = useCasos<CasoResumo>()
  const carregando = consulta.isPending
  const clientes: ClienteItem[] | null = consulta.data ?? null
  const casos = consultaCasos.data ?? SEM_CASOS
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const erro = erroAcao ?? (consulta.error ? (consulta.error instanceof ErroMCP ? consulta.error.message : 'Falha ao carregar.') : null)
  const [busca, setBusca] = useState('')
  const [atalho, setAtalho] = useState<Atalho>('cliente')
  const [tipo, setTipo] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [pagina, setPagina] = useState(1)
  const [paraExcluir, setParaExcluir] = useState<ClienteItem | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [loteAberto, setLoteAberto] = useState<'etiquetas' | 'perfil' | null>(null)

  async function confirmarExclusao() {
    if (!paraExcluir) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/clientes/${paraExcluir.id}`, {}, 'DELETE')
      queryClient.setQueryData(['clientes', cliente?.token], (atual: ClienteItem[] | undefined) => atual?.filter((c) => c.id !== paraExcluir.id))
      setErroAcao(null)
      setParaExcluir(null)
    } catch (e) {
      setErroAcao(e instanceof ErroMCP ? e.message : 'Falha ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const processosPorCliente = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const c of casos) for (const id of new Set([c.cliente_id, ...(c.clientes_adicionais ?? [])])) {
      if (id) mapa.set(id, (mapa.get(id) ?? 0) + 1)
    }
    return mapa
  }, [casos])

  const { ordem, alternar: alternarOrdem } = useOrdenacao('contatos', { campo: 'nome', direcao: 'asc' })
  const ordenarPor = (campo: string) => { alternarOrdem(campo); setPagina(1) }
  const colunas = useColunas('contatos', [
    { chave: 'contato', rotulo: 'Contato (telefone e e-mail)' }, { chave: 'etiquetas', rotulo: 'Etiquetas' }, { chave: 'processos', rotulo: 'Processos' },
  ])

  // Busca, tipo e etiqueta valem para todos os atalhos (e para seus contadores).
  const filtrados = useMemo(() => {
    const consulta = normalizar(busca)
    const digitos = consulta.replace(/\D/g, '')
    const soNumeros = digitos.length >= 3 && /^[+\d\s().\-/]+$/.test(consulta)
    return (clientes ?? []).filter((c) => {
      if (tipo && c.tipo_pessoa !== tipo) return false
      if (etiqueta && !(c.etiquetas ?? []).includes(etiqueta)) return false
      if (!consulta) return true
      if (soNumeros) {
        return [c.telefone, c.cpf_cnpj].some(v => String(v || '').replace(/\D/g, '').includes(digitos))
      }
      return normalizar(`${c.nome || ''} ${c.email || ''} ${c.cpf_cnpj || ''}`).includes(consulta)
    }).sort((a, b) => normalizar(a.nome || '').localeCompare(normalizar(b.nome || ''), 'pt-BR'))
  }, [clientes, busca, tipo, etiqueta])
  const doAtalho = (c: ClienteItem, a: Atalho) => !a || (a === 'contato' ? c.perfil === 'contato' : c.perfil !== 'contato')
  const lista = ordenarLista(filtrados.filter(c => doAtalho(c, atalho)), ordem, {
    nome: c => normalizar(c.nome || ''),
    tipo: c => c.tipo_pessoa === 'juridica' ? 'Pessoa jurídica' : 'Pessoa física',
    processos: c => processosPorCliente.get(c.id) ?? 0,
  })
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const visiveis = lista.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA)

  const etiquetasExistentes = [...new Set((clientes ?? []).flatMap((c) => c.etiquetas ?? []))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const idsLote = [...selecionados]
  const todosSelecionados = visiveis.length > 0 && visiveis.every((c) => selecionados.has(c.id))
  const algunsSelecionados = visiveis.some((c) => selecionados.has(c.id)) && !todosSelecionados
  const filtrosAtivos = Boolean(busca || tipo || etiqueta)

  function mudarFiltro(acao: () => void) { acao(); setPagina(1) }
  function alternar(id: string) {
    setSelecionados((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo })
  }
  function toggleTodos() {
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (todosSelecionados) visiveis.forEach((c) => novo.delete(c.id))
      else visiveis.forEach((c) => novo.add(c.id))
      return novo
    })
  }
  function exportar() {
    const linhas = (clientes ?? []).filter(c => selecionados.has(c.id))
    const cabecalho = ['Nome', 'Tipo', 'Perfil', 'CPF/CNPJ', 'Telefone', 'E-mail', 'Etiquetas', 'Processos']
    const corpo = linhas.map(c => [
      formatarNomeExibicao(c.nome), c.tipo_pessoa === 'juridica' ? 'Pessoa jurídica' : c.tipo_pessoa === 'fisica' ? 'Pessoa física' : '',
      c.perfil === 'contato' ? 'Contato' : 'Cliente', c.cpf_cnpj, c.telefone, c.email, (c.etiquetas ?? []).join(', '), processosPorCliente.get(c.id) ?? 0,
    ].map(csvCampo).join(';'))
    // BOM para o Excel abrir acentos corretamente; ";" é o separador padrão em pt-BR.
    const blob = new Blob(['﻿' + [cabecalho.join(';'), ...corpo].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `contatos-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const contato = (c: ClienteItem) => (
    <div className="contatos-contato">
      {c.telefone ? <a href={`tel:${c.telefone.replace(/[^\d+]/g, '')}`}><Phone size={13} aria-hidden="true" /> {c.telefone}</a> : <Text size="1" color="gray">Sem telefone</Text>}
      {c.email ? <a href={`mailto:${c.email}`} title={c.email} className="contatos-email"><Mail size={13} aria-hidden="true" /> <span>{c.email}</span></a> : <Text size="1" color="gray">Sem e-mail</Text>}
    </div>
  )
  const etiquetas = (c: ClienteItem) => (c.etiquetas ?? []).length
    ? <Flex gap="1" wrap="wrap">{(c.etiquetas ?? []).map((et) => <Badge key={et} variant="soft">{et}</Badge>)}</Flex>
    : <Text size="1" color="gray">—</Text>
  const processos = (c: ClienteItem) => {
    const qtd = processosPorCliente.get(c.id) ?? 0
    return qtd
      ? <button type="button" className="contatos-link" onClick={() => onAbrir(c.id)}>{qtd} processo{qtd > 1 ? 's' : ''}</button>
      : <Text size="1" color="gray">Nenhum</Text>
  }
  const menu = (c: ClienteItem) => (
    <AcoesTabela rotulo={c.nome || 'contato'} acoes={[
      { texto: 'Abrir contato', executar: () => onAbrir(c.id) },
      { texto: 'Excluir', executar: () => setParaExcluir(c), perigo: true },
    ]} />
  )

  const atalhos: Array<{ valor: Atalho; rotulo: string }> = [
    { valor: 'cliente', rotulo: 'Clientes' },
    { valor: 'contato', rotulo: 'Outros contatos' },
    { valor: '', rotulo: 'Todos' },
  ]

  return (
    <Flex direction="column" gap="5">
      <CabecalhoPagina
        titulo="Contatos"
        descricao="Clientes e demais pessoas vinculadas aos processos do escritório."
        acoes={<Button size="2" onClick={onNovo}>Novo contato</Button>}
      />

      <div className="contatos-atalhos" role="group" aria-label="Perfil">
        {atalhos.map(a => {
          const ativo = atalho === a.valor
          return (
            <Button key={a.valor || 'todos'} size="2" radius="full" variant={ativo ? 'soft' : 'outline'} color={ativo ? undefined : 'gray'}
              aria-pressed={ativo} onClick={() => mudarFiltro(() => setAtalho(a.valor))}>
              {a.rotulo} <Text size="1" color="gray">{filtrados.filter(c => doAtalho(c, a.valor)).length}</Text>
            </Button>
          )
        })}
      </div>

      <LinhaFiltros ativos={[tipo, etiqueta].filter(Boolean).length}>
        <div className="form-campo aj-filtros-busca">
          <label className="form-campo-label" htmlFor="contatos-busca">Buscar</label>
          <TextField.Root id="contatos-busca" type="search" placeholder="Nome, CPF/CNPJ, telefone ou e-mail" autoComplete="off"
            value={busca} onChange={(e) => mudarFiltro(() => setBusca(e.target.value))} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="contatos-tipo-rotulo">Tipo de pessoa</label>
          <Select.Root value={tipo || '__todos__'} onValueChange={v => mudarFiltro(() => setTipo(v === '__todos__' ? '' : v))}>
            <Select.Trigger aria-labelledby="contatos-tipo-rotulo" />
            <Select.Content>
              <Select.Item value="__todos__">Física e jurídica</Select.Item>
              <Select.Item value="fisica">Pessoa física</Select.Item>
              <Select.Item value="juridica">Pessoa jurídica</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" id="contatos-etiqueta-rotulo">Etiqueta</label>
          <Select.Root value={etiqueta || '__todas__'} onValueChange={v => mudarFiltro(() => setEtiqueta(v === '__todas__' ? '' : v))}>
            <Select.Trigger aria-labelledby="contatos-etiqueta-rotulo" />
            <Select.Content>
              <Select.Item value="__todas__">Todas as etiquetas</Select.Item>
              {etiquetasExistentes.map(et => <Select.Item key={et} value={et}>{et}</Select.Item>)}
            </Select.Content>
          </Select.Root>
        </div>
        {filtrosAtivos && <Button size="2" variant="soft" color="gray" onClick={() => mudarFiltro(() => { setBusca(''); setTipo(''); setEtiqueta('') })}>Limpar filtros</Button>}
      </LinhaFiltros>
      {!estreita && <Flex justify="end" mt="-3"><EscolherColunas colunas={colunas} /></Flex>}

      {idsLote.length > 0 && (
        <div className="contatos-lote" role="region" aria-label="Ações em lote">
          <Text size="2" weight="bold">{idsLote.length} selecionado(s)</Text>
          <Button variant="soft" color="gray" size="1" onClick={() => setLoteAberto('etiquetas')}><Tag size={14} /> Etiquetas</Button>
          <Button variant="soft" color="gray" size="1" onClick={() => setLoteAberto('perfil')}><Pencil size={14} /> Mudar perfil</Button>
          <Button variant="soft" color="gray" size="1" onClick={exportar}><Download size={14} /> Exportar</Button>
          <Button variant="ghost" size="1" onClick={() => setSelecionados(new Set())}>Cancelar</Button>
        </div>
      )}

      <div aria-live="polite">
        {carregando && <Carregamento colunas={6} />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && clientes && clientes.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum contato cadastrado ainda.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && clientes && clientes.length > 0 && lista.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum contato corresponde aos filtros.</Callout.Text>
          </Callout.Root>
        )}
      </div>

      {!carregando && visiveis.length > 0 && (estreita ? (
        <ul className="contatos-cartoes">
          {visiveis.map(c => (
            <li key={c.id} className="contatos-cartao">
              <Flex align="center" gap="2">
                <Checkbox checked={selecionados.has(c.id)} onCheckedChange={() => alternar(c.id)} aria-label={`Selecionar ${formatarNomeExibicao(c.nome)}`} />
                <button type="button" className="contatos-link contatos-nome" onClick={() => onAbrir(c.id)}>{formatarNomeExibicao(c.nome)}</button>
                <span style={{ marginLeft: 'auto' }}>{menu(c)}</span>
              </Flex>
              <Flex gap="2" align="center" wrap="wrap"><SeloTipoPessoa tipo={c.tipo_pessoa} />{processos(c)}</Flex>
              {contato(c)}
              {(c.etiquetas ?? []).length > 0 && etiquetas(c)}
            </li>
          ))}
        </ul>
      ) : (
        <TabelaResponsiva principais={['Nome']}>
          <table aria-label="Contatos" className="contatos-tabela">
            <thead>
              <tr>
                <th className="tabela-controle">
                  <Checkbox checked={todosSelecionados ? true : algunsSelecionados ? 'indeterminate' : false}
                    onCheckedChange={toggleTodos} aria-label="Selecionar todos os contatos desta página" />
                </th>
                <th aria-sort={ariaSort('nome', ordem)}><BotaoOrdenar campo="nome" ordem={ordem} onOrdenar={ordenarPor}>Nome</BotaoOrdenar></th>
                <th className="contatos-col-tipo" aria-sort={ariaSort('tipo', ordem)}><BotaoOrdenar campo="tipo" ordem={ordem} onOrdenar={ordenarPor}>Tipo</BotaoOrdenar></th>
                {colunas.visivel('contato') && <th className="contatos-col-contato">Contato</th>}
                {colunas.visivel('etiquetas') && <th className="contatos-col-etiquetas">Etiquetas</th>}
                {colunas.visivel('processos') && <th className="contatos-col-processos" aria-sort={ariaSort('processos', ordem)}><BotaoOrdenar campo="processos" ordem={ordem} onOrdenar={ordenarPor}>Processos</BotaoOrdenar></th>}
                <th className="tabela-acoes contatos-col-acoes">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.id} className={selecionados.has(c.id) ? 'contatos-selecionado' : undefined}>
                  <td className="tabela-controle">
                    <Checkbox checked={selecionados.has(c.id)} onCheckedChange={() => alternar(c.id)} aria-label={`Selecionar ${formatarNomeExibicao(c.nome)}`} />
                  </td>
                  <td><button type="button" className="contatos-link contatos-nome" onClick={() => onAbrir(c.id)}>{formatarNomeExibicao(c.nome)}</button></td>
                  <td><SeloTipoPessoa tipo={c.tipo_pessoa} /></td>
                  {colunas.visivel('contato') && <td>{contato(c)}</td>}
                  {colunas.visivel('etiquetas') && <td>{etiquetas(c)}</td>}
                  {colunas.visivel('processos') && <td>{processos(c)}</td>}
                  <td className="tabela-acoes">{menu(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabelaResponsiva>
      ))}

      {!carregando && lista.length > 0 && (
        <nav aria-label="Páginas de contatos" className="aj-paginacao">
          <Text size="2" color="gray">
            Mostrando {(paginaAtual - 1) * POR_PAGINA + 1}–{Math.min(paginaAtual * POR_PAGINA, lista.length)} de {lista.length} contato(s)
          </Text>
          <span style={{ marginLeft: 'auto' }} />
          <Button variant="soft" color="gray" size="2" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)} aria-label="Página anterior">Anterior</Button>
          <Text size="2">Página {paginaAtual} de {totalPaginas}</Text>
          <Button variant="soft" color="gray" size="2" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)} aria-label="Próxima página">Próxima</Button>
        </nav>
      )}

      <AlertDialog.Root open={paraExcluir !== null} onOpenChange={(open) => !open && setParaExcluir(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir contato</AlertDialog.Title>
          <AlertDialog.Description>Excluir o contato "{paraExcluir?.nome}"? Essa ação não pode ser desfeita.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" disabled={excluindo} onClick={confirmarExclusao}>Excluir</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {loteAberto && (
        <ClientesLoteModal
          open
          tipo={loteAberto}
          ids={idsLote}
          etiquetasExistentes={etiquetasExistentes}
          onClose={() => setLoteAberto(null)}
          onConcluido={() => {
            setLoteAberto(null)
            setSelecionados(new Set())
            void consulta.refetch()
          }}
        />
      )}
    </Flex>
  )
}
