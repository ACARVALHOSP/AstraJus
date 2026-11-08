import { useAvisos } from '../Avisos'
import { mensagemPorStatus } from '../api/mcpClient'
import CabecalhoPagina from '../CabecalhoPagina'
import TabelaResponsiva from '../TabelaResponsiva'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  AlertDialog,
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
import './administracao.scss'

type Usuario = {
  usuario_id: string; login: string; nome_completo: string; email: string | null
  nivel_acesso: string; status: string; criado_em: string | null; atualizado_em: string | null
  ultimo_acesso_em: string | null; email_verificado_em: string | null
  criado_por: string | null; revogado_em: string | null; revogado_por: string | null
}
type Historico = { ocorrido_em: string; ator: string; usuario: string; acao: string; campos: string }
type Banco = { tipo: string; tamanho_bytes: number; tabelas: number }
const VAZIO = { login: '', nome_completo: '', email: '', nivel_acesso: 'operador', status: 'ativo' }
const data = (valor: string | null) => valor ? new Date(valor).toLocaleString('pt-BR') : 'Não registrado'

export default function Administracao() {
  const { cliente } = useCliente()
  const [credencial, setCredencial] = useState('')
  const [sessao, setSessao] = useState<string | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [historico, setHistorico] = useState<Historico[]>([])
  const [acessos, setAcessos] = useState<{ ocorrido_em: string; usuario: string }[]>([])
  const [banco, setBanco] = useState<Banco | null>(null)
  const [erro, setErro] = useState('')
  const { avisar } = useAvisos()
  const setMensagem = (texto: string) => { if (texto) avisar({ texto }) }
  const [ocupado, setOcupado] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [editor, setEditor] = useState<{ login: string | null; campos: typeof VAZIO } | null>(null)
  const [tokenNovo, setTokenNovo] = useState('')
  const [confirmarBackup, setConfirmarBackup] = useState(false)
  const [limpeza, setLimpeza] = useState<{ categorias: string[]; texto: string; resultado: Record<string, number> | null } | null>(null)
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
    return r
  }
  async function carregar(token: string) {
    const r = await requisicao('/admin/usuarios/api', token)
    const dados = await r.json() as { usuarios: Usuario[] }
    setUsuarios(dados.usuarios)
    setSessao(token)
    setCredencial('')
  }
  async function executar(acao: () => Promise<void>) {
    setOcupado(true); setErro(''); setMensagem('')
    try { await acao() } catch (e) { setErro(e instanceof Error ? e.message : 'Falha na operação.') }
    finally { setOcupado(false) }
  }
  function sair() {
    setSessao(null); setCredencial(''); setUsuarios([]); setHistorico([]); setAcessos([]); setBanco(null)
    setEditor(null); setTokenNovo(''); setErro(''); setMensagem(''); setConfirmarBackup(false); setLimpeza(null)
  }
  async function salvar() {
    if (!editor || !sessao) return
    const { login, campos } = editor
    const corpo = login === null ? campos : { nome_completo: campos.nome_completo, email: campos.email, nivel_acesso: campos.nivel_acesso, status: campos.status }
    const r = await requisicao(login === null ? '/admin/usuarios/api' : `/admin/usuarios/api/${encodeURIComponent(login)}`, sessao, login === null ? 'POST' : 'PATCH', corpo)
    const resultado = await r.json() as { token?: string }
    setEditor(null)
    if (resultado.token) setTokenNovo(resultado.token)
    await carregar(sessao)
    setMensagem('Cadastro salvo.')
  }
  const lista = usuarios.filter(u => `${u.login} ${u.nome_completo} ${u.email || ''}`.toLocaleLowerCase('pt-BR').includes(filtro.toLocaleLowerCase('pt-BR')))

  return <section className="administracao" aria-busy={ocupado}>
    <CabecalhoPagina titulo="Administração" descricao="Gerencie os usuários e acompanhe o banco de dados do sistema." />
    {erro && (
      <Callout.Root color="red" size="1">
        <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
        <Callout.Text>{erro}</Callout.Text>
      </Callout.Root>
    )}
    {!sessao ? <form className="administracao__acesso" onSubmit={e => { e.preventDefault(); void executar(() => carregar(credencial || cliente?.token || '')) }}>
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
        <Button variant="soft" size="2" disabled={ocupado} onClick={() => void executar(() => carregar(sessao))}>Atualizar usuários</Button>
        <Button variant="ghost" size="2" disabled={ocupado} onClick={sair}>Encerrar administração</Button>
      </div>
      <Tabs.Root defaultValue="usuarios">
        <Tabs.List aria-label="Administração">
          <Tabs.Trigger value="usuarios">Usuários</Tabs.Trigger>
          <Tabs.Trigger value="banco">Banco de dados</Tabs.Trigger>
          <Tabs.Trigger value="historico">Histórico administrativo</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="usuarios">
          <dl className="administracao__resumo"><div><dt>Usuários cadastrados</dt><dd>{usuarios.length}</dd></div><div><dt>Ativos</dt><dd>{usuarios.filter(u => u.status === 'ativo').length}</dd></div><div><dt>Bloqueados ou revogados</dt><dd>{usuarios.filter(u => ['bloqueado', 'revogado'].includes(u.status)).length}</dd></div></dl>
          <div className="administracao__acoes">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="admin-filtro">Filtrar usuários</label>
              <TextField.Root id="admin-filtro" value={filtro} onChange={e => setFiltro(e.target.value)} />
            </div>
            <Button size="2" disabled={ocupado} onClick={() => { setErro(''); setEditor({ login: null, campos: { ...VAZIO } }) }}>Criar usuário</Button>
          </div>
          <div className="administracao__tabela" role="region" aria-label="Usuários cadastrados" tabIndex={0}><TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table><caption>Usuários do sistema — {lista.length} resultado(s)</caption><thead><tr>{['Nome e login', 'E-mail', 'Nível de acesso', 'Status', 'Cadastro', 'Último acesso', 'Ações'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>
            {lista.map(u => <tr key={u.usuario_id}><td>{u.nome_completo}<small>{u.login}</small></td><td>{u.email || 'Não informado'}</td><td>{u.nivel_acesso}</td><td>{u.status}</td><td>{data(u.criado_em)}</td><td>{data(u.ultimo_acesso_em)}</td><td><Button size="1" variant="ghost" disabled={ocupado} onClick={() => { setErro(''); setEditor({ login: u.login, campos: { login: u.login, nome_completo: u.nome_completo, email: u.email || '', nivel_acesso: u.nivel_acesso, status: u.status } }) }}>Editar<Text className="aj-sr-only"> {u.nome_completo}</Text></Button></td></tr>)}
            {!lista.length && <tr><td colSpan={7}>Nenhum usuário encontrado.</td></tr>}
          </tbody></table></TabelaResponsiva></div>
        </Tabs.Content>
        <Tabs.Content value="banco">
          <Heading as="h2" size="4" mt="4">Banco de dados</Heading>
          <Text as="p" size="2" color="gray">Consulte o estado do SQLite e gere uma cópia consistente dos dados.</Text>
          <div className="administracao__acoes">
            <Button size="2" disabled={ocupado} onClick={() => void executar(async () => { setBanco(await (await requisicao('/admin/banco/api', sessao)).json()) })}>Carregar informações</Button>
            <Button variant="soft" size="2" disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/banco/integridade', sessao, 'POST')).json(); if (!r.integro) throw new Error('A verificação identificou inconsistências no banco.'); setMensagem(`Integridade verificada em ${data(r.verificado_em)}.`) })}>Verificar integridade</Button>
            <Button variant="soft" size="2" disabled={ocupado} onClick={() => setConfirmarBackup(true)}>Baixar backup</Button>
            <Button variant="ghost" color="red" size="2" disabled={ocupado} onClick={() => setLimpeza({ categorias: [], texto: '', resultado: null })}>Limpar dados</Button>
          </div>
          {banco && <dl className="administracao__resumo"><div><dt>Banco</dt><dd>{banco.tipo}</dd></div><div><dt>Tamanho</dt><dd>{(banco.tamanho_bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB</dd></div><div><dt>Tabelas</dt><dd>{banco.tabelas}</dd></div></dl>}
        </Tabs.Content>
        <Tabs.Content value="historico">
          <Heading as="h2" size="4" mt="4">Histórico administrativo</Heading>
          <Text as="p" size="2" color="gray">Até 100 alterações de cadastro, com data e responsável.</Text>
          <Button size="2" disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/usuarios/historico', sessao)).json(); setHistorico(r.historico) })}>Carregar histórico</Button>
          <div className="administracao__tabela" role="region" aria-label="Histórico administrativo" tabIndex={0}><TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table><thead><tr>{['Data', 'Responsável', 'Usuário', 'Ação', 'Campos alterados'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{historico.map((h, i) => <tr key={i}><td>{data(h.ocorrido_em)}</td><td>{h.ator}</td><td>{h.usuario}</td><td>{h.acao}</td><td>{JSON.parse(h.campos).join(', ')}</td></tr>)}{!historico.length && <tr><td colSpan={5}>Carregue o histórico para consultar os registros disponíveis.</td></tr>}</tbody></table></TabelaResponsiva></div>
        </Tabs.Content>
      </Tabs.Root>
      <section aria-label="Histórico de acessos">
        <Heading as="h2" size="4" mt="5">Histórico de acessos</Heading>
        <Text as="p" size="2" color="gray">Últimos 100 registros de atividade autenticada. Até um registro por usuário por minuto, com retenção de 180 dias.</Text>
        <Button size="2" disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/usuarios/acessos', sessao)).json(); setAcessos(r.acessos) })}>Carregar acessos</Button>
        <div className="administracao__tabela" role="region" aria-label="Acessos registrados" tabIndex={0}>
          <TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table><thead><tr><th scope="col">Data e hora</th><th scope="col">Usuário</th></tr></thead>
            <tbody>{acessos.map((a, i) => <tr key={i}><td>{data(a.ocorrido_em)}</td><td>{a.usuario}</td></tr>)}{!acessos.length && <tr><td colSpan={2}>Carregue os acessos para consultar os registros disponíveis.</td></tr>}</tbody>
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
            <label className="form-campo-label" htmlFor="usuario-nivel">Nível de acesso</label>
            <Select.Root value={editor.campos.nivel_acesso} disabled={ocupado} onValueChange={v => setEditor({ ...editor, campos: { ...editor.campos, nivel_acesso: v } })}>
              <Select.Trigger id="usuario-nivel" style={{ width: '100%' }} />
              <Select.Content>
                {[['administrador', 'Administrador'], ['operador', 'Operador'], ['consulta', 'Consulta']].map(([v, t]) => <Select.Item key={v} value={v}>{t}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="usuario-status">Status</label>
            <Select.Root value={editor.campos.status} disabled={ocupado} onValueChange={v => setEditor({ ...editor, campos: { ...editor.campos, status: v } })}>
              <Select.Trigger id="usuario-status" style={{ width: '100%' }} />
              <Select.Content>
                {[['ativo', 'Ativo'], ['pendente', 'Pendente'], ['bloqueado', 'Bloqueado'], ['revogado', 'Revogado']].map(([v, t]) => <Select.Item key={v} value={v}>{t}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <Text as="p" size="2" color="gray">Administrador gerencia o sistema; operador altera dados; consulta permite leitura. Revogar encerra o acesso permanentemente.</Text>
          {editor.login && (() => { const u = usuarios.find(u => u.login === editor.login); return u && <dl><dt>ID</dt><dd>{u.usuario_id}</dd><dt>Atualizado em</dt><dd>{data(u.atualizado_em)}</dd><dt>E-mail verificado em</dt><dd>{data(u.email_verificado_em)}</dd><dt>Criado por</dt><dd>{u.criado_por || 'Não registrado'}</dd><dt>Revogado em</dt><dd>{data(u.revogado_em)}</dd><dt>Revogado por</dt><dd>{u.revogado_por || 'Não registrado'}</dd></dl> })()}
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" disabled={ocupado} onClick={() => { setEditor(null); setErro('') }}>Cancelar</Button>
            <Button disabled={ocupado || !editor.campos.nome_completo.trim() || (editor.login === null && (!editor.campos.email || !editor.campos.login))} onClick={() => void executar(salvar)}>
              {ocupado ? 'Salvando…' : 'Salvar cadastro'}
            </Button>
          </Flex>
        </div>}
      </Dialog.Content>
    </Dialog.Root>

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
