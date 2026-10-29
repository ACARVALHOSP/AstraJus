import { useEffect, useState } from 'react'
import { Button, Column, Grid, InlineNotification, Modal, Select, SelectItem, Stack, Tab, TabList, TabPanel, TabPanels, Tabs, TextInput } from '@carbon/react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'
import { mascaraCpfCnpj } from '../../utils/mascaras'
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

const CAMPOS_EXTRA: Array<keyof ClienteRegistro> = [
  'rg_numero', 'rg_emissao', 'rg_emissor', 'ctps_numero', 'ctps_serie', 'ctps_emissao', 'ctps_uf',
  'pis', 'estado_civil', 'nacionalidade', 'profissao',
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
}: {
  clienteId: string | null
  onSalvo: (cliente: ClienteRegistro) => void
  onExcluido: () => void
  onCarregado?: (cliente: ClienteRegistro) => void
}) {
  const { cliente } = useCliente()
  const [registro, setRegistro] = useState<ClienteRegistro>(vazio())
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
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErroCarregar(null)
    buscarJson<ClienteRegistro>(cliente, `/clientes/${clienteId}`)
      .then((dados) => {
        setRegistro({
          ...vazio(),
          ...dados,
          telefones: dados.telefones?.length ? dados.telefones : dados.telefone ? [{ tipo: '', telefone: dados.telefone, operadora: '' }] : [],
          emails: dados.emails?.length ? dados.emails : dados.email ? [{ tipo: '', email: dados.email }] : [],
          sites: dados.sites?.length ? dados.sites : dados.site ? [{ site: dados.site }] : [],
          enderecos: dados.enderecos?.length
            ? dados.enderecos
            : dados.endereco_rua
              ? [
                  {
                    tipo: '',
                    cep: '',
                    rua: dados.endereco_rua ?? '',
                    numero: dados.endereco_numero ?? '',
                    bairro: dados.endereco_bairro ?? '',
                    complemento: dados.endereco_complemento ?? '',
                    cidade: dados.endereco_cidade ?? '',
                    estado: dados.endereco_estado ?? '',
                    pais: dados.endereco_pais ?? 'Brasil',
                  },
                ]
              : [],
        })
        onCarregado?.(dados)
      })
      .catch((e) => setErroCarregar(e instanceof ErroMCP ? e.message : 'Falha ao carregar cliente.'))
      .finally(() => setCarregando(false))
  }, [cliente, clienteId])

  function atualizar<K extends keyof ClienteRegistro>(chave: K, valor: ClienteRegistro[K]) {
    setRegistro((r) => ({ ...r, [chave]: valor }))
  }

  async function salvar() {
    setSalvando(true)
    setMensagem(null)
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
      setMensagem({ tipo: 'sucesso', texto: criando ? 'Cliente cadastrado' : 'Cliente atualizado' })
      onSalvo(salvo)
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao salvar.' })
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
      setMensagem({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Falha ao excluir.' })
      setParaExcluir(false)
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <p>Carregando…</p>
  if (erroCarregar) return <InlineNotification kind="error" title="Erro ao carregar cliente" subtitle={erroCarregar} lowContrast hideCloseButton />

  return (
    <Stack gap={6}>
      <Tabs>
        <TabList aria-label="Seções do cadastro">
          <Tab>Informações pessoais</Tab>
          <Tab>Documentação</Tab>
          <Tab>Informações complementares</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <Stack gap={5}>
              <Grid narrow fullWidth>
                <Column sm={4} md={4} lg={5}>
                  <Select id="contato-tipo-pessoa" labelText="Pessoa física ou jurídica" value={registro.tipo_pessoa} onChange={(e) => atualizar('tipo_pessoa', e.target.value)}>
                    <SelectItem value="fisica" text="Pessoa física" />
                    <SelectItem value="juridica" text="Pessoa jurídica" />
                  </Select>
                </Column>
                <Column sm={4} md={2} lg={3}>
                  <Select id="contato-perfil" labelText="Perfil" value={registro.perfil} onChange={(e) => atualizar('perfil', e.target.value)}>
                    <SelectItem value="contato" text="Contato" />
                    <SelectItem value="cliente" text="Cliente" />
                  </Select>
                </Column>
              </Grid>
              <TextInput
                id="contato-nome"
                labelText="Nome"
                placeholder="Ex.: Maria Aparecida Souza"
                autoComplete="name"
                required
                value={registro.nome}
                onChange={(e) => atualizar('nome', e.target.value)}
              />
              <CampoRepetivel
                titulo="Telefone"
                itens={registro.telefones ?? []}
                campos={[
                  { chave: 'tipo', tipo: 'select', rotulo: 'Tipo', opcoes: [
                    { valor: '', rotulo: 'Tipo' }, { valor: 'celular', rotulo: 'Celular' }, { valor: 'residencial', rotulo: 'Residencial' },
                    { valor: 'comercial', rotulo: 'Comercial' }, { valor: 'whatsapp', rotulo: 'WhatsApp' }, { valor: 'outro', rotulo: 'Outro' },
                  ] },
                  { chave: 'telefone', tipo: 'texto', rotulo: 'Telefone', tipoInput: 'tel' },
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
                  { chave: 'email', tipo: 'texto', rotulo: 'E-mail', tipoInput: 'email' },
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
            </Stack>
          </TabPanel>
          <TabPanel>
            <Grid narrow fullWidth>
              <Column sm={4} md={3} lg={5}>
                <TextInput
                  id="contato-cpf-cnpj"
                  labelText={registro.tipo_pessoa === 'juridica' ? 'CNPJ' : 'CPF'}
                  placeholder={registro.tipo_pessoa === 'juridica' ? 'Ex.: 12.345.678/0001-90' : 'Ex.: 123.456.789-00'}
                  value={registro.cpf_cnpj}
                  onChange={(e) => atualizar('cpf_cnpj', mascaraCpfCnpj(e.target.value))}
                />
              </Column>
              <Column sm={4} md={3} lg={4}>
                <TextInput id="contato-rg-numero" labelText="RG — Número" value={registro.rg_numero} onChange={(e) => atualizar('rg_numero', e.target.value)} />
              </Column>
              <Column sm={4} md={2} lg={3}>
                <TextInput id="contato-rg-emissao" type="date" labelText="RG — Emissão" value={registro.rg_emissao} onChange={(e) => atualizar('rg_emissao', e.target.value)} />
              </Column>
              <Column sm={4} md={4} lg={4}>
                <TextInput id="contato-rg-emissor" labelText="RG — Órgão emissor" placeholder="Ex.: SSP/SP" value={registro.rg_emissor} onChange={(e) => atualizar('rg_emissor', e.target.value)} />
              </Column>
              <Column sm={4} md={3} lg={4}>
                <TextInput id="contato-ctps-numero" labelText="CTPS — Número" value={registro.ctps_numero} onChange={(e) => atualizar('ctps_numero', e.target.value)} />
              </Column>
              <Column sm={4} md={2} lg={3}>
                <TextInput id="contato-ctps-serie" labelText="CTPS — Série" value={registro.ctps_serie} onChange={(e) => atualizar('ctps_serie', e.target.value)} />
              </Column>
              <Column sm={4} md={2} lg={3}>
                <TextInput id="contato-ctps-emissao" type="date" labelText="CTPS — Emissão" value={registro.ctps_emissao} onChange={(e) => atualizar('ctps_emissao', e.target.value)} />
              </Column>
              <Column sm={4} md={1} lg={2}>
                <TextInput id="contato-ctps-uf" labelText="CTPS — UF" maxLength={2} value={registro.ctps_uf} onChange={(e) => atualizar('ctps_uf', e.target.value)} />
              </Column>
              <Column sm={4} md={4} lg={4}>
                <TextInput id="contato-pis" labelText="PIS" value={registro.pis} onChange={(e) => atualizar('pis', e.target.value)} />
              </Column>
            </Grid>
          </TabPanel>
          <TabPanel>
            <Stack gap={5}>
              <Grid narrow fullWidth>
                <Column sm={4} md={4} lg={6}>
                  <Select id="contato-estado-civil" labelText="Estado civil" value={registro.estado_civil} onChange={(e) => atualizar('estado_civil', e.target.value)}>
                    <SelectItem value="" text="— Selecione —" />
                    <SelectItem value="solteiro" text="Solteiro(a)" />
                    <SelectItem value="casado" text="Casado(a)" />
                    <SelectItem value="uniao_estavel" text="União estável" />
                    <SelectItem value="divorciado" text="Divorciado(a)" />
                    <SelectItem value="separado" text="Separado(a) judicialmente" />
                    <SelectItem value="viuvo" text="Viúvo(a)" />
                  </Select>
                </Column>
                <Column sm={4} md={4} lg={5}>
                  <TextInput id="contato-nacionalidade" labelText="Nacionalidade" placeholder="Ex.: Brasileira" value={registro.nacionalidade} onChange={(e) => atualizar('nacionalidade', e.target.value)} />
                </Column>
                <Column sm={4} md={4} lg={5}>
                  <TextInput id="contato-profissao" labelText="Profissão" placeholder="Ex.: Engenheira civil" value={registro.profissao} onChange={(e) => atualizar('profissao', e.target.value)} />
                </Column>
              </Grid>
              <TextInput id="contato-observacoes" labelText="Observações" placeholder="Ex.: indicação de cliente antigo" value={registro.observacoes} onChange={(e) => atualizar('observacoes', e.target.value)} />
            </Stack>
          </TabPanel>
        </TabPanels>
      </Tabs>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button onClick={salvar} disabled={salvando}>
          {criando ? 'Cadastrar cliente' : 'Salvar alterações'}
        </Button>
        {!criando && (
          <Button kind="danger--tertiary" onClick={() => setParaExcluir(true)}>
            Excluir cliente
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {mensagem && (
          <InlineNotification
            kind={mensagem.tipo === 'erro' ? 'error' : 'success'}
            title={mensagem.tipo === 'erro' ? 'Erro' : 'Sucesso'}
            subtitle={mensagem.texto}
            lowContrast
            hideCloseButton
          />
        )}
      </div>
      <Modal
        open={paraExcluir}
        danger
        modalHeading="Excluir cliente"
        primaryButtonText="Excluir"
        secondaryButtonText="Cancelar"
        primaryButtonDisabled={excluindo}
        onRequestClose={() => setParaExcluir(false)}
        onRequestSubmit={confirmarExclusao}
      >
        <p>Excluir o cliente "{registro.nome || 'este cliente'}"? Essa ação não pode ser desfeita.</p>
      </Modal>
    </Stack>
  )
}
