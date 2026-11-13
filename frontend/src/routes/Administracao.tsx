import { useAvisos } from '../Avisos'
import { mensagemPorStatus } from '../api/mcpClient'
import { avisarDadosAlterados } from '../api/rest'
import CabecalhoPagina from '../CabecalhoPagina'
import Carregamento from '../Carregamento'
import TabelaResponsiva from '../TabelaResponsiva'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  Flex,
  Heading,
  Select,
  Tabs,
  Text,
  TextField,
} from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { useNavegacao } from '../api/NavegacaoContext'
import { AREAS, usePerfil } from '../api/PerfilContext'
import { formatarMoeda } from '../utils/formatadores'
import { NIVEIS, PERFIS, aplicarPerfil, grauPadrao, perfilDe, type Grau } from './administracao/perfis'
import { descreverCampos, haQuanto, lerValorHora, listarEmFrase, resumoVinculos, rotuloAcao, type Vinculos } from './administracao/formatos'
import IntegracoesAdmin from './administracao/IntegracoesAdmin'
import './administracao.scss'

type Usuario = {
  usuario_id: string; login: string; nome_completo: string; email: string | null
  nivel_acesso: string; status: string; criado_em: string | null; atualizado_em: string | null
  ultimo_acesso_em: string | null; email_verificado_em: string | null
  criado_por: string | null; revogado_em: string | null; revogado_por: string | null
  permissoes?: Record<string, Grau>
}
type Historico = { ocorrido_em: string; ator: string; usuario: string; acao: string; campos: string }
type Banco = { tipo: string; tamanho_bytes: number; tabelas: number }
const VAZIO = { login: '', nome_completo: '', email: '', nivel_acesso: 'operador', status: 'ativo', permissoes: {} as Record<string, Grau> }
const GRAUS: [Grau, string][] = [['editar', 'Ver e alterar'], ['ver', 'Somente ver'], ['nenhum', 'Sem acesso']]
const STATUS: Record<string, { rotulo: string; cor: 'green' | 'amber' | 'orange' | 'gray' }> = {
  ativo: { rotulo: 'Ativo', cor: 'green' }, pendente: { rotulo: 'Pendente', cor: 'amber' },
  bloqueado: { rotulo: 'Bloqueado', cor: 'orange' }, revogado: { rotulo: 'Revogado', cor: 'gray' },
}
const data = (valor: string | null) => valor ? new Date(valor).toLocaleString('pt-BR') : 'Não registrado'
type Carga = 'carregando' | 'ok' | 'erro'
type Editor = { login: string | null; campos: typeof VAZIO; valorHora: string }
type AlvoToken = { login: string; nome: string; email: string | null; enviarEmail: boolean }
type ResultadoToken = { token: string; encerraSessao: boolean; email: { enviado: boolean; destino: string | null; motivo: string | null } | null }
type AlvoApagar = { login: string; nome: string; vinculos: Vinculos | null; erro: string; texto: string }

