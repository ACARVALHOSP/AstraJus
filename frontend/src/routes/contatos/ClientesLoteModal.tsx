import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import { useState } from 'react'
import { Checkbox, InlineNotification, Modal, RadioButton, RadioButtonGroup, Select, SelectItem, Stack, TextInput } from '@carbon/react'
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
    <Modal closeButtonLabel="Fechar"
      open={open}
      modalHeading={tipo === 'perfil' ? 'Atualizar perfil' : 'Gerenciar etiquetas'}
      primaryButtonText={previa ? 'Confirmar alterações' : 'Revisar alterações'}
      secondaryButtonText={previa ? 'Voltar' : 'Cancelar'}
      primaryButtonDisabled={enviando || previa?.alterados === 0}
      onRequestClose={() => {
        limpar()
        onClose()
      }}
      onRequestSubmit={previa ? executar : executar}
      onSecondarySubmit={() => {
        if (previa) setPrevia(null)
        else {
          limpar()
          onClose()
        }
      }}
    >
      <Stack gap={5}>
        <p>
          {ids.length} cliente(s) selecionado(s). Limite de 200 por operação.
        </p>
        {!previa && tipo === 'etiquetas' && (
          <>
            <RadioButtonGroup
              name="clientes-lote-operacao"
              legendText="Ação nas etiquetas"
              valueSelected={operacao}
              onChange={(v) => setOperacao(v as 'aplicar_etiquetas' | 'remover_etiquetas')}
            >
              <RadioButton id="lote-aplicar" labelText="Aplicar etiquetas" value="aplicar_etiquetas" />
              <RadioButton id="lote-remover" labelText="Remover etiquetas" value="remover_etiquetas" />
            </RadioButtonGroup>
            <fieldset>
              <legend className="cds--label">Etiquetas existentes</legend>
              {etiquetasExistentes.length === 0 && <p>Nenhuma etiqueta aplicada ainda. Digite uma nova etiqueta abaixo.</p>}
              {etiquetasExistentes.map((et) => (
                <Checkbox
                  key={et}
                  id={`lote-etiqueta-${et}`}
                  labelText={et}
                  checked={etiquetasSelecionadas.has(et)}
                  onChange={(_e, { checked }) =>
                    setEtiquetasSelecionadas((atual) => {
                      const novo = new Set(atual)
                      if (checked) novo.add(et)
                      else novo.delete(et)
                      return novo
                    })
                  }
                />
              ))}
            </fieldset>
            {operacao === 'aplicar_etiquetas' && (
              <TextInput id="clientes-lote-nova" labelText="Nova etiqueta (opcional)" maxLength={40} placeholder="Ex.: Revisar documentação" value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} />
            )}
            <p>As demais etiquetas serão preservadas. Limite de 20 etiquetas por cliente e 40 caracteres por etiqueta.</p>
          </>
        )}
        {!previa && tipo === 'perfil' && (
          <>
            <div className="aj-layout-32">
              <Select id="clientes-lote-novo-perfil" labelText="Novo perfil" value={novoPerfil} onChange={(e) => setNovoPerfil(e.target.value)}>
                <SelectItem value="cliente" text="Cliente" />
                <SelectItem value="contato" text="Contato" />
              </Select>
            </div>
            <p>O tipo de pessoa e os demais dados e vínculos serão preservados.</p>
          </>
        )}
        {previa && (
          <Stack gap={3}>
            <p role="status">
              {previa.alterados} cliente(s) serão alterados; {previa.sem_alteracao} sem alteração.
            </p>
            <p>Confira os valores antes de confirmar. Nenhuma alteração foi aplicada ainda.</p>
            <div className="tabela-responsiva-wrap">
              <TabelaResponsiva principais={['Cliente', 'Após confirmar']}><table className="tabela-responsiva clientes-lote-preview">
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
              </table></TabelaResponsiva>
            </div>
          </Stack>
        )}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
      </Stack>
    </Modal>
  )
}
