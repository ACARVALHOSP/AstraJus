export type ParteCapa = { nome?: string; polo?: string; cliente_id?: string; cpf_cnpj?: string }
export type ClienteCapa = { id: string; nome?: string; cpf_cnpj?: string; perfil?: string }

const normalizar = (nome?: string) => (nome ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
const digitos = (valor?: string) => (valor ?? '').replace(/\D/g, '')

// O vínculo ao processo é obrigatório. Nomes ambíguos e documentos divergentes não geram tag.
export function clienteDaParte(parte: ParteCapa, registros: ClienteCapa[], vinculados: string[]): ClienteCapa | undefined {
  const elegivel = (c: ClienteCapa) => vinculados.includes(c.id) && (!c.perfil || c.perfil === 'cliente')
  if (parte.cliente_id) return registros.find(c => c.id === parte.cliente_id && elegivel(c))
  const documento = digitos(parte.cpf_cnpj)
  if (documento) {
    const candidatos = registros.filter(c => digitos(c.cpf_cnpj) === documento)
    return candidatos.length === 1 && elegivel(candidatos[0]) ? candidatos[0] : undefined
  }
  const nome = normalizar(parte.nome)
  if (!nome) return undefined
  const candidatos = registros.filter(c => normalizar(c.nome) === nome)
  return candidatos.length === 1 && elegivel(candidatos[0]) ? candidatos[0] : undefined
}

export function poloDaParte(parte: ParteCapa): 'ativo' | 'passivo' | 'outro' {
  if (/^(A|AT|ATIVO)$/i.test((parte.polo ?? '').trim())) return 'ativo'
  if (/^(P|PA|PASSIVO)$/i.test((parte.polo ?? '').trim())) return 'passivo'
  return 'outro'
}

export function dataCapa(valor?: string | null): string {
  if (!valor) return 'Não informada'
  const compacto = /^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/.exec(valor)
  if (compacto) return `${compacto[3]}/${compacto[2]}/${compacto[1]}`
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : valor
}
