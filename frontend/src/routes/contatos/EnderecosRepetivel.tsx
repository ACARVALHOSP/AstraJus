import { Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Select, TextField } from '@radix-ui/themes'
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
      <span className="form-campo-label">Endereço</span>
      <div className="aj-layout-33">
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
      <Button variant="ghost" size="1" onClick={onAdicionar} className="aj-layout-34">
        <Plus size={16} />
        Adicionar endereço
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
      <div className="endereco-card-topo">
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-tipo-${indice}`}>Tipo</label>
          <Select.Root value={item.tipo || '__empty__'} onValueChange={(v) => onAlterar({ tipo: v === '__empty__' ? '' : v })}>
            <Select.Trigger id={`endereco-tipo-${indice}`} style={{ width: '100%' }} />
            <Select.Content>
              <Select.Item value="__empty__">Tipo</Select.Item>
              <Select.Item value="residencial">Residencial</Select.Item>
              <Select.Item value="comercial">Comercial</Select.Item>
              <Select.Item value="cobranca">Cobrança</Select.Item>
              <Select.Item value="outro">Outro</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-cep-${indice}`}>CEP</label>
          <TextField.Root
            id={`endereco-cep-${indice}`}
            placeholder="Digite o CEP"
            autoComplete="postal-code"
            value={item.cep}
            onChange={(e) => aoMudarCep(e.target.value)}
          />
        </div>
        <div className="aj-layout-35">
          <Button variant="ghost" size="1" aria-label="Remover endereço" onClick={onRemover}>
            <X size={16} />
          </Button>
        </div>
      </div>
      <div className="endereco-grade">
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-rua-${indice}`}>Rua</label>
          <TextField.Root id={`endereco-rua-${indice}`} placeholder="Digite a rua" autoComplete="address-line1" value={item.rua} onChange={(e) => onAlterar({ rua: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-numero-${indice}`}>Número</label>
          <TextField.Root id={`endereco-numero-${indice}`} placeholder="Digite o número" value={item.numero} onChange={(e) => onAlterar({ numero: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-bairro-${indice}`}>Bairro</label>
          <TextField.Root id={`endereco-bairro-${indice}`} placeholder="Digite o bairro" value={item.bairro} onChange={(e) => onAlterar({ bairro: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-complemento-${indice}`}>Complemento</label>
          <TextField.Root id={`endereco-complemento-${indice}`} placeholder="Digite o complemento" autoComplete="address-line2" value={item.complemento} onChange={(e) => onAlterar({ complemento: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-cidade-${indice}`}>Cidade</label>
          <TextField.Root id={`endereco-cidade-${indice}`} placeholder="Digite a cidade" autoComplete="address-level2" value={item.cidade} onChange={(e) => onAlterar({ cidade: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-estado-${indice}`}>Estado</label>
          <TextField.Root id={`endereco-estado-${indice}`} placeholder="Digite o estado" autoComplete="address-level1" value={item.estado} onChange={(e) => onAlterar({ estado: e.target.value })} />
        </div>
        <div className="form-campo">
          <label className="form-campo-label" htmlFor={`endereco-pais-${indice}`}>País</label>
          <TextField.Root id={`endereco-pais-${indice}`} placeholder="Digite o país" autoComplete="country-name" value={item.pais} onChange={(e) => onAlterar({ pais: e.target.value })} />
        </div>
      </div>
      <span role="status">{statusCep}</span>
    </div>
  )
}
