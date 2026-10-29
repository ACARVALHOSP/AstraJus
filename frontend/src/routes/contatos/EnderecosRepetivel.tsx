import { useRef, useState } from 'react'
import { Button, Select, SelectItem, TextInput } from '@carbon/react'
import { mascaraCep } from '../../utils/mascaras'

export type Endereco = {
  tipo: string
  cep: string
  rua: string
  numero: string
  bairro: string
  complemento: string
  cidade: string
  estado: string
  pais: string
}

type RespostaCep = { logradouro?: string; bairro?: string; localidade?: string; uf?: string; erro?: boolean }

async function buscarCep(cep: string): Promise<{ ok: true; dados: RespostaCep } | { ok: false; motivo: 'formato' | 'nao_encontrado' | 'http' }> {
  const digitos = cep.replace(/\D/g, '')
  if (digitos.length !== 8) return { ok: false, motivo: 'formato' }
  try {
    const resposta = await fetch(`/cep/${digitos}`)
    if (resposta.status === 404) return { ok: false, motivo: 'nao_encontrado' }
    if (!resposta.ok) return { ok: false, motivo: 'http' }
    const dados = (await resposta.json()) as RespostaCep
    if (dados.erro) return { ok: false, motivo: 'nao_encontrado' }
    return { ok: true, dados }
  } catch {
    return { ok: false, motivo: 'http' }
  }
}

export default function EnderecosRepetivel({
  itens,
  onAdicionar,
  onRemover,
  onAlterar,
}: {
  itens: Endereco[]
  onAdicionar: () => void
  onRemover: (indice: number) => void
  onAlterar: (indice: number, alteracoes: Partial<Endereco>) => void
}) {
  return (
    <div>
      <span className="cds--label">Endereço</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
        {itens.map((item, indice) => (
          <CardEndereco
            key={indice}
            indice={indice}
            item={item}
            onRemover={() => onRemover(indice)}
            onAlterar={(alteracoes) => onAlterar(indice, alteracoes)}
          />
        ))}
      </div>
      <Button kind="ghost" size="sm" onClick={onAdicionar} style={{ marginTop: '0.5rem' }}>
        + Adicionar endereço
      </Button>
    </div>
  )
}

function CardEndereco({
  item,
  indice,
  onRemover,
  onAlterar,
}: {
  item: Endereco
  indice: number
  onRemover: () => void
  onAlterar: (alteracoes: Partial<Endereco>) => void
}) {
  const [statusCep, setStatusCep] = useState('')
  const cepEmAndamento = useRef('')

  async function autopreencherPorCep(cep: string) {
    const digitos = cep.replace(/\D/g, '')
    if (digitos.length !== 8 || digitos === cepEmAndamento.current) return
    cepEmAndamento.current = digitos
    setStatusCep('Buscando CEP…')
    const resultado = await buscarCep(cep)
    if (cep.replace(/\D/g, '') !== digitos) return
    if (!resultado.ok) {
      setStatusCep(resultado.motivo === 'nao_encontrado' ? 'CEP não encontrado.' : 'Não foi possível buscar o CEP agora. Preencha o endereço manualmente.')
      return
    }
    onAlterar({
      rua: resultado.dados.logradouro || item.rua,
      bairro: resultado.dados.bairro || item.bairro,
      cidade: resultado.dados.localidade || item.cidade,
      estado: resultado.dados.uf || item.estado,
      pais: item.pais || 'Brasil',
    })
    setStatusCep('')
  }

  function aoMudarCep(valor: string) {
    const mascarado = mascaraCep(valor)
    setStatusCep('')
    cepEmAndamento.current = ''
    onAlterar({ cep: mascarado })
    if (mascarado.replace(/\D/g, '').length === 8) autopreencherPorCep(mascarado)
  }

  return (
    <div className="endereco-card">
      <div className="endereco-card-topo" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <Select id={`endereco-tipo-${indice}`} labelText="Tipo" value={item.tipo} onChange={(e) => onAlterar({ tipo: e.target.value })}>
          <SelectItem value="" text="Tipo" />
          <SelectItem value="residencial" text="Residencial" />
          <SelectItem value="comercial" text="Comercial" />
          <SelectItem value="cobranca" text="Cobrança" />
          <SelectItem value="outro" text="Outro" />
        </Select>
        <TextInput
          id={`endereco-cep-${indice}`}
          labelText="CEP"
          placeholder="Digite o CEP"
          autoComplete="postal-code"
          value={item.cep}
          onChange={(e) => aoMudarCep(e.target.value)}
        />
        <Button kind="ghost" size="sm" hasIconOnly iconDescription="Remover" onClick={onRemover}>
          ✕
        </Button>
      </div>
      <div className="endereco-grade cds--css-grid">
        <TextInput id={`endereco-rua-${indice}`} labelText="Rua" placeholder="Digite a rua" autoComplete="address-line1" value={item.rua} onChange={(e) => onAlterar({ rua: e.target.value })} />
        <TextInput id={`endereco-numero-${indice}`} labelText="Número" placeholder="Digite o número" value={item.numero} onChange={(e) => onAlterar({ numero: e.target.value })} />
        <TextInput id={`endereco-bairro-${indice}`} labelText="Bairro" placeholder="Digite o bairro" value={item.bairro} onChange={(e) => onAlterar({ bairro: e.target.value })} />
        <TextInput
          id={`endereco-complemento-${indice}`}
          labelText="Complemento"
          placeholder="Digite o complemento"
          autoComplete="address-line2"
          value={item.complemento}
          onChange={(e) => onAlterar({ complemento: e.target.value })}
        />
        <TextInput id={`endereco-cidade-${indice}`} labelText="Cidade" placeholder="Digite a cidade" autoComplete="address-level2" value={item.cidade} onChange={(e) => onAlterar({ cidade: e.target.value })} />
        <TextInput id={`endereco-estado-${indice}`} labelText="Estado" placeholder="Digite o estado" autoComplete="address-level1" value={item.estado} onChange={(e) => onAlterar({ estado: e.target.value })} />
        <TextInput id={`endereco-pais-${indice}`} labelText="País" placeholder="Digite o país" autoComplete="country-name" value={item.pais} onChange={(e) => onAlterar({ pais: e.target.value })} />
      </div>
      <span role="status">{statusCep}</span>
    </div>
  )
}
