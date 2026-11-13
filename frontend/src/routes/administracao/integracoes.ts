// Painel de integrações da Administração: nomes, campos de cada serviço e textos de estado.
// O servidor guarda as credenciais cifradas; aqui só se descreve o que mostrar e o que pedir.

export type ItemIntegracao = {
  provedor: string; ambiente: string; escopo: 'escritorio' | 'sistema'; versao: number
  estado: string; parametros: Record<string, string>; segredos: Record<string, string>; testado_em: number | null
}
export type EventoIntegracao = { instante: number; autor: string; provedor: string; ambiente: string; acao: string; resultado: string }
export type CampoIntegracao = { nome: string; rotulo: string; segredo?: boolean }

export const NOMES: Record<string, string> = {
  drive: 'Google Drive', asaas: 'Asaas', zapsign: 'ZapSign', datajud: 'DataJud', smtp: 'E-mail (SMTP)',
  recaptcha: 'reCAPTCHA', google_oauth: 'Google OAuth',
}
export const DESCRICOES: Record<string, string> = {
  drive: 'Pasta institucional do escritório no Google Drive.',
  asaas: 'Cobranças e boletos (Financeiro › Pagamentos).',
  zapsign: 'Assinatura digital de documentos.',
  datajud: 'Consulta de processos no DataJud (CNJ).',
  smtp: 'Servidor de e-mail dos avisos e do cadastro.',
  recaptcha: 'Proteção do cadastro público.',
  google_oauth: 'Aplicativo OAuth usado para conectar Google Drive e Agenda.',
}
export const CAMPOS: Record<string, CampoIntegracao[]> = {
  drive: [{ nome: 'pasta_raiz', rotulo: 'ID da pasta institucional' }],
  asaas: [{ nome: 'api_key', rotulo: 'Nova chave da API', segredo: true }],
  zapsign: [{ nome: 'api_key', rotulo: 'Nova chave da API', segredo: true }],
  datajud: [{ nome: 'api_key', rotulo: 'Nova chave da API', segredo: true }],
  smtp: [{ nome: 'host', rotulo: 'Servidor SMTP' }, { nome: 'porta', rotulo: 'Porta TLS (465 ou 587)' }, { nome: 'usuario', rotulo: 'Usuário' },
    { nome: 'senha', rotulo: 'Nova senha', segredo: true }, { nome: 'remetente', rotulo: 'E-mail remetente' }],
  recaptcha: [{ nome: 'site_key', rotulo: 'Site key' }, { nome: 'secret', rotulo: 'Nova secret key', segredo: true }],
  google_oauth: [{ nome: 'client_id', rotulo: 'Client ID' }, { nome: 'client_secret', rotulo: 'Novo client secret', segredo: true }],
}
/** Serviços cujo teste exige resolver um desafio no navegador: ficam no painel avançado. */
export const SO_NO_PAINEL_AVANCADO = new Set(['recaptcha'])
export const PRECISAM_GOOGLE = new Set(['drive', 'google_oauth'])

export const chaveItem = (i: { provedor: string; ambiente: string }) => `${i.provedor}:${i.ambiente}`
export const ehAsaas = (i: { provedor: string }) => i.provedor === 'asaas'
export const rotuloAmbiente = (ambiente: string) => ambiente === 'sandbox' ? 'Homologação' : ambiente === 'producao' ? 'Produção' : ''

export function tituloItem(i: { provedor: string; ambiente: string }) {
  return ehAsaas(i) ? `${NOMES.asaas} · ${rotuloAmbiente(i.ambiente)}` : (NOMES[i.provedor] ?? i.provedor)
}

/** Selo da lista: "Em uso" (Asaas), "Conta conectada" (Drive) ou "Configurado" / "Não configurado". */
export function seloItem(i: ItemIntegracao, ambienteAsaas: string, driveConectado: boolean): { texto: string; cor: 'green' | 'gray' | 'blue' } {
  if (i.provedor === 'drive' && driveConectado) return { texto: 'Conta conectada', cor: 'green' }
  if (i.estado !== 'ativo') return { texto: 'Não configurado', cor: 'gray' }
  if (ehAsaas(i) && i.ambiente === ambienteAsaas) return { texto: 'Em uso', cor: 'green' }
  return { texto: 'Configurado', cor: ehAsaas(i) ? 'blue' : 'green' }
}

export function estadoAtual(i: ItemIntegracao): string {
  if (i.estado !== 'ativo') return 'Não configurado.'
  const teste = i.testado_em ? `Testada em ${new Date(i.testado_em * 1000).toLocaleString('pt-BR')}` : 'Não testada'
  return `Configuração ativa · versão ${i.versao} · ${teste}`
}

export function textoAjuda(provedor: string, origem: string): string {
  switch (provedor) {
    case 'google_oauth': return `Cadastre no Google a URL de retorno ${origem}/integracoes/google/callback. Autorize a conta, teste e ative.`
    case 'smtp': return 'O teste valida TLS e autenticação sem enviar e-mails. Ao alterar o servidor ou o usuário, informe a senha de novo.'
    case 'recaptcha': return 'O teste exige resolver o desafio na tela. Use o painel avançado para configurar o reCAPTCHA.'
    default: return 'O teste verifica a conexão sem criar cobranças, documentos nem enviar e-mails.'
  }
}

export function agruparCatalogo(itens: ItemIntegracao[]) {
  return [
    { chave: 'escritorio', titulo: 'Escritório · institucional', itens: itens.filter(i => i.escopo === 'escritorio') },
    { chave: 'sistema', titulo: 'Sistema · configurações gerais', itens: itens.filter(i => i.escopo === 'sistema') },
  ].filter(g => g.itens.length)
}

export function linhaHistorico(e: EventoIntegracao, comServico = false): string {
  const quando = new Date(e.instante * 1000).toLocaleString('pt-BR')
  return [quando, e.autor, ...(comServico ? [tituloItem(e)] : []), e.acao, e.resultado].join(' · ')
}

/** Valores digitados → o que mudou em relação ao último teste (qualquer edição invalida o teste). */
export const mesmoConteudo = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b)
