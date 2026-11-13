import CampoData from '../../CampoData'
import Carregamento from '../../Carregamento'
import { useEffect, useState } from 'react'
import { AlertDialog, Button, Callout, Flex, RadioGroup, Select, Tabs, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Building2, Check } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { erroCpfCnpj, erroEmail, erroTelefone, mascaraCep, mascaraCpfCnpj, mascaraTelefone } from '../../utils/mascaras'
import PastaDrive from '../../PastaDrive'
import { formatarNomeExibicao } from '../../utils/formatadores'
import { useAvisos } from '../../Avisos'
import { useAlteracoesPendentes } from '../../AlteracoesPendentes'
import CampoRepetivel from './CampoRepetivel'
import EnderecosRepetivel, { type Endereco } from './EnderecosRepetivel'

type Telefone = { tipo: string; telefone: string; operadora: string }
type Email = { tipo: string; email: string }
type Site = { site: string }

type ClienteRegistro = {
  id?: string
  nome?: string
  cpf_cnpj?: string
  observacoes?: string
  drive_pasta_id?: string | null
  nome_fantasia?: string | null
  tipo_pessoa?: string
  perfil?: string
  telefones?: Telefone[]
  emails?: Email[]
  sites?: Site[]
  enderecos?: Endereco[]
  telefone?: string
  email?: string
  site?: string
  endereco_rua?: string
  endereco_numero?: string
  endereco_bairro?: string
  endereco_complemento?: string
  endereco_cidade?: string
  endereco_estado?: string
  endereco_pais?: string
  rg_numero?: string
  rg_emissao?: string
  rg_emissor?: string
  ctps_numero?: string
  ctps_serie?: string
  ctps_emissao?: string
  ctps_uf?: string
  pis?: string
  estado_civil?: string
  nacionalidade?: string
  profissao?: string
}

type DadosCnpj = {
  razao_social: string; nome_fantasia: string; situacao: string; data_situacao: string; abertura: string; atividade: string
  telefones: string[]; email: string
  endereco: { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string }
}
// Dados da Receita vêm em maiúsculas: "RUA JOAQUIM FLORIANO" vira "Rua Joaquim Floriano". Preposições
// ficam minúsculas, siglas societárias maiúsculas e numerais romanos de endereço (Torre II) preservados.
const primeiraMaiuscula = (texto: string) =>
  formatarNomeExibicao(texto).replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (m) => m.toUpperCase())
const dataBr = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

const CAMPOS_EXTRA: Array<keyof ClienteRegistro> = [
  'rg_numero', 'rg_emissao', 'rg_emissor', 'ctps_numero', 'ctps_serie', 'ctps_emissao', 'ctps_uf',
  'pis', 'estado_civil', 'nacionalidade', 'profissao', 'nome_fantasia',
]

const vazio = (): ClienteRegistro => ({
  nome: '', cpf_cnpj: '', observacoes: '', tipo_pessoa: 'fisica', perfil: 'cliente',
  telefones: [], emails: [], sites: [], enderecos: [],
  rg_numero: '', rg_emissao: '', rg_emissor: '', ctps_numero: '', ctps_serie: '', ctps_emissao: '', ctps_uf: '',
  pis: '', estado_civil: '', nacionalidade: '', profissao: '',
})

