import TabelaResponsiva from '../TabelaResponsiva'
import { useState } from 'react'
import { Button, TextInput, Select, SelectItem, InlineNotification, Tabs, TabList, Tab, TabPanels, TabPanel, Modal } from '@carbon/react'
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
  const [mensagem, setMensagem] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [editor, setEditor] = useState<{ login: string | null; campos: typeof VAZIO } | null>(null)
  const [tokenNovo, setTokenNovo] = useState('')
  const [confirmarBackup, setConfirmarBackup] = useState(false)

  async function requisicao(url: string, token: string, metodo = 'GET', corpo?: unknown) {
    const r = await fetch(url, { method: metodo, cache: 'no-store', headers: {
      Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.mensagem || e.erro || `Falha na operação (HTTP ${r.status}).`)
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
    setEditor(null); setTokenNovo(''); setErro(''); setMensagem(''); setConfirmarBackup(false)
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
    <h1>Administração</h1>
    <p>Gerencie os usuários e acompanhe o banco de dados do sistema.</p>
    {erro && <InlineNotification kind="error" title="Não foi possível concluir" subtitle={erro} onCloseButtonClick={() => setErro('')} />}
    {mensagem && <InlineNotification kind="success" title={mensagem} onCloseButtonClick={() => setMensagem('')} />}
    {!sessao ? <form className="administracao__acesso" onSubmit={e => { e.preventDefault(); void executar(() => carregar(credencial || cliente?.token || '')) }}>
      <h2>Acesso administrativo</h2>
      <p>Use sua conexão de administrador ou informe o token administrativo do servidor.</p>
      <TextInput id="admin-token" labelText="Token administrativo" type="password" autoComplete="off" value={credencial} onChange={e => setCredencial(e.target.value)} helperText="Mantido somente na memória enquanto este painel estiver aberto." />
      <Button type="submit" disabled={ocupado || !(credencial || cliente?.token)}>{ocupado ? 'Verificando…' : 'Acessar administração'}</Button>
    </form> : <>
      <div className="administracao__acoes"><Button kind="tertiary" disabled={ocupado} onClick={() => void executar(() => carregar(sessao))}>Atualizar usuários</Button><Button kind="ghost" disabled={ocupado} onClick={sair}>Encerrar administração</Button></div>
      <Tabs>
        <TabList aria-label="Administração">
          <Tab>Usuários</Tab>
          <Tab>Banco de dados</Tab>
          <Tab>Histórico administrativo</Tab>
        </TabList>
        <TabPanels>
        <TabPanel>
          <dl className="administracao__resumo"><div><dt>Usuários cadastrados</dt><dd>{usuarios.length}</dd></div><div><dt>Ativos</dt><dd>{usuarios.filter(u => u.status === 'ativo').length}</dd></div><div><dt>Bloqueados ou revogados</dt><dd>{usuarios.filter(u => ['bloqueado', 'revogado'].includes(u.status)).length}</dd></div></dl>
          <div className="administracao__acoes"><TextInput id="admin-filtro" labelText="Filtrar usuários" value={filtro} onChange={e => setFiltro(e.target.value)} /><Button disabled={ocupado} onClick={() => { setErro(''); setEditor({ login: null, campos: { ...VAZIO } }) }}>Criar usuário</Button></div>
          <div className="administracao__tabela" role="region" aria-label="Usuários cadastrados" tabIndex={0}><TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table className="cds--data-table"><caption>Usuários do sistema — {lista.length} resultado(s)</caption><thead><tr>{['Nome e login', 'E-mail', 'Nível de acesso', 'Status', 'Cadastro', 'Último acesso', 'Ações'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>
            {lista.map(u => <tr key={u.usuario_id}><td>{u.nome_completo}<small>{u.login}</small></td><td>{u.email || 'Não informado'}</td><td>{u.nivel_acesso}</td><td>{u.status}</td><td>{data(u.criado_em)}</td><td>{data(u.ultimo_acesso_em)}</td><td><Button size="sm" kind="ghost" disabled={ocupado} onClick={() => { setErro(''); setEditor({ login: u.login, campos: { login: u.login, nome_completo: u.nome_completo, email: u.email || '', nivel_acesso: u.nivel_acesso, status: u.status } }) }}>Editar<span className="cds--visually-hidden"> {u.nome_completo}</span></Button></td></tr>)}
            {!lista.length && <tr><td colSpan={7}>Nenhum usuário encontrado.</td></tr>}
          </tbody></table></TabelaResponsiva></div>
        </TabPanel>
        <TabPanel><h2>Banco de dados</h2><p>Consulte o estado do SQLite e gere uma cópia consistente dos dados.</p>
          <div className="administracao__acoes"><Button disabled={ocupado} onClick={() => void executar(async () => { setBanco(await (await requisicao('/admin/banco/api', sessao)).json()) })}>Carregar informações</Button><Button kind="tertiary" disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/banco/integridade', sessao, 'POST')).json(); if (!r.integro) throw new Error('A verificação identificou inconsistências no banco.'); setMensagem(`Integridade verificada em ${data(r.verificado_em)}.`) })}>Verificar integridade</Button><Button kind="tertiary" disabled={ocupado} onClick={() => setConfirmarBackup(true)}>Baixar backup</Button></div>
          {banco && <dl className="administracao__resumo"><div><dt>Banco</dt><dd>{banco.tipo}</dd></div><div><dt>Tamanho</dt><dd>{(banco.tamanho_bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB</dd></div><div><dt>Tabelas</dt><dd>{banco.tabelas}</dd></div></dl>}
        </TabPanel>
        <TabPanel><h2>Histórico administrativo</h2><p>Até 100 alterações de cadastro, com data e responsável.</p><Button disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/usuarios/historico', sessao)).json(); setHistorico(r.historico) })}>Carregar histórico</Button><div className="administracao__tabela" role="region" aria-label="Histórico administrativo" tabIndex={0}><TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table className="cds--data-table"><thead><tr>{['Data', 'Responsável', 'Usuário', 'Ação', 'Campos alterados'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{historico.map((h, i) => <tr key={i}><td>{data(h.ocorrido_em)}</td><td>{h.ator}</td><td>{h.usuario}</td><td>{h.acao}</td><td>{JSON.parse(h.campos).join(', ')}</td></tr>)}{!historico.length && <tr><td colSpan={5}>Carregue o histórico para consultar os registros disponíveis.</td></tr>}</tbody></table></TabelaResponsiva></div></TabPanel>
        </TabPanels>
      </Tabs>
      <section aria-label="Histórico de acessos">
        <h2>Histórico de acessos</h2>
        <p>Últimos 100 registros de atividade autenticada. Até um registro por usuário por minuto, com retenção de 180 dias.</p>
        <Button disabled={ocupado} onClick={() => void executar(async () => { const r = await (await requisicao('/admin/usuarios/acessos', sessao)).json(); setAcessos(r.acessos) })}>Carregar acessos</Button>
        <div className="administracao__tabela" role="region" aria-label="Acessos registrados" tabIndex={0}>
          <TabelaResponsiva principais={['Nome e login', 'Status', 'Data', 'Usuário']}><table className="cds--data-table"><thead><tr><th scope="col">Data e hora</th><th scope="col">Usuário</th></tr></thead>
            <tbody>{acessos.map((a, i) => <tr key={i}><td>{data(a.ocorrido_em)}</td><td>{a.usuario}</td></tr>)}{!acessos.length && <tr><td colSpan={2}>Carregue os acessos para consultar os registros disponíveis.</td></tr>}</tbody>
          </table></TabelaResponsiva>
        </div>
      </section>
    </>}
    <Modal open={editor !== null} modalHeading={editor?.login === null ? 'Criar usuário' : 'Editar usuário'} primaryButtonText={ocupado ? 'Salvando…' : 'Salvar cadastro'} secondaryButtonText="Cancelar" primaryButtonDisabled={ocupado || !editor?.campos.nome_completo.trim() || (editor.login === null && (!editor.campos.email || !editor.campos.login))} onRequestClose={() => { if (!ocupado) { setEditor(null); setErro('') } }} onRequestSubmit={() => void executar(salvar)}>
      {editor && <div className="administracao__formulario">
        {erro && <InlineNotification kind="error" title="Revise o cadastro" subtitle={erro} hideCloseButton />}
        <TextInput id="usuario-login" labelText="Login" value={editor.campos.login} disabled={editor.login !== null || ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, login: e.target.value } })} />
        <TextInput id="usuario-nome" labelText="Nome completo" maxLength={200} value={editor.campos.nome_completo} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, nome_completo: e.target.value } })} />
        <TextInput id="usuario-email" type="email" labelText="E-mail" maxLength={254} value={editor.campos.email} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, email: e.target.value } })} />
        <Select id="usuario-nivel" labelText="Nível de acesso" value={editor.campos.nivel_acesso} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, nivel_acesso: e.target.value } })}>{[['administrador', 'Administrador'], ['operador', 'Operador'], ['consulta', 'Consulta']].map(([v, t]) => <SelectItem key={v} value={v} text={t} />)}</Select>
        <Select id="usuario-status" labelText="Status" value={editor.campos.status} disabled={ocupado} onChange={e => setEditor({ ...editor, campos: { ...editor.campos, status: e.target.value } })}>{[['ativo', 'Ativo'], ['pendente', 'Pendente'], ['bloqueado', 'Bloqueado'], ['revogado', 'Revogado']].map(([v, t]) => <SelectItem key={v} value={v} text={t} />)}</Select>
        <p>Administrador gerencia o sistema; operador altera dados; consulta permite leitura. Revogar encerra o acesso permanentemente.</p>
        {editor.login && (() => { const u = usuarios.find(u => u.login === editor.login); return u && <dl><dt>ID</dt><dd>{u.usuario_id}</dd><dt>Atualizado em</dt><dd>{data(u.atualizado_em)}</dd><dt>E-mail verificado em</dt><dd>{data(u.email_verificado_em)}</dd><dt>Criado por</dt><dd>{u.criado_por || 'Não registrado'}</dd><dt>Revogado em</dt><dd>{data(u.revogado_em)}</dd><dt>Revogado por</dt><dd>{u.revogado_por || 'Não registrado'}</dd></dl> })()}
      </div>}
    </Modal>
    <Modal open={!!tokenNovo} passiveModal modalHeading="Copie o token de acesso" onRequestClose={() => setTokenNovo('')}><p>O token será exibido somente agora. Entregue-o ao usuário por um canal seguro.</p><TextInput id="usuario-token-novo" labelText="Token gerado" value={tokenNovo} readOnly /></Modal>
    <Modal open={confirmarBackup} modalHeading="Baixar backup do banco" primaryButtonText="Baixar backup" secondaryButtonText="Cancelar" primaryButtonDisabled={ocupado} onRequestClose={() => { if (!ocupado) setConfirmarBackup(false) }} onRequestSubmit={() => void executar(async () => {
      if (!sessao) return
      const r = await requisicao('/admin/banco/backup', sessao, 'POST')
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'cnj-backup.db'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setConfirmarBackup(false); setMensagem('Backup gerado para download.')
    })}><p>O arquivo contém os dados do sistema, incluindo informações pessoais e credenciais cifradas ou hashes. Guarde-o em um local de acesso restrito.</p>{erro && <InlineNotification kind="error" title="Falha no backup" subtitle={erro} hideCloseButton />}</Modal>
  </section>
}
