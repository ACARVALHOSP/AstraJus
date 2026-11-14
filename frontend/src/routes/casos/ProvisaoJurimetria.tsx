import { useState } from 'react'
import { Badge, Callout, Card, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { formatarPercentual, formatarReais } from '../../utils/formatadores'
import type { Analise } from './jurimetriaCaso'
import { calcularProvisao, classificarRisco, lerReais, LIMITES_RISCO, ROTULO_RISCO, textoProvisao, type NivelRisco } from './jurimetriaTempo'

export type FonteProvisao = { chave: string; titulo: string; analise: Analise }
type ModoValor = 'mediana' | 'causa' | 'outro'
type Perspectiva = 'reu' | 'autor'

const COR_RISCO: Record<NivelRisco, 'red' | 'amber' | 'green'> = { provavel: 'red', possivel: 'amber', remota: 'green' }

/** Conta simples e transparente sobre as sentenças da amostra: valor × chance de alguma procedência × fator médio.
 *  Todas as premissas aparecem e podem ser trocadas; não é parecer nem laudo contábil. */
export default function ProvisaoJurimetria({ fontes, valorCausa }: { fontes: FonteProvisao[]; valorCausa: number | null }) {
  const utilizaveis = fontes.filter(f => f.analise.classificados > 0)
  const [escolhida, setEscolhida] = useState<string>('')
  const [perspectiva, setPerspectiva] = useState<Perspectiva>('reu')
  const [modo, setModo] = useState<ModoValor | ''>('')
  const [outro, setOutro] = useState('')
  const [fatorTexto, setFatorTexto] = useState('50')
  if (utilizaveis.length === 0) return null

  const fonte = utilizaveis.find(f => f.chave === escolhida) ?? utilizaveis.find(f => !f.analise.amostraPequena) ?? utilizaveis[0]
  const a = fonte.analise
  const medianaDisponivel = a.valores?.mediana ?? null
  // Padrão: o valor da causa, se a capa tem; senão a mediana de condenação da amostra; senão a pessoa digita.
  const modoEfetivo: ModoValor = modo || (valorCausa !== null ? 'causa' : medianaDisponivel !== null ? 'mediana' : 'outro')
  const valorBase = modoEfetivo === 'causa' ? valorCausa : modoEfetivo === 'mediana' ? medianaDisponivel : lerReais(outro)
  const fatorPct = Number(fatorTexto.replace(',', '.'))
  const fatorValido = fatorTexto.trim() !== '' && Number.isFinite(fatorPct) && fatorPct >= 0 && fatorPct <= 100
  const pronto = valorBase !== null && fatorValido && a.taxaProcedencia !== null

  const premissas = pronto ? {
    valorBase: valorBase!, chance: a.taxaProcedencia!, intervalo: a.icProcedencia, procedentes: a.contagens.procedente, parciais: a.contagens.parcial, fatorParcial: fatorPct / 100,
  } : null
  const resultado = premissas ? calcularProvisao(premissas) : null
  const risco = a.taxaProcedencia !== null ? classificarRisco(a.taxaProcedencia) : null
  const reu = perspectiva === 'reu'

  return (
    <Card variant="surface">
      <Flex direction="column" gap="3">
        <div>
          <Heading as="h3" size="3">{reu ? 'Exposição e provisão (estimativa)' : 'Expectativa de recebimento (estimativa)'}</Heading>
          <Text as="p" size="2" color="gray">
            Uma conta simples sobre as sentenças da amostra, com premissas que você pode trocar. Não é parecer nem laudo contábil.
          </Text>
        </div>

        <div className="jurimetria-caso__filtros">
          <div className="form-campo">
            <label className="form-campo-label" id="prov-perspectiva">Nosso cliente é</label>
            <Select.Root value={perspectiva} onValueChange={v => setPerspectiva(v as Perspectiva)}>
              <Select.Trigger aria-labelledby="prov-perspectiva" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="reu">Réu (risco de perder)</Select.Item>
                <Select.Item value="autor">Autor (chance de ganhar)</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" id="prov-fonte">Chance vem de</label>
            <Select.Root value={fonte.chave} onValueChange={setEscolhida}>
              <Select.Trigger aria-labelledby="prov-fonte" style={{ width: '100%' }} />
              <Select.Content>
                {utilizaveis.map(f => <Select.Item key={f.chave} value={f.chave}>{f.titulo}{f.analise.amostraPequena ? ' (amostra pequena)' : ''}</Select.Item>)}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="form-campo">
            <label className="form-campo-label" id="prov-valor">Valor se o pedido for acolhido</label>
            <Select.Root value={modoEfetivo} onValueChange={v => setModo(v as ModoValor)}>
              <Select.Trigger aria-labelledby="prov-valor" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="causa" disabled={valorCausa === null}>Valor da causa{valorCausa !== null ? ` (${formatarReais(valorCausa)})` : ' (não informado na capa)'}</Select.Item>
                <Select.Item value="mediana" disabled={medianaDisponivel === null}>Mediana de condenação da amostra{medianaDisponivel !== null ? ` (${formatarReais(medianaDisponivel)})` : ' (sem valores extraídos)'}</Select.Item>
                <Select.Item value="outro">Outro valor</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          {modoEfetivo === 'outro' && (
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="prov-outro">Valor (R$)</label>
              <TextField.Root id="prov-outro" inputMode="decimal" placeholder="Ex.: 15.000,00" value={outro} onChange={e => setOutro(e.target.value)} />
            </div>
          )}
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="prov-fator">Parcial vale quanto do valor (%)</label>
            <TextField.Root id="prov-fator" inputMode="decimal" value={fatorTexto} onChange={e => setFatorTexto(e.target.value)} color={fatorValido ? undefined : 'red'} />
            {!fatorValido && <Text size="1" color="red">Informe um número de 0 a 100.</Text>}
          </div>
        </div>

        {a.amostraPequena && (
          <Callout.Root color="amber" size="1" role="status">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>A amostra tem só {a.classificados} sentenças classificadas (o mínimo confiável é 30): a chance e a faixa abaixo variam muito.</Callout.Text>
          </Callout.Root>
        )}

        {resultado && premissas ? (
          <Flex direction="column" gap="2" aria-live="polite">
            <div>
              <Text as="div" size="7" weight="bold">{formatarReais(resultado.esperado)}</Text>
              <Text size="2" color="gray">{reu ? 'exposição esperada' : 'recebimento esperado'}{resultado.minimo !== null && resultado.maximo !== null ? ` · faixa ${formatarReais(resultado.minimo)} a ${formatarReais(resultado.maximo)}` : ''}</Text>
            </div>
            {risco && reu && (
              <Flex align="center" gap="2" wrap="wrap">
                <Badge color={COR_RISCO[risco]} variant="soft" size="2">Perda {ROTULO_RISCO[risco]}</Badge>
                <Text size="1" color="gray">
                  chance de alguma procedência {formatarPercentual(a.taxaProcedencia)}; referência usual: provável a partir de {formatarPercentual(LIMITES_RISCO.provavel)}, possível a partir de {formatarPercentual(LIMITES_RISCO.possivel)}.
                  Classificar para fins de provisão é decisão do advogado e do contador.
                </Text>
              </Flex>
            )}
            <Text size="2">{textoProvisao(resultado, premissas, perspectiva)}</Text>
            <Text size="1" color="gray">Acordos e extinções sem mérito entram como zero. Custas, honorários de sucumbência, juros e correção não estão na conta.</Text>
          </Flex>
        ) : (
          <Text size="2" color="gray" role="status">
            {a.taxaProcedencia === null ? 'Sem sentenças classificadas para calcular a chance.' : valorBase === null ? 'Informe o valor para calcular.' : 'Corrija o percentual para calcular.'}
          </Text>
        )}
      </Flex>
    </Card>
  )
}