export default function Administracao() {
  const { cliente } = useCliente()
  const { nivel, login: eu } = usePerfil()
  const [credencial, setCredencial] = useState('')
  const [sessao, setSessao] = useState<string | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const nomeDe = (login: string) => usuarios.find(u => u.login === login)?.nome_completo ?? login
  const [historico, setHistorico] = useState<Historico[]>([])
  const [acessos, setAcessos] = useState<{ ocorrido_em: string; usuario: string }[]>([])
  const [banco, setBanco] = useState<Banco | null>(null)
  const [tarifas, setTarifas] = useState<Record<string, number> | null>(null)
  const [carga, setCarga] = useState<Record<'banco' | 'historico' | 'acessos', Carga>>({ banco: 'carregando', historico: 'carregando', acessos: 'carregando' })
  const [erro, setErro] = useState('')
  const { avisar } = useAvisos()
  const setMensagem = (texto: string) => { if (texto) avisar({ texto }) }
  const [ocupado, setOcupado] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [tokenNovo, setTokenNovo] = useState('')
  const [confirmarBackup, setConfirmarBackup] = useState(false)
  const [limpeza, setLimpeza] = useState<{ categorias: string[]; texto: string; resultado: Record<string, number> | null } | null>(null)
  const [alvoToken, setAlvoToken] = useState<AlvoToken | null>(null)
  const [resultadoToken, setResultadoToken] = useState<ResultadoToken | null>(null)
  const [alvoApagar, setAlvoApagar] = useState<AlvoApagar | null>(null)
  const [autoCarregando, setAutoCarregando] = useState(false)
  const [esperouPerfil, setEsperouPerfil] = useState(false)
  const { consumirPayload } = useNavegacao()
  // Links como #/administracao?aba=integracoes abrem direto na aba pedida.
  const [abaAdmin, setAbaAdmin] = useState(() => {
    const pedida = consumirPayload<{ aba?: string }>('administracao')?.aba
    return pedida && ['usuarios', 'integracoes', 'banco', 'historico'].includes(pedida) ? pedida : 'usuarios'
  })
  const tentouAuto = useRef(false)
  const CATEGORIAS_LIMPEZA: [string, string][] = [
    ['publicacoes', 'Publicações capturadas'],
    ['monitoramento_tecnico', 'Dados técnicos de monitoramento'],
    ['notificacoes', 'Notificações'],
  ]

  async function requisicao(url: string, token: string, metodo = 'GET', corpo?: unknown) {
    const r = await fetch(url, { method: metodo, cache: 'no-store', headers: {
      Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.mensagem || e.erro || mensagemPorStatus(r.status))
    }
    if (metodo !== 'GET') avisarDadosAlterados()
    return r
  }
  async function carregar(token: string) {
    const r = await requisicao('/admin/usuarios/api', token)
    const dados = await r.json() as { usuarios: Usuario[] }
    setUsuarios(dados.usuarios)
    setSessao(token)
    setCredencial('')
  }
  // As abas secundárias carregam sozinhas ao abrir; "Atualizar" refaz. Cada uma falha sem derrubar as outras.
  const marcar = (aba: keyof typeof carga, estado: Carga) => setCarga(c => ({ ...c, [aba]: estado }))
  async function carregarBanco(token: string) {
    marcar('banco', 'carregando')
    try { setBanco(await (await requisicao('/admin/banco/api', token)).json()); marcar('banco', 'ok') } catch (e) { marcar('banco', 'erro'); throw e }
  }
  async function carregarHistorico(token: string) {
    marcar('historico', 'carregando')
    try { setHistorico((await (await requisicao('/admin/usuarios/historico', token)).json()).historico); marcar('historico', 'ok') } catch (e) { marcar('historico', 'erro'); throw e }
  }
  async function carregarAcessos(token: string) {
    marcar('acessos', 'carregando')
    try { setAcessos((await (await requisicao('/admin/usuarios/acessos', token)).json()).acessos); marcar('acessos', 'ok') } catch (e) { marcar('acessos', 'erro'); throw e }
  }
  // O valor por hora vive em /horas/tarifas e exige a conexão de uma pessoa administradora (não o token do servidor).
  async function carregarTarifas() {
    if (!cliente) { setTarifas(null); return }
    try { setTarifas((await (await requisicao('/horas/tarifas', cliente.token)).json()).tarifas ?? {}) } catch { setTarifas(null) }
  }
  async function executar(acao: () => Promise<void>) {
    setOcupado(true); setErro(''); setMensagem('')
    try { await acao() } catch (e) { setErro(e instanceof Error ? e.message : 'Falha na operação.') }
    finally { setOcupado(false) }
  }
  function sair() {
    setSessao(null); setCredencial(''); setUsuarios([]); setHistorico([]); setAcessos([]); setBanco(null); setTarifas(null)
    setEditor(null); setTokenNovo(''); setErro(''); setMensagem(''); setConfirmarBackup(false); setLimpeza(null)
  }

  // Conectada como administradora: abre já carregada, sem pedir o token administrativo.
  useEffect(() => {
    const espera = window.setTimeout(() => setEsperouPerfil(true), 4000)
    return () => window.clearTimeout(espera)
  }, [])
  useEffect(() => {
    if (sessao || tentouAuto.current || !cliente || nivel !== 'administrador') return
    tentouAuto.current = true
    setAutoCarregando(true)
    void executar(() => carregar(cliente.token)).finally(() => setAutoCarregando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, nivel, sessao])
  useEffect(() => {
    if (!sessao) return
    void Promise.allSettled([carregarBanco(sessao), carregarHistorico(sessao), carregarAcessos(sessao), carregarTarifas()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao])
  const abrindo = !sessao && (autoCarregando || (Boolean(cliente) && nivel === null && !esperouPerfil))
  const sessaoDaConexao = sessao !== null && sessao === cliente?.token

  // Novo token: o anterior deixa de valer na hora; pode seguir por e-mail para a pessoa.
  async function gerarNovoToken() {
    if (!alvoToken || !sessao) return
    const { login, enviarEmail } = alvoToken
    const r = await (await requisicao(`/admin/usuarios/api/${encodeURIComponent(login)}/token`, sessao, 'POST', { enviar_email: enviarEmail })).json() as
      { token: string; encerra_sessao_atual: boolean; email: ResultadoToken['email'] }
    setAlvoToken(null)
    setResultadoToken({ token: r.token, encerraSessao: r.encerra_sessao_atual, email: r.email })
    if (!r.encerra_sessao_atual) await carregar(sessao)   // o token da própria pessoa que pediu deixou de valer: não recarrega
  }
  // Apagar: mostra antes o que muda (processos e demais itens ficam sem responsável) e só então confirma.
  async function abrirApagar(u: Usuario) {
    if (!sessao) return
    setAlvoApagar({ login: u.login, nome: u.nome_completo, vinculos: null, erro: '', texto: '' })
    try {
      const v = (await (await requisicao(`/admin/usuarios/api/${encodeURIComponent(u.login)}/vinculos`, sessao)).json()).vinculos as Vinculos
      setAlvoApagar(a => a && a.login === u.login ? { ...a, vinculos: v } : a)
    } catch (e) {
      setAlvoApagar(a => a && a.login === u.login ? { ...a, erro: e instanceof Error ? e.message : 'Não foi possível consultar o que está ligado a esta pessoa.' } : a)
    }
  }
  async function confirmarApagar() {
    if (!alvoApagar || !sessao) return
    const { login, nome } = alvoApagar
    const r = await (await requisicao(`/admin/usuarios/api/${encodeURIComponent(login)}`, sessao, 'DELETE')).json() as { resumo: Vinculos }
    const frases = resumoVinculos(r.resumo).desatribuidos
    setAlvoApagar(null)
    await carregar(sessao)
    setMensagem(`${nome} foi apagado.${frases.length ? ` ${listarEmFrase(frases)} ficaram sem responsável.` : ''}`)
  }
  function abrirEditor(u: Usuario | null) {
    setErro('')
    const valor = u && tarifas ? tarifas[u.login] : undefined
    setEditor(u === null
      ? { login: null, campos: { ...VAZIO }, valorHora: '' }
      : { login: u.login, campos: { login: u.login, nome_completo: u.nome_completo, email: u.email || '', nivel_acesso: u.nivel_acesso, status: u.status, permissoes: u.permissoes ?? {} }, valorHora: valor !== undefined ? String(valor).replace('.', ',') : '' })
  }
  async function salvar() {
    if (!editor || !sessao) return
    const { login, campos, valorHora } = editor
    const corpo = login === null ? campos : { nome_completo: campos.nome_completo, email: campos.email, nivel_acesso: campos.nivel_acesso, status: campos.status, permissoes: campos.permissoes }
    const r = await requisicao(login === null ? '/admin/usuarios/api' : `/admin/usuarios/api/${encodeURIComponent(login)}`, sessao, login === null ? 'POST' : 'PATCH', corpo)
    const resultado = await r.json() as { token?: string }
    setEditor(null)
    if (resultado.token) setTokenNovo(resultado.token)
    await carregar(sessao)
    // Valor por hora: só se mudou, e depois do cadastro (o servidor exige que a pessoa já exista).
    const novo = lerValorHora(valorHora)
    const alvo = (login ?? campos.login).toLowerCase()
    if (tarifas !== null && cliente && novo !== undefined && novo !== (tarifas[alvo] ?? null)) {
      try {
        await requisicao(`/horas/tarifas/${encodeURIComponent(alvo)}`, cliente.token, 'PUT', { valor_hora: novo })
        await carregarTarifas()
      } catch (e) {
        avisar({ tipo: 'erro', texto: `Cadastro salvo, mas o valor por hora não foi salvo: ${e instanceof Error ? e.message : 'tente de novo.'}` })
        return
      }
    }
    setMensagem('Cadastro salvo.')
  }
  const lista = usuarios.filter(u => `${u.login} ${u.nome_completo} ${u.email || ''}`.toLocaleLowerCase('pt-BR').includes(filtro.toLocaleLowerCase('pt-BR')))
  const falhaCarga = (aba: keyof typeof carga, vazio: string) => carga[aba] === 'carregando' ? 'Carregando…' : carga[aba] === 'erro' ? 'Não foi possível carregar. Use Atualizar.' : vazio

  const perfilAtual = editor ? perfilDe(editor.campos.nivel_acesso, editor.campos.permissoes) : null
  const valorHoraInvalido = editor !== null && lerValorHora(editor.valorHora) === undefined

  return <section className="administracao" aria-busy={ocupado}>
    <CabecalhoPagina titulo="Administração" descricao="Gerencie os usuários e acompanhe o banco de dados do sistema." />
    {erro && (
      <Callout.Root color="red" size="1">
        <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
        <Callout.Text>{erro}</Callout.Text>
      </Callout.Root>
    )}
    {abrindo ? <Carregamento tipo="detalhe" descricao="Abrindo a administração…" /> : !sessao ? <form className="administracao__acesso" onSubmit={e => { e.preventDefault(); void executar(() => carregar(credencial || cliente?.token || '')) }}>
      <Heading as="h2" size="4">Acesso administrativo</Heading>
      <Text as="p" size="2" color="gray">Use sua conexão de administrador ou informe o token administrativo do servidor.</Text>
      <div className="form-campo">
        <label className="form-campo-label" htmlFor="admin-token">Token administrativo</label>
        <TextField.Root id="admin-token" type="password" autoComplete="off" value={credencial} onChange={e => setCredencial(e.target.value)} />
        <Text size="1" color="gray">Mantido somente na memória enquanto este painel estiver aberto.</Text>
      </div>
      <Button size="2" type="submit" disabled={ocupado || !(credencial || cliente?.token)}>{ocupado ? 'Verificando…' : 'Acessar administração'}</Button>
    </form> : <>
      <div className="administracao__acoes">
        <Button variant="soft" size="2" disabled={ocupado} onClick={() => void executar(async () => {
          await carregar(sessao)
          await Promise.allSettled([carregarBanco(sessao), carregarHistorico(sessao), carregarAcessos(sessao), carregarTarifas()])
        })}>Atualizar tudo</Button>
        {!sessaoDaConexao && <Button variant="ghost" size="2" disabled={ocupado} onClick={sair}>Encerrar administração</Button>}
      </div>
      <Tabs.Root value={abaAdmin} onValueChange={setAbaAdmin}>
        <Tabs.List aria-label="Administração">
          <Tabs.Trigger value="usuarios">Usuários</Tabs.Trigger>
          <Tabs.Trigger value="integracoes">Integrações</Tabs.Trigger>
          <Tabs.Trigger value="banco">Banco de dados</Tabs.Trigger>
          <Tabs.Trigger value="historico">Histórico administrativo</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="usuarios">
          <dl className="administracao__resumo"><div><dt>Usuários cadastrados</dt><dd>{usuarios.length}</dd></div><div><dt>Ativos</dt><dd>{usuarios.filter(u => u.status === 'ativo').length}</dd></div><div><dt>Bloqueados ou revogados</dt><dd>{usuarios.filter(u => ['bloqueado', 'revogado'].includes(u.status)).length}</dd></div></dl>
          <section className="administracao__niveis" aria-label="Níveis de acesso">
            <Text size="2" weight="bold">Níveis de acesso</Text>
            <div className="administracao__niveis-lista">
              {Object.entries(NIVEIS).map(([id, n]) => (
                <div key={id}><Badge color={n.cor} variant="soft">{n.rotulo}</Badge><Text size="2" color="gray">{n.descricao}</Text></div>
              ))}
            </div>
            <Text size="1" color="gray">Ao criar ou editar uma pessoa, os perfis prontos (Advogado, Secretaria, Financeiro e Somente consulta) ajustam o acesso por área de uma vez; depois dá para refinar cada área.</Text>
          </section>
          <div className="administracao__acoes">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="admin-filtro">Filtrar usuários</label>
              <TextField.Root id="admin-filtro" value={filtro} onChange={e => setFiltro(e.target.value)} />
            </div>
            <Button size="2" disabled={ocupado} onClick={() => abrirEditor(null)}>Criar usuário</Button>
          </div>
          <div className="administracao__tabela" role="region" aria-label="Usuários cadastrados" tabIndex={0}><TabelaResponsiva principais={['Usuário', 'Nível de acesso', 'Status']}><table><caption>Usuários do sistema — {lista.length} resultado(s)</caption><thead><tr>{['Usuário', 'E-mail', 'Nível de acesso', 'Status', ...(tarifas ? ['Valor por hora'] : []), 'Ações'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>
            {lista.map(u => {
              const n = NIVEIS[u.nivel_acesso as keyof typeof NIVEIS]
              const st = STATUS[u.status]
              const pronto = n && u.nivel_acesso !== 'administrador' ? perfilDe(u.nivel_acesso, u.permissoes) : null
              const personalizado = n && u.nivel_acesso !== 'administrador' && !pronto && Object.keys(u.permissoes ?? {}).length > 0
              return (
                <tr key={u.usuario_id}>
                  <td>{u.nome_completo}{u.login === eu && <> <Badge color="blue" variant="soft">Você</Badge></>}<small title={data(u.ultimo_acesso_em)}>Último acesso: {haQuanto(u.ultimo_acesso_em)}</small>{u.login.toLowerCase() !== (u.email ?? '').toLowerCase() && <small>{u.login}</small>}</td>
                  <td>{u.email || 'Não informado'}</td>
                  <td><Badge color={n?.cor ?? 'gray'} variant="soft">{n?.rotulo ?? u.nivel_acesso}</Badge>{(pronto || personalizado) && <small>{pronto ? pronto.rotulo : 'Acesso personalizado'}</small>}</td>
                  <td><Badge color={st?.cor ?? 'gray'} variant="soft">{st?.rotulo ?? u.status}</Badge></td>
                  {tarifas && <td>{tarifas[u.login] !== undefined ? `${formatarMoeda(tarifas[u.login])}/h` : '—'}</td>}
                  <td>
                    <Flex gap="3" wrap="wrap">
                      <Button size="1" variant="ghost" disabled={ocupado} onClick={() => abrirEditor(u)}>Editar<Text className="aj-sr-only"> {u.nome_completo}</Text></Button>
                      <Button size="1" variant="ghost" disabled={ocupado || u.status !== 'ativo'} title={u.status !== 'ativo' ? 'Só usuários ativos recebem um novo token' : undefined}
                        onClick={() => setAlvoToken({ login: u.login, nome: u.nome_completo, email: u.email, enviarEmail: Boolean(u.email) })}>Novo token<Text className="aj-sr-only"> de {u.nome_completo}</Text></Button>
                      <Button size="1" variant="ghost" color="red" disabled={ocupado || u.login === eu} title={u.login === eu ? 'Você não pode apagar o próprio acesso' : undefined}
                        onClick={() => void abrirApagar(u)}>Apagar<Text className="aj-sr-only"> {u.nome_completo}</Text></Button>
                    </Flex>
                  </td>
                </tr>
              )
            })}
            {!lista.length && <tr><td colSpan={tarifas ? 6 : 5}>Nenhum usuário encontrado.</td></tr>}
          </tbody></table></TabelaResponsiva></div>
        </Tabs.Content>
        <Tabs.Content value="integracoes">
          <IntegracoesAdmin token={sessao} />
        </Tabs.Content>
        <Tabs.Content value="banco">
          <Heading as="h2" size="4" mt="4">Banco de dados</Heading>
          <Text as="p" size="2" color="gray">Consulte o estado do SQLite e gere uma cópia consistente dos dados.</Text>
          <div className="administracao__acoes">
            <Button size="2" disabled={ocupado} onClick={() => void executar(() => carregarBanco(sessao))}>Atualizar informações</Button>
            <Button variant="soft" size="2" disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/banco/integridade', sessao, 'POST')).json(); if (!r.integro) throw new Error('A verificação identificou inconsistências no banco.'); setMensagem(`Integridade verificada em ${data(r.verificado_em)}.`) })}>Verificar integridade</Button>
            <Button variant="soft" size="2" disabled={ocupado} onClick={() => setConfirmarBackup(true)}>Baixar backup</Button>
            <Button variant="ghost" color="red" size="2" disabled={ocupado} onClick={() => setLimpeza({ categorias: [], texto: '', resultado: null })}>Limpar dados</Button>
          </div>
          {banco ? <dl className="administracao__resumo"><div><dt>Banco</dt><dd>{banco.tipo}</dd></div><div><dt>Tamanho</dt><dd>{(banco.tamanho_bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB</dd></div><div><dt>Tabelas</dt><dd>{banco.tabelas}</dd></div></dl>
            : <Text as="p" size="2" color="gray" role="status">{falhaCarga('banco', '')}</Text>}
        </Tabs.Content>
        <Tabs.Content value="historico">
          <Heading as="h2" size="4" mt="4">Histórico administrativo</Heading>
          <Text as="p" size="2" color="gray">Até 100 alterações de cadastro, com data e responsável.</Text>
          <Button size="2" disabled={ocupado} onClick={() => void executar(() => carregarHistorico(sessao))}>Atualizar histórico</Button>
          <div className="administracao__tabela" role="region" aria-label="Histórico administrativo" tabIndex={0}><TabelaResponsiva principais={['Data', 'Usuário', 'Ação']}><table><thead><tr>{['Data', 'Responsável', 'Usuário', 'Ação', 'Campos alterados'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{historico.map((h, i) => <tr key={i}><td>{data(h.ocorrido_em)}</td><td>{nomeDe(h.ator)}</td><td>{nomeDe(h.usuario)}</td><td>{rotuloAcao(h.acao)}</td><td>{descreverCampos(h.campos)}</td></tr>)}{!historico.length && <tr><td colSpan={5}>{falhaCarga('historico', 'Nenhuma alteração registrada.')}</td></tr>}</tbody></table></TabelaResponsiva></div>
        </Tabs.Content>
      </Tabs.Root>
      <section aria-label="Histórico de acessos">
        <Heading as="h2" size="4" mt="5">Histórico de acessos</Heading>
        <Text as="p" size="2" color="gray">Últimos 100 registros de atividade autenticada. Até um registro por usuário por minuto, com retenção de 180 dias.</Text>
        <Button size="2" disabled={ocupado} onClick={() => void executar(() => carregarAcessos(sessao))}>Atualizar acessos</Button>
        <div className="administracao__tabela" role="region" aria-label="Acessos registrados" tabIndex={0}>
          <TabelaResponsiva principais={['Data e hora', 'Usuário']}><table><thead><tr><th scope="col">Data e hora</th><th scope="col">Usuário</th></tr></thead>
            <tbody>{acessos.map((a, i) => <tr key={i}><td>{data(a.ocorrido_em)}</td><td>{nomeDe(a.usuario)}</td></tr>)}{!acessos.length && <tr><td colSpan={2}>{falhaCarga('acessos', 'Nenhum acesso registrado.')}</td></tr>}</tbody>
          </table></TabelaResponsiva>
        </div>
      </section>
    </>}

    <Dialog.Root open={editor !== null} onOpenChange={(open) => { if (!open && !ocupado) { setEditor(null); setErro('') } }}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>{editor?.login === null ? 'Criar usuário' : 'Editar usuário'}</Dialog.Title>
        {editor && <div className="administracao__formulario">
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-login">Login</label>
            <TextField.Root id="usuario-login" value={editor.campos.login} disabled={editor.login !== null || ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, login: e.target.value } })} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-nome">Nome completo</label>
            <TextField.Root id="usuario-nome" maxLength={200} value={editor.campos.nome_completo} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, nome_completo: e.target.value } })} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-email">E-mail</label>
            <TextField.Root id="usuario-email" type="email" maxLength={254} value={editor.campos.email} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, email: e.target.value } })} />
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-perfil">Perfil pronto</label>
            <Select.Root value={perfilAtual?.id ?? 'personalizado'} disabled={ocupado} onValueChange={id => {
              const perfil = PERFIS.find(x => x.id === id)
              if (perfil) setEditor({ ...editor, campos: { ...editor.campos, ...aplicarPerfil(perfil) } })
            }}>
              <Select.Trigger id="usuario-perfil" style={{ width: '100%' }} />
              <Select.Content>
                {PERFIS.map(x => <Select.Item key={x.id} value={x.id}>{x.rotulo}</Select.Item>)}
                <Select.Item value="personalizado" disabled>Personalizado</Select.Item>
              </Select.Content>
            </Select.Root>
            <Text size="1" color="gray">{perfilAtual ? perfilAtual.descricao : 'Acesso personalizado: escolha um perfil pronto para recomeçar ou ajuste cada área abaixo.'}</Text>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-nivel">Nível de acesso</label>
            <Select.Root value={editor.campos.nivel_acesso} disabled={ocupado} onValueChange={v => setEditor({ ...editor, campos: { ...editor.campos, nivel_acesso: v } })}>
              <Select.Trigger id="usuario-nivel" style={{ width: '100%' }} />
              <Select.Content>
                {Object.entries(NIVEIS).map(([v, n]) => <Select.Item key={v} value={v}>{n.rotulo}</Select.Item>)}
              </Select.Content>
            </Select.Root>
            <Text size="1" color="gray">{NIVEIS[editor.campos.nivel_acesso as keyof typeof NIVEIS]?.descricao}</Text>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-status">Status</label>
            <Select.Root value={editor.campos.status} disabled={ocupado} onValueChange={v => setEditor({ ...editor, campos: { ...editor.campos, status: v } })}>
              <Select.Trigger id="usuario-status" style={{ width: '100%' }} />
              <Select.Content>
                {Object.entries(STATUS).map(([v, t]) => <Select.Item key={v} value={v}>{t.rotulo}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          {tarifas !== null && (
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="usuario-valor-hora">Valor por hora (R$), opcional</label>
              <TextField.Root id="usuario-valor-hora" inputMode="decimal" value={editor.valorHora} disabled={ocupado} placeholder="Sem valor definido"
                color={valorHoraInvalido ? 'red' : undefined} onChange={e => setEditor({ ...editor, valorHora: e.target.value })} />
              <Text size="1" color={valorHoraInvalido ? 'red' : 'gray'}>{valorHoraInvalido ? 'Informe um valor maior que zero, como 300 ou 300,50.' : 'Usado nas horas que esta pessoa lançar daqui em diante; horas antigas não mudam.'}</Text>
            </div>
          )}
          {editor.campos.nivel_acesso !== 'administrador' && (
            <fieldset className="administracao__permissoes">
              <legend>Acesso por área</legend>
              <Text as="p" size="1" color="gray">
                Parte do nível escolhido; mude só o que esta pessoa precisa. {editor.campos.nivel_acesso === 'consulta' && 'No nível Consulta ninguém altera dados.'}
              </Text>
              {Object.entries(AREAS).map(([area, rotulo]) => {
                const padrao = grauPadrao(editor.campos.nivel_acesso)
                const atual = editor.campos.permissoes[area] ?? padrao
                return (
                  <div className="administracao__permissao" key={area}>
                    <Text size="2" id={`perm-${area}`}>{rotulo}</Text>
                    <Select.Root value={atual} disabled={ocupado} onValueChange={v => {
                      const permissoes = { ...editor.campos.permissoes }
                      if (v === padrao) delete permissoes[area]; else permissoes[area] = v as Grau
                      setEditor({ ...editor, campos: { ...editor.campos, permissoes } })
                    }}>
                      <Select.Trigger aria-labelledby={`perm-${area}`} />
                      <Select.Content>
                        {GRAUS.filter(([g]) => !(editor.campos.nivel_acesso === 'consulta' && g === 'editar')).map(([g, t]) => <Select.Item key={g} value={g}>{t}</Select.Item>)}
                      </Select.Content>
                    </Select.Root>
                  </div>
                )
              })}
            </fieldset>
          )}
          <Text as="p" size="2" color="gray">Administrador gerencia o sistema; operador altera dados; consulta permite leitura. Revogar encerra o acesso permanentemente.</Text>
          {editor.login && (() => { const u = usuarios.find(u => u.login === editor.login); return u && <dl><dt>ID</dt><dd>{u.usuario_id}</dd><dt>Cadastrado em</dt><dd>{data(u.criado_em)}</dd><dt>Atualizado em</dt><dd>{data(u.atualizado_em)}</dd><dt>E-mail verificado em</dt><dd>{data(u.email_verificado_em)}</dd><dt>Criado por</dt><dd>{u.criado_por || 'Não registrado'}</dd><dt>Revogado em</dt><dd>{data(u.revogado_em)}</dd><dt>Revogado por</dt><dd>{u.revogado_por || 'Não registrado'}</dd></dl> })()}
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" disabled={ocupado} onClick={() => { setEditor(null); setErro('') }}>Cancelar</Button>
            <Button disabled={ocupado || valorHoraInvalido || !editor.campos.nome_completo.trim() || (editor.login === null && (!editor.campos.email || !editor.campos.login))} onClick={() => void executar(salvar)}>
              {ocupado ? 'Salvando…' : 'Salvar cadastro'}
            </Button>
          </Flex>
        </div>}
      </Dialog.Content>
    </Dialog.Root>

    <AlertDialog.Root open={alvoToken !== null} onOpenChange={(open) => { if (!open && !ocupado) { setAlvoToken(null); setErro('') } }}>
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Gerar novo token</AlertDialog.Title>
        {alvoToken && <div className="administracao__formulario">
          <AlertDialog.Description>
            Será gerado um novo token para <strong>{alvoToken.nome}</strong>. O token atual <strong>deixa de funcionar imediatamente</strong>: quem o usa em algum computador ou no Claude precisará colar o novo.
            {alvoToken.login === eu && ' Este é o seu próprio acesso: você será desconectado e terá de entrar com o token novo.'}
          </AlertDialog.Description>
          {erro && <Callout.Root color="red" size="1"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={alvoToken.enviarEmail} disabled={ocupado || !alvoToken.email} onCheckedChange={v => setAlvoToken({ ...alvoToken, enviarEmail: v === true })} />
              {alvoToken.email ? <>Enviar o novo token por e-mail para <strong>{alvoToken.email}</strong></> : 'Sem e-mail cadastrado: o token será só exibido a você'}
            </Flex>
          </Text>
          <Text as="p" size="1" color="gray">O token aparece para você uma única vez, de qualquer forma. O e-mail leva o token em texto: use só se o e-mail da pessoa for confiável.</Text>
        </div>}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
          <Button disabled={ocupado} onClick={() => void executar(gerarNovoToken)}>{ocupado ? 'Gerando…' : 'Gerar novo token'}</Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <Dialog.Root open={resultadoToken !== null} onOpenChange={(open) => { if (!open) setResultadoToken(null) }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Novo token gerado</Dialog.Title>
        {resultadoToken && <div className="administracao__formulario">
          <Text as="p" size="2">O token abaixo é exibido somente agora. O anterior já não funciona.</Text>
          {resultadoToken.email && (resultadoToken.email.enviado
            ? <Callout.Root color="green" size="1" role="status"><Callout.Text>Enviado por e-mail para {resultadoToken.email.destino}.</Callout.Text></Callout.Root>
            : <Callout.Root color="amber" size="1" role="status"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>E-mail não enviado: {resultadoToken.email.motivo} Entregue o token por um canal seguro.</Callout.Text></Callout.Root>)}
          {resultadoToken.encerraSessao && <Callout.Root color="amber" size="1" role="status"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>Este era o seu próprio token: a sessão atual deixou de valer. Copie o novo token e entre de novo pela tela Acesso.</Callout.Text></Callout.Root>}
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="token-gerado">Token gerado</label>
            <TextField.Root id="token-gerado" value={resultadoToken.token} readOnly />
          </div>
        </div>}
        <Flex gap="3" mt="4" justify="end"><Dialog.Close><Button variant="soft">Fechar</Button></Dialog.Close></Flex>
      </Dialog.Content>
    </Dialog.Root>

    <AlertDialog.Root open={alvoApagar !== null} onOpenChange={(open) => { if (!open && !ocupado) { setAlvoApagar(null); setErro('') } }}>
      <AlertDialog.Content maxWidth="520px">
        <AlertDialog.Title>Apagar usuário</AlertDialog.Title>
        {alvoApagar && (() => {
          const r = alvoApagar.vinculos ? resumoVinculos(alvoApagar.vinculos) : null
          return <div className="administracao__formulario">
            <AlertDialog.Description>Você vai apagar <strong>{alvoApagar.nome}</strong>. O token dela deixa de funcionar e esta ação não pode ser desfeita.</AlertDialog.Description>
            {alvoApagar.erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{alvoApagar.erro}</Callout.Text></Callout.Root>}
            {erro && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>{erro}</Callout.Text></Callout.Root>}
            {!r && !alvoApagar.erro && <Carregamento tipo="texto" descricao="Verificando o que está ligado a esta pessoa…" />}
            {r?.bloqueio && <Callout.Root color="red" size="1" role="alert"><Callout.Icon><AlertTriangle size={14} /></Callout.Icon><Callout.Text>Não é possível apagar agora: {r.bloqueio}</Callout.Text></Callout.Root>}
            {r && !r.bloqueio && <>
              <Text as="p" size="2">
                {r.desatribuidos.length
                  ? <><strong>Ficam sem responsável</strong> (e podem ser atribuídos a outra pessoa depois): {listarEmFrase(r.desatribuidos)}.</>
                  : 'Nada está atribuído a esta pessoa.'}
              </Text>
              <Text as="p" size="2"><strong>São removidos junto:</strong> {listarEmFrase(r.removidos)}.</Text>
              {r.mantidos.length > 0 && <Text as="p" size="2"><strong>Continuam:</strong> {listarEmFrase(r.mantidos)}, com o nome da pessoa.</Text>}
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="apagar-confirmacao">Digite "APAGAR" para confirmar</label>
                <TextField.Root id="apagar-confirmacao" value={alvoApagar.texto} disabled={ocupado} autoComplete="off" onChange={e => setAlvoApagar({ ...alvoApagar, texto: e.target.value })} />
              </div>
            </>}
          </div>
        })()}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
          <Button color="red" disabled={ocupado || !alvoApagar?.vinculos || Boolean(alvoApagar && resumoVinculos(alvoApagar.vinculos ?? { processos: 0, atividades: 0, lancamentos: 0, monitoramentos: 0, notificacoes: 0, horas: 0, agenda: 0 }).bloqueio) || alvoApagar?.texto !== 'APAGAR'}
            onClick={() => void executar(confirmarApagar)}>{ocupado ? 'Apagando…' : 'Apagar usuário'}</Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <Dialog.Root open={!!tokenNovo} onOpenChange={(open) => { if (!open) setTokenNovo('') }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Copie o token de acesso</Dialog.Title>
        <Text as="p" size="2">O token será exibido somente agora. Entregue-o ao usuário por um canal seguro.</Text>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor="usuario-token-novo">Token gerado</label>
          <TextField.Root id="usuario-token-novo" value={tokenNovo} readOnly />
        </div>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close><Button variant="soft">Fechar</Button></Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>

    <AlertDialog.Root open={confirmarBackup} onOpenChange={(open) => { if (!open && !ocupado) setConfirmarBackup(false) }}>
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Baixar backup do banco</AlertDialog.Title>
        <AlertDialog.Description>O arquivo contém os dados do sistema, incluindo informações pessoais e credenciais cifradas ou hashes. Guarde-o em um local de acesso restrito.</AlertDialog.Description>
        {erro && (
          <Callout.Root color="red" size="1" mt="3">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
          <Button disabled={ocupado} onClick={() => void executar(async () => {
            if (!sessao) return
            const r = await requisicao('/admin/banco/backup', sessao, 'POST')
            const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'cnj-backup.db'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setConfirmarBackup(false); setMensagem('Backup gerado para download.')
          })}>Baixar backup</Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={limpeza !== null} onOpenChange={(open) => { if (!open && !ocupado) setLimpeza(null) }}>
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Limpar dados do banco</AlertDialog.Title>
        {limpeza && <div className="administracao__formulario">
          <AlertDialog.Description>Esta ação apaga permanentemente os dados das categorias marcadas. Não afeta usuários, clientes, casos, financeiro ou os cadastros de monitoramento.</AlertDialog.Description>
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
          {CATEGORIAS_LIMPEZA.map(([chave, rotulo]) => (
            <Text as="label" size="2" key={chave}>
              <Flex gap="2" align="center">
                <Checkbox
                  disabled={ocupado}
                  checked={limpeza.categorias.includes(chave)}
                  onCheckedChange={(checked) => setLimpeza({ ...limpeza, categorias: checked ? [...limpeza.categorias, chave] : limpeza.categorias.filter(c => c !== chave) })}
                />
                {rotulo}
              </Flex>
            </Text>
          ))}
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="limpeza-confirmacao">Digite "LIMPAR" para confirmar</label>
            <TextField.Root id="limpeza-confirmacao" value={limpeza.texto} disabled={ocupado} onChange={e => setLimpeza({ ...limpeza, texto: e.target.value })} />
          </div>
          {limpeza.resultado && <dl className="administracao__resumo">{Object.entries(limpeza.resultado).map(([chave, total]) => <div key={chave}><dt>{CATEGORIAS_LIMPEZA.find(c => c[0] === chave)?.[1] || chave}</dt><dd>{total} registro(s) apagado(s)</dd></div>)}</dl>}
        </div>}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={ocupado}>Cancelar</Button></AlertDialog.Cancel>
          <Button color="red" disabled={ocupado || !limpeza?.categorias.length || limpeza?.texto !== 'LIMPAR'} onClick={() => void executar(async () => {
            if (!sessao || !limpeza) return
            const r = await requisicao('/admin/banco/limpar', sessao, 'POST', { categorias: limpeza.categorias })
            const resultado = await r.json() as { apagados: Record<string, number> }
            setLimpeza({ ...limpeza, resultado: resultado.apagados })
            setMensagem('Dados selecionados foram apagados.')
          })}>{ocupado ? 'Limpando…' : 'Limpar dados selecionados'}</Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </section>
}
