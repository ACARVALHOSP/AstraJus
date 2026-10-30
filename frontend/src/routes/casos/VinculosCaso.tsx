import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useCallback, useEffect, useState } from 'react'
import { Button, Column, Grid, InlineNotification, Select, SelectItem, Stack, TextInput } from '@carbon/react'
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
      .catch(() => {
        // busca por número fica indisponível até recarregar
      })
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
    <Stack gap={5}>
      <h3>Processos vinculados</h3>
      <div aria-live="polite">
        {carregando && <Carregamento />}
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!carregando && vinculos && vinculos.length === 0 && <InlineNotification kind="info" title="Nenhum processo vinculado" lowContrast hideCloseButton />}
        {!carregando && vinculos && vinculos.length > 0 && (
          <div className="tabela-responsiva-wrap">
            <table className="tabela-responsiva tabela-vinculos">
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Cliente</th>
                  <th>Ação / Tipo</th>
                  <th>Vínculo</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {vinculos.map((v) => (
                  <tr key={v.caso_id}>
                    <td>
                      <TextoTabela texto={v.titulo || '(sem título)'} onClick={() => onAbrirCaso(v.caso_id)} />
                    </td>
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
          </div>
        )}
      </div>
      <details className="vinculos-adicionar">
        <summary>Vincular outro processo</summary>
        <Stack gap={5}>
          <Grid narrow fullWidth>
            <Column sm={4} md={4} lg={9}>
              <TextInput
                id="vinculos-numero-processo"
                labelText="Número do processo"
                placeholder="1006314-27.2023.8.26.0005"
                autoComplete="off"
                helperText={preview ?? undefined}
                value={numeroProcesso}
                onChange={(e) => aoDigitarNumero(e.target.value)}
              />
            </Column>
            <Column sm={4} md={4} lg={7}>
              <Select id="vinculos-tipo-select" labelText="Tipo de vínculo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor} text={rotulo} />
                ))}
              </Select>
            </Column>
          </Grid>
          {erroForm && <InlineNotification kind="error" title="Erro" subtitle={erroForm} lowContrast hideCloseButton />}
          <div>
            <Button size="sm" onClick={adicionarVinculo} disabled={enviando}>
              Adicionar vínculo
            </Button>
          </div>
        </Stack>
      </details>
    </Stack>
  )
}
