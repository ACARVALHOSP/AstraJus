import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { buscarJson, enviarJson } from '../../api/rest'

type Vinculo = {
  caso_id: string
  titulo?: string
  cliente_nome?: string
  acao?: string
  tipo: string
}

type CasoDisponivel = {
  id: string
  titulo?: string
  autor?: string
  reu?: string
  acao?: string
  processos?: string[]
}

const ROTULO_TIPO: Record<string, string> = {
  recurso: 'Recurso',
  apenso: 'Apenso',
  execucao: 'Execução de sentença',
  cautelar: 'Cautelar / Tutela',
  relacionado: 'Relacionado',
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

export default function VinculosCaso({ casoId, onAbrirCaso }: { casoId: string; onAbrirCaso: (id: string) => void }) {
  const { cliente } = useCliente()
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null)
  const [casosDisponiveis, setCasosDisponiveis] = useState<CasoDisponivel[]>([])

  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [casoSelecionado, setCasoSelecionado] = useState<CasoDisponivel | null>(null)
  const [tipo, setTipo] = useState('relacionado')
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [removendo, setRemovendo] = useState<string | null>(null)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro(null)
    buscarJson<{ vinculos: Vinculo[] }>(cliente, `/casos/${casoId}/vinculos`)
      .then((r) => setVinculos(r.vinculos ?? []))
      .catch((e) => setErro(e instanceof ErroMCP ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false))
    buscarJson<{ casos: CasoDisponivel[] }>(cliente, '/casos')
      .then((r) => setCasosDisponiveis((r.casos ?? []).filter((c) => c.id !== casoId)))
      .catch(() => {})
  }, [cliente, casoId])

  useEffect(carregar, [carregar])

  function aoDigitarNumero(valor: string) {
    setNumeroProcesso(valor)
    setErroForm(null)
    const digitado = soDigitos(valor)
    if (!digitado) {
      setCasoSelecionado(null)
      return
    }
    const encontrado = casosDisponiveis.find((c) => (c.processos ?? []).some((p) => soDigitos(p) === digitado))
    setCasoSelecionado(encontrado ?? null)
  }

  function previewTexto(): string | null {
    const digitado = soDigitos(numeroProcesso)
    if (!digitado) return null
    if (casoSelecionado) {
      const parte = casoSelecionado.autor || casoSelecionado.reu || '(parte não informada)'
      const acao = casoSelecionado.acao || '(ação não informada)'
      return `Parte: ${parte} · Ação: ${acao}` + (casoSelecionado.titulo ? ` — ${casoSelecionado.titulo}` : '')
    }
    return 'Nenhum processo cadastrado com esse número de processo.'
  }

  async function adicionarVinculo() {
    if (!casoSelecionado) {
      setErroForm('Selecione um processo.')
      return
    }
    setEnviando(true)
    setErroForm(null)
    try {
      await enviarJson(cliente, `/casos/${casoId}/vinculos`, { caso_vinculado_id: casoSelecionado.id, tipo })
      setNumeroProcesso('')
      setCasoSelecionado(null)
      setTipo('relacionado')
      carregar()
    } catch (e) {
      setErroForm(e instanceof ErroMCP ? e.message : 'Falha ao vincular.')
    } finally {
      setEnviando(false)
    }
  }

  async function removerVinculo(v: Vinculo) {
    setRemovendo(v.caso_id)
    try {
      await enviarJson(cliente, `/casos/${casoId}/vinculos/${v.caso_id}`, {}, 'DELETE')
      carregar()
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha ao remover.')
    } finally {
      setRemovendo(null)
    }
  }

  const preview = previewTexto()

  return (
    <Flex direction="column" gap="5">
      <Heading as="h3" size="3">Processos vinculados</Heading>
      <div aria-live="polite">
        {carregando && <Carregamento />}
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && vinculos && vinculos.length === 0 && (
          <Callout.Root color="blue" size="1">
            <Callout.Icon><Info size={14} /></Callout.Icon>
            <Callout.Text>Nenhum processo vinculado.</Callout.Text>
          </Callout.Root>
        )}
        {!carregando && vinculos && vinculos.length > 0 && (
          <div className="tabela-responsiva-wrap">
            <TabelaResponsiva principais={['Processo']}>
              <table aria-label="Processos vinculados">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Cliente</th>
                    <th>Ação / Tipo</th>
                    <th>Vínculo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {vinculos.map((v) => (
                    <tr key={v.caso_id}>
                      <td><TextoTabela texto={v.titulo || '(sem título)'} onClick={() => onAbrirCaso(v.caso_id)} /></td>
                      <td><TextoTabela texto={v.cliente_nome || '—'} /></td>
                      <td><TextoTabela texto={v.acao || '—'} /></td>
                      <td>{ROTULO_TIPO[v.tipo] ?? v.tipo}</td>
                      <td>
                        <AcoesTabela rotulo={v.titulo || 'vínculo'} acoes={[{ texto: 'Remover', executar: () => removerVinculo(v), desabilitada: removendo === v.caso_id }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabelaResponsiva>
          </div>
        )}
      </div>
      <details className="vinculos-adicionar">
        <summary>Vincular outro processo</summary>
        <Flex direction="column" gap="4" mt="3">
          <div className="casos-formulario-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="vinculos-numero-processo">Número do processo</label>
              <TextField.Root
                id="vinculos-numero-processo"
                placeholder="1006314-27.2023.8.26.0005"
                autoComplete="off"
                value={numeroProcesso}
                onChange={(e) => aoDigitarNumero(e.target.value)}
              />
              {preview && <Text size="1" color="gray">{preview}</Text>}
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="vinculos-tipo-select">Tipo de vínculo</label>
              <Select.Root value={tipo} onValueChange={setTipo}>
                <Select.Trigger id="vinculos-tipo-select" style={{ width: '100%' }} />
                <Select.Content>
                  {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                    <Select.Item key={valor} value={valor}>{rotulo}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          {erroForm && (
            <Callout.Root color="red" size="1">
              <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
              <Callout.Text>{erroForm}</Callout.Text>
            </Callout.Root>
          )}
          <div>
            <Button size="1" onClick={adicionarVinculo} disabled={enviando}>
              Adicionar vínculo
            </Button>
          </div>
        </Flex>
      </details>
    </Flex>
  )
}
