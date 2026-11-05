import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import { useState } from 'react'
import { Button, Callout, Checkbox, Dialog, Flex, RadioGroup, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { enviarJson } from '../../api/rest'

type Mudanca = { id: string; nome: string; atual: string[] | string; depois: string[] | string; alterado: boolean }
type RespostaLote = { mudancas: Mudanca[]; alterados: number; sem_alteracao: number; esperado?: unknown }

function formatarValor(valor: string[] | string): string {
  if (Array.isArray(valor)) return valor.join(', ') || 'Sem etiquetas'
  return valor === 'cliente' ? 'Cliente' : 'Contato'
}

export default function ClientesLoteModal({
  open,
  tipo,
  ids,
  etiquetasExistentes,
  onClose,
  onConcluido,
}: {
  open: boolean
  tipo: 'etiquetas' | 'perfil'
  ids: string[]
  etiquetasExistentes: string[]
  onClose: () => void
  onConcluido: () => void
}) {
  const { cliente } = useCliente()
  const [operacao, setOperacao] = useState<'aplicar_etiquetas' | 'remover_etiquetas'>('aplicar_etiquetas')
  const [etiquetasSelecionadas, setEtiquetasSelecionadas] = useState<Set<string>>(new Set())
  const [novaEtiqueta, setNovaEtiqueta] = useState('')
  const [novoPerfil, setNovoPerfil] = useState('cliente')
  const [previa, setPrevia] = useState<RespostaLote | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function limpar() {
    setOperacao('aplicar_etiquetas')
    setEtiquetasSelecionadas(new Set())
    setNovaEtiqueta('')
    setNovoPerfil('cliente')
    setPrevia(null)
    setErro(null)
  }

  function montarPedido() {
    const etiquetas = [...etiquetasSelecionadas]
    if (operacao === 'aplicar_etiquetas' && novaEtiqueta.trim()) etiquetas.push(novaEtiqueta.trim())
    return {
      ids,
      acao: tipo === 'perfil' ? 'perfil' : operacao,
      ...(tipo === 'perfil' ? { perfil: novoPerfil } : { etiquetas }),
    }
  }

  async function executar() {
    setEnviando(true)
    setErro(null)
    try {
      const confirmar = Boolean(previa)
      const resposta = await enviarJson<RespostaLote>(cliente, '/clientes/acoes-em-massa', {
        ...montarPedido(),
        confirmar,
        ...(confirmar ? { esperado: previa?.esperado } : {}),
      })
      if (confirmar) {
        limpar()
        onConcluido()
      } else {
        setPrevia(resposta)
      }
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao processar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) { limpar(); onClose() } }}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{tipo === 'perfil' ? 'Atualizar perfil' : 'Gerenciar etiquetas'}</Dialog.Title>
        <Flex direction="column" gap="4">
          <p>{ids.length} cliente(s) selecionado(s). Limite de 200 por operação.</p>
          {!previa && tipo === 'etiquetas' && (
            <>
              <RadioGroup.Root value={operacao} onValueChange={(v) => setOperacao(v as typeof operacao)}>
                <Text as="label" size="2" weight="medium">Ação nas etiquetas</Text>
                <Flex direction="column" gap="2" mt="1">
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <RadioGroup.Item value="aplicar_etiquetas" />
                      Aplicar etiquetas
                    </Flex>
                  </Text>
                  <Text as="label" size="2">
                    <Flex gap="2" align="center">
                      <RadioGroup.Item value="remover_etiquetas" />
                      Remover etiquetas
                    </Flex>
                  </Text>
                </Flex>
              </RadioGroup.Root>
              <fieldset>
                <legend className="form-campo-label">Etiquetas existentes</legend>
                {etiquetasExistentes.length === 0 && <p>Nenhuma etiqueta aplicada ainda. Digite uma nova etiqueta abaixo.</p>}
                <Flex direction="column" gap="2">
                  {etiquetasExistentes.map((et) => (
                    <Text key={et} as="label" size="2">
                      <Flex gap="2" align="center">
                        <Checkbox
                          checked={etiquetasSelecionadas.has(et)}
                          onCheckedChange={(checked) =>
                            setEtiquetasSelecionadas((atual) => {
                              const novo = new Set(atual)
                              if (checked) novo.add(et)
                              else novo.delete(et)
                              return novo
                            })
                          }
                        />
                        {et}
                      </Flex>
                    </Text>
                  ))}
                </Flex>
              </fieldset>
              {operacao === 'aplicar_etiquetas' && (
                <div className="form-campo">
                  <label className="form-campo-label" htmlFor="clientes-lote-nova">Nova etiqueta (opcional)</label>
                  <TextField.Root id="clientes-lote-nova" maxLength={40} placeholder="Ex.: Revisar documentação" value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} />
                </div>
              )}
              <p>As demais etiquetas serão preservadas. Limite de 20 etiquetas por cliente e 40 caracteres por etiqueta.</p>
            </>
          )}
          {!previa && tipo === 'perfil' && (
            <>
              <div className="form-campo" style={{ maxWidth: '240px' }}>
                <label className="form-campo-label" htmlFor="clientes-lote-novo-perfil">Novo perfil</label>
                <Select.Root value={novoPerfil} onValueChange={setNovoPerfil}>
                  <Select.Trigger id="clientes-lote-novo-perfil" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="cliente">Cliente</Select.Item>
                    <Select.Item value="contato">Contato</Select.Item>
                  </Select.Content>
                </Select.Root>
              </div>
              <p>O tipo de pessoa e os demais dados e vínculos serão preservados.</p>
            </>
          )}
          {previa && (
            <Flex direction="column" gap="3">
              <p role="status">
                {previa.alterados} cliente(s) serão alterados; {previa.sem_alteracao} sem alteração.
              </p>
              <p>Confira os valores antes de confirmar. Nenhuma alteração foi aplicada ainda.</p>
              <div className="tabela-responsiva-wrap">
                <TabelaResponsiva principais={['Cliente', 'Após confirmar']}>
                  <table className="tabela-responsiva clientes-lote-preview">
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Atual</th>
                        <th>Após confirmar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.mudancas.map((m) => (
                        <tr key={m.id}>
                          <td data-label="Cliente"><TextoTabela texto={m.nome} /></td>
                          <td data-label="Atual"><TextoTabela texto={formatarValor(m.atual)} /></td>
                          <td data-label="Após confirmar">
                            <TextoTabela texto={formatarValor(m.depois) + (m.alterado ? '' : ' · Sem alteração')} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TabelaResponsiva>
              </div>
            </Flex>
          )}
          {erro && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erro}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={() => {
            if (previa) setPrevia(null)
            else { limpar(); onClose() }
          }}>
            {previa ? 'Voltar' : 'Cancelar'}
          </Button>
          <Button disabled={enviando || previa?.alterados === 0} onClick={executar}>
            {previa ? 'Confirmar alterações' : 'Revisar alterações'}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