export default function CadastroContato({
  clienteId,
  onSalvo,
  onExcluido,
  onCarregado,
  onAbrirExistente,
}: {
  clienteId: string | null
  onSalvo: (cliente: ClienteRegistro) => void
  onExcluido: () => void
  onCarregado?: (cliente: ClienteRegistro) => void
  /** Abre outro cadastro (quando o CPF/CNPJ informado já pertence a ele). */
  onAbrirExistente?: (id: string) => void
}) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const [aba, setAba] = useState('pessoais')
  const [erroDocumento, setErroDocumento] = useState('')
  const [existente, setExistente] = useState<{ id: string; nome: string } | null>(null)
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [dadosCnpj, setDadosCnpj] = useState<DadosCnpj | null>(null)
  const [erroCnpj, setErroCnpj] = useState('')
  const [registro, setRegistro] = useState<ClienteRegistro>(vazio())
  // Cópia do que está salvo, para saber se há alterações pendentes.
  const [original, setOriginal] = useState<string>(() => JSON.stringify(vazio()))
  const [carregando, setCarregando] = useState(!!clienteId)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null)
  const [paraExcluir, setParaExcluir] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  const criando = !clienteId

  useEffect(() => {
    if (!clienteId) {
      setRegistro(vazio())
      setOriginal(JSON.stringify(vazio()))
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErroCarregar(null)
    buscarJson<ClienteRegistro>(cliente, `/clientes/${clienteId}`)
      .then((dados) => {
        const carregado: ClienteRegistro = {
          ...vazio(),
          ...dados,
          telefones: dados.telefones?.length ? dados.telefones : dados.telefone ? [{ tipo: '', telefone: dados.telefone, operadora: '' }] : [],
          emails: dados.emails?.length ? dados.emails : dados.email ? [{ tipo: '', email: dados.email }] : [],
          sites: dados.sites?.length ? dados.sites : dados.site ? [{ site: dados.site }] : [],
          enderecos: dados.enderecos?.length
            ? dados.enderecos
            : dados.endereco_rua
              ? [{
                  tipo: '', cep: '',
                  rua: dados.endereco_rua ?? '',
                  numero: dados.endereco_numero ?? '',
                  bairro: dados.endereco_bairro ?? '',
                  complemento: dados.endereco_complemento ?? '',
                  cidade: dados.endereco_cidade ?? '',
                  estado: dados.endereco_estado ?? '',
                  pais: dados.endereco_pais ?? 'Brasil',
                }]
              : [],
        }
        setRegistro(carregado)
        setOriginal(JSON.stringify(carregado))
        onCarregado?.(dados)
      })
      .catch((e) => setErroCarregar(e instanceof ErroMCP ? e.message : 'Falha ao carregar cliente.'))
      .finally(() => setCarregando(false))
  }, [cliente, clienteId])

  function atualizar<K extends keyof ClienteRegistro>(chave: K, valor: ClienteRegistro[K]) {
    setRegistro((r) => ({ ...r, [chave]: valor }))
  }

  /** Consulta o CNPJ na Receita Federal (BrasilAPI) e preenche o que ainda estiver vazio. */
  async function consultarCnpj(documento: string) {
    const digitos = documento.replace(/\D/g, '')
    if (digitos.length !== 14 || erroCpfCnpj(documento)) return
    setConsultandoCnpj(true); setErroCnpj(''); setDadosCnpj(null)
    try {
      const d = await buscarJson<DadosCnpj>(cliente, `/clientes/consulta-cnpj/${digitos}`)
      setDadosCnpj(d)
      setRegistro((r) => ({
        ...r,
        nome: r.nome?.trim() ? r.nome : primeiraMaiuscula(d.razao_social),
        nome_fantasia: r.nome_fantasia?.trim() ? r.nome_fantasia : primeiraMaiuscula(d.nome_fantasia),
        telefones: r.telefones?.length ? r.telefones : d.telefones.map(t => ({ tipo: '', telefone: mascaraTelefone(t), operadora: '' })),
        emails: r.emails?.length ? r.emails : d.email ? [{ tipo: '', email: d.email }] : [],
        enderecos: r.enderecos?.length || !d.endereco.rua ? r.enderecos : [{
          tipo: '', cep: mascaraCep(d.endereco.cep), rua: primeiraMaiuscula(d.endereco.rua),
          numero: /^s\/?n$/i.test(d.endereco.numero) ? 'S/N' : d.endereco.numero, bairro: primeiraMaiuscula(d.endereco.bairro),
          complemento: primeiraMaiuscula(d.endereco.complemento), cidade: primeiraMaiuscula(d.endereco.cidade),
          estado: d.endereco.estado.toUpperCase(), pais: 'Brasil',
        }],
      }))
      avisar({ texto: 'Dados preenchidos pela Receita Federal. Confira antes de salvar.' })
    } catch (e) {
      setErroCnpj(e instanceof ErroMCP ? e.message : 'Não foi possível consultar o CNPJ agora. Preencha os dados manualmente.')
    } finally { setConsultandoCnpj(false) }
  }

  useAlteracoesPendentes(!carregando && JSON.stringify(registro) !== original)
  const rotulo = registro.perfil === 'contato' ? 'contato' : 'cliente'
  const juridica = registro.tipo_pessoa === 'juridica'

  async function salvar() {
    if (!(registro.nome ?? '').trim()) {
      setAba('pessoais')
      setMensagem({ tipo: 'erro', texto: 'Informe o nome antes de salvar.' })
      setTimeout(() => document.getElementById('contato-nome')?.focus(), 0)
      return
    }
    const problemaContato = (registro.telefones ?? []).map(t => erroTelefone(t.telefone)).find(Boolean)
      || (registro.emails ?? []).map(e => erroEmail(e.email)).find(Boolean)
    if (problemaContato) {
      setAba('pessoais')
      setMensagem({ tipo: 'erro', texto: `Confira os contatos: ${problemaContato}` })
      return
    }
    const problemaDocumento = erroCpfCnpj(registro.cpf_cnpj ?? '')
    if (problemaDocumento) {
      setAba('documentacao')
      setErroDocumento(problemaDocumento)
      setMensagem({ tipo: 'erro', texto: problemaDocumento })
      setTimeout(() => document.getElementById('contato-cpf-cnpj')?.focus(), 0)
      return
    }
    setSalvando(true)
    setMensagem(null)
    setExistente(null)
    const corpo = {
      nome: (registro.nome ?? '').trim(),
      cpf_cnpj: (registro.cpf_cnpj ?? '').trim(),
      observacoes: (registro.observacoes ?? '').trim(),
      tipo_pessoa: registro.tipo_pessoa,
      perfil: registro.perfil,
      telefones: (registro.telefones ?? []).filter((t) => t.telefone.trim()),
      emails: (registro.emails ?? []).filter((e) => e.email.trim()),
      sites: (registro.sites ?? []).filter((s) => s.site.trim()),
      enderecos: (registro.enderecos ?? []).filter((e) => e.rua.trim() || e.cep.trim()),
      ...Object.fromEntries(CAMPOS_EXTRA.map((campo) => [campo, (registro[campo] as string | undefined)?.trim() ?? ''])),
    }
    try {
      const salvo = criando
        ? await enviarJson<ClienteRegistro>(cliente, '/clientes', corpo)
        : await enviarJson<ClienteRegistro>(cliente, `/clientes/${clienteId}`, corpo, 'PATCH')
      // Aviso flutuante: continua visível mesmo com a tela trocando para o cadastro recém-criado.
      setOriginal(JSON.stringify(registro))
      avisar({ texto: criando ? `${rotulo === 'contato' ? 'Contato cadastrado' : 'Cliente cadastrado'}: ${corpo.nome}.` : 'Alterações salvas.' })
      onSalvo(salvo)
    } catch (e) {
      const texto = e instanceof ErroMCP ? e.message : 'Não foi possível salvar. Tente de novo.'
      if (e instanceof ErroMCP && e.status === 409) {
        // Mesmo CPF/CNPJ já cadastrado: mostra o cadastro existente para abrir.
        setAba('documentacao')
        setErroDocumento(texto)
        setExistente(e.dados?.cliente_existente ?? null)
      }
      avisar({ tipo: 'erro', texto })
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarExclusao() {
    if (!clienteId) return
    setExcluindo(true)
    try {
      await enviarJson(cliente, `/clientes/${clienteId}`, {}, 'DELETE')
      onExcluido()
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível excluir. Tente de novo.' })
      setParaExcluir(false)
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <Carregamento tipo="detalhe" />
  if (erroCarregar) return (
    <Callout.Root color="red" size="1">
      <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
      <Callout.Text>Erro ao carregar cliente: {erroCarregar}</Callout.Text>
    </Callout.Root>
  )

  return (
    <Flex direction="column" gap="6">
      <Text size="1" color="gray"><span className="aj-obrigatorio" aria-hidden="true">*</span> Campo obrigatório. Os demais podem ser preenchidos depois.</Text>
      <Tabs.Root value={aba} onValueChange={setAba}>
        <Tabs.List aria-label="Seções do cadastro">
          <Tabs.Trigger value="pessoais">Informações pessoais</Tabs.Trigger>
          <Tabs.Trigger value="documentacao">Documentação</Tabs.Trigger>
          <Tabs.Trigger value="complementares">Informações complementares</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="pessoais">
          <Flex direction="column" gap="4" mt="4">
            <div className="casos-formulario-grade">
              <div className="form-campo">
                <span className="form-campo-label" id="contato-tipo-pessoa-rotulo">Pessoa física ou jurídica</span>
                <RadioGroup.Root aria-labelledby="contato-tipo-pessoa-rotulo" value={registro.tipo_pessoa} onValueChange={(v) => atualizar('tipo_pessoa', v)}>
                  <Flex gap="4" wrap="wrap">
                    <Text as="label" size="2"><Flex gap="2" align="center"><RadioGroup.Item value="fisica" />Pessoa física</Flex></Text>
                    <Text as="label" size="2"><Flex gap="2" align="center"><RadioGroup.Item value="juridica" />Pessoa jurídica</Flex></Text>
                  </Flex>
                </RadioGroup.Root>
              </div>
              <div className="form-campo">
                <span className="form-campo-label" id="contato-perfil-rotulo">Perfil</span>
                <RadioGroup.Root aria-labelledby="contato-perfil-rotulo" value={registro.perfil} onValueChange={(v) => atualizar('perfil', v)}>
                  <Flex gap="4" wrap="wrap">
                    <Text as="label" size="2"><Flex gap="2" align="center"><RadioGroup.Item value="contato" />Contato</Flex></Text>
                    <Text as="label" size="2"><Flex gap="2" align="center"><RadioGroup.Item value="cliente" />Cliente</Flex></Text>
                  </Flex>
                </RadioGroup.Root>
              </div>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-nome">Nome <span className="aj-obrigatorio" aria-hidden="true">*</span></label>
              <TextField.Root
                id="contato-nome"
                placeholder="Ex.: Maria Aparecida Souza"
                autoComplete="name"
                required
                aria-required="true"
                value={registro.nome}
                onChange={(e) => atualizar('nome', e.target.value)}
              />
            </div>
            {juridica && (
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contato-nome-fantasia">Nome fantasia</label>
                <TextField.Root
                  id="contato-nome-fantasia"
                  placeholder="Ex.: Padaria Pão Quente"
                  autoComplete="organization"
                  maxLength={200}
                  value={registro.nome_fantasia ?? ''}
                  onChange={(e) => atualizar('nome_fantasia', e.target.value)}
                />
              </div>
            )}
            <CampoRepetivel
              titulo="Telefone"
              itens={registro.telefones ?? []}
              campos={[
                { chave: 'tipo', tipo: 'select', rotulo: 'Tipo', opcoes: [
                  { valor: '', rotulo: 'Tipo' }, { valor: 'celular', rotulo: 'Celular' }, { valor: 'residencial', rotulo: 'Residencial' },
                  { valor: 'comercial', rotulo: 'Comercial' }, { valor: 'whatsapp', rotulo: 'WhatsApp' }, { valor: 'outro', rotulo: 'Outro' },
                ] },
                { chave: 'telefone', tipo: 'texto', rotulo: 'Telefone', tipoInput: 'tel', placeholder: '(11) 99999-0000', mascara: mascaraTelefone, validar: erroTelefone },
                { chave: 'operadora', tipo: 'texto', rotulo: 'Operadora' },
              ]}
              onAdicionar={() => atualizar('telefones', [...(registro.telefones ?? []), { tipo: '', telefone: '', operadora: '' }])}
              onRemover={(i) => atualizar('telefones', (registro.telefones ?? []).filter((_, idx) => idx !== i))}
              onAlterar={(i, chave, valor) =>
                atualizar('telefones', (registro.telefones ?? []).map((t, idx) => (idx === i ? { ...t, [chave]: valor } : t)))
              }
            />
            <CampoRepetivel
              titulo="E-mail"
              itens={registro.emails ?? []}
              campos={[
                { chave: 'tipo', tipo: 'select', rotulo: 'Tipo', opcoes: [
                  { valor: '', rotulo: 'Tipo' }, { valor: 'pessoal', rotulo: 'Pessoal' }, { valor: 'comercial', rotulo: 'Comercial' }, { valor: 'outro', rotulo: 'Outro' },
                ] },
                { chave: 'email', tipo: 'texto', rotulo: 'E-mail', tipoInput: 'email', placeholder: 'nome@exemplo.com.br', validar: erroEmail },
              ]}
              onAdicionar={() => atualizar('emails', [...(registro.emails ?? []), { tipo: '', email: '' }])}
              onRemover={(i) => atualizar('emails', (registro.emails ?? []).filter((_, idx) => idx !== i))}
              onAlterar={(i, chave, valor) =>
                atualizar('emails', (registro.emails ?? []).map((e, idx) => (idx === i ? { ...e, [chave]: valor } : e)))
              }
            />
            <CampoRepetivel
              titulo="Site"
              itens={registro.sites ?? []}
              campos={[{ chave: 'site', tipo: 'texto', rotulo: 'Site', tipoInput: 'url' }]}
              onAdicionar={() => atualizar('sites', [...(registro.sites ?? []), { site: '' }])}
              onRemover={(i) => atualizar('sites', (registro.sites ?? []).filter((_, idx) => idx !== i))}
              onAlterar={(i, chave, valor) =>
                atualizar('sites', (registro.sites ?? []).map((s, idx) => (idx === i ? { ...s, [chave]: valor } : s)))
              }
            />
            <EnderecosRepetivel
              itens={registro.enderecos ?? []}
              onAdicionar={() =>
                atualizar('enderecos', [
                  ...(registro.enderecos ?? []),
                  { tipo: '', cep: '', rua: '', numero: '', bairro: '', complemento: '', cidade: '', estado: '', pais: 'Brasil' },
                ])
              }
              onRemover={(i) => atualizar('enderecos', (registro.enderecos ?? []).filter((_, idx) => idx !== i))}
              onAlterar={(i, alteracoes) =>
                atualizar('enderecos', (registro.enderecos ?? []).map((end, idx) => (idx === i ? { ...end, ...alteracoes } : end)))
              }
            />
          </Flex>
        </Tabs.Content>
        <Tabs.Content value="documentacao">
          <div className="casos-formulario-grade" style={{ marginTop: 'var(--space-4)' }}>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-cpf-cnpj">{juridica ? 'CNPJ' : 'CPF'}</label>
              <TextField.Root
                id="contato-cpf-cnpj"
                placeholder={juridica ? 'Ex.: 12.345.678/0001-90' : 'Ex.: 123.456.789-00'}
                value={registro.cpf_cnpj}
                color={erroDocumento ? 'red' : undefined}
                aria-invalid={Boolean(erroDocumento)}
                aria-describedby={erroDocumento ? 'contato-cpf-cnpj-erro' : undefined}
                onChange={(e) => {
                  const mascarado = mascaraCpfCnpj(e.target.value)
                  atualizar('cpf_cnpj', mascarado); setErroDocumento(''); setExistente(null); setDadosCnpj(null); setErroCnpj('')
                  // Ao completar um CNPJ válido de pessoa jurídica, busca os dados sozinho.
                  if (juridica && mascarado.replace(/\D/g, '').length === 14) void consultarCnpj(mascarado)
                }}
                onBlur={() => setErroDocumento(erroCpfCnpj(registro.cpf_cnpj ?? ''))}
              />
              {juridica && consultandoCnpj && <Text size="1" color="gray" role="status">Consultando a Receita Federal…</Text>}
              {juridica && !consultandoCnpj && !dadosCnpj && !erroDocumento && erroCpfCnpj(registro.cpf_cnpj ?? '') === '' && (registro.cpf_cnpj ?? '').replace(/\D/g, '').length === 14 && (
                <Button type="button" size="1" variant="soft" onClick={() => void consultarCnpj(registro.cpf_cnpj ?? '')}><Building2 size={13} aria-hidden="true" />Buscar dados na Receita</Button>
              )}
              {erroCnpj && <Text size="1" color="red" role="alert">{erroCnpj}</Text>}
              {erroDocumento && (
                <Text id="contato-cpf-cnpj-erro" size="1" color="red">
                  {erroDocumento}{' '}
                  {existente && onAbrirExistente && (
                    <button type="button" className="aj-link-ajuda" onClick={() => onAbrirExistente(existente.id)}>Abrir esse cadastro</button>
                  )}
                </Text>
              )}
            </div>
            {!juridica && <>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-rg-numero">RG — Número</label>
              <TextField.Root id="contato-rg-numero" value={registro.rg_numero} onChange={(e) => atualizar('rg_numero', e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-rg-emissao">RG — Emissão</label>
              <CampoData id="contato-rg-emissao" value={registro.rg_emissao} onChange={v => atualizar('rg_emissao', v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-rg-emissor">RG — Órgão emissor</label>
              <TextField.Root id="contato-rg-emissor" placeholder="Ex.: SSP/SP" value={registro.rg_emissor} onChange={(e) => atualizar('rg_emissor', e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-ctps-numero">CTPS — Número</label>
              <TextField.Root id="contato-ctps-numero" value={registro.ctps_numero} onChange={(e) => atualizar('ctps_numero', e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-ctps-serie">CTPS — Série</label>
              <TextField.Root id="contato-ctps-serie" value={registro.ctps_serie} onChange={(e) => atualizar('ctps_serie', e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-ctps-emissao">CTPS — Emissão</label>
              <CampoData id="contato-ctps-emissao" value={registro.ctps_emissao} onChange={v => atualizar('ctps_emissao', v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-ctps-uf">CTPS — UF</label>
              <TextField.Root id="contato-ctps-uf" maxLength={2} value={registro.ctps_uf} onChange={(e) => atualizar('ctps_uf', e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-pis">PIS</label>
              <TextField.Root id="contato-pis" value={registro.pis} onChange={(e) => atualizar('pis', e.target.value)} />
            </div>
            </>}
          </div>
          {juridica && dadosCnpj && (
            <Callout.Root color={dadosCnpj.situacao && dadosCnpj.situacao !== 'ATIVA' ? 'amber' : 'green'} size="1" role="status" style={{ marginTop: 'var(--space-4)' }}>
              <Callout.Icon><Building2 size={14} /></Callout.Icon>
              <Callout.Text>
                <strong>{primeiraMaiuscula(dadosCnpj.razao_social)}</strong>
                {dadosCnpj.nome_fantasia ? ` (${primeiraMaiuscula(dadosCnpj.nome_fantasia)})` : ''}
                {' — '}situação na Receita: <strong>{dadosCnpj.situacao || 'não informada'}</strong>
                {dadosCnpj.data_situacao ? ` desde ${dataBr(dadosCnpj.data_situacao)}` : ''}.
                {dadosCnpj.atividade ? ` Atividade: ${dadosCnpj.atividade}.` : ''}
                {dadosCnpj.abertura ? ` Aberta em ${dataBr(dadosCnpj.abertura)}.` : ''}
                {' '}Nome, nome fantasia, telefones, e-mail e endereço vazios foram preenchidos; o que você já tinha digitado não foi alterado.
              </Callout.Text>
            </Callout.Root>
          )}
        </Tabs.Content>
        <Tabs.Content value="complementares">
          <Flex direction="column" gap="4" mt="4">
            {!juridica && <div className="casos-formulario-grade">
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contato-estado-civil">Estado civil</label>
                <Select.Root value={registro.estado_civil || '__none__'} onValueChange={(v) => atualizar('estado_civil', v === '__none__' ? '' : v)}>
                  <Select.Trigger id="contato-estado-civil" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="__none__">— Selecione —</Select.Item>
                    <Select.Item value="solteiro">Solteiro(a)</Select.Item>
                    <Select.Item value="casado">Casado(a)</Select.Item>
                    <Select.Item value="uniao_estavel">União estável</Select.Item>
                    <Select.Item value="divorciado">Divorciado(a)</Select.Item>
                    <Select.Item value="separado">Separado(a) judicialmente</Select.Item>
                    <Select.Item value="viuvo">Viúvo(a)</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contato-nacionalidade">Nacionalidade</label>
                <TextField.Root id="contato-nacionalidade" placeholder="Ex.: Brasileira" value={registro.nacionalidade} onChange={(e) => atualizar('nacionalidade', e.target.value)} />
              </div>
              <div className="form-campo">
                <label className="form-campo-label" htmlFor="contato-profissao">Profissão</label>
                <TextField.Root id="contato-profissao" placeholder="Ex.: Engenheira civil" value={registro.profissao} onChange={(e) => atualizar('profissao', e.target.value)} />
              </div>
            </div>}
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="contato-observacoes">Observações</label>
              <TextField.Root id="contato-observacoes" placeholder="Ex.: indicação de cliente antigo" value={registro.observacoes} onChange={(e) => atualizar('observacoes', e.target.value)} />
            </div>
            {clienteId && <PastaDrive tipo="clientes" id={clienteId} pastaId={registro.drive_pasta_id} onCriada={(pastaId) => {
              // A pasta é criada à parte: não conta como alteração pendente do cadastro.
              setRegistro(r => ({ ...r, drive_pasta_id: pastaId }))
              setOriginal(o => JSON.stringify({ ...JSON.parse(o), drive_pasta_id: pastaId }))
            }} />}
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
      <div className="aj-layout-28">
        <Button onClick={salvar} loading={salvando}>
          {salvando ? 'Salvando…' : criando ? `Cadastrar ${rotulo}` : 'Salvar alterações'}
        </Button>
        {!criando && (
          <Button variant="outline" color="red" onClick={() => setParaExcluir(true)}>
            Excluir {rotulo}
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {mensagem && (
          <Callout.Root color={mensagem.tipo === 'erro' ? 'red' : 'green'} size="1">
            <Callout.Icon>{mensagem.tipo === 'erro' ? <AlertTriangle size={14} /> : <Check size={14} />}</Callout.Icon>
            <Callout.Text>{mensagem.texto}</Callout.Text>
          </Callout.Root>
        )}
      </div>
      <AlertDialog.Root open={paraExcluir} onOpenChange={(open) => !open && setParaExcluir(false)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>Excluir {rotulo}</AlertDialog.Title>
          <AlertDialog.Description>
            Excluir o cadastro de "{registro.nome || `este ${rotulo}`}"? Essa ação não pode ser desfeita.
          </AlertDialog.Description>
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
    </Flex>
  )
}
