import { formatarNumeroCNJ } from '../../utils/formatadores'
import { useAvisos } from '../../Avisos'
import TabelaResponsiva from '../../TabelaResponsiva'
import TextoTabela from '../../TextoTabela'
import AcoesTabela from '../../AcoesTabela'
import Carregamento from '../../Carregamento'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Callout, Flex, Heading, Select, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, Info } from 'lucide-react'
import { useCliente } from '../../api/ClienteContext'
import { ErroMCP } from '../../api/mcpClient'
import { useCasos } from '../../api/consultas'
import { enviarJson } from '../../api/rest'
import { consultaVinculos } from './consultasCaso'

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

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export default function VinculosCaso({ casoId, onAbrirCaso }: { casoId: string; onAbrirCaso: (id: string) => void }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()

  const [numeroProcesso, setNumeroProcesso] = useState('')
  const [casoSelecionado, setCasoSelecionado] = useState<CasoDisponivel | null>(null)
  const [tipo, setTipo] = useState('relacionado')
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [removendo, setRemovendo] = useState<string | null>(null)

  const consulta = useQuery({ ...consultaVinculos(cliente, casoId), enabled: Boolean(cliente) })
  const consultaCasos = useCasos<CasoDisponivel>({ enabled: Boolean(cliente) })
  const vinculos = consulta.data ?? null
  const casosDisponiveis = (consultaCasos.data ?? []).filter(c => c.id !== casoId)
  const carregando = consulta.isLoading
  const erro = consulta.error ? (consulta.error instanceof ErroMCP ? consulta.error.message : 'Falha ao carregar.') : null
  const carregar = () => void consulta.refetch()

  // Busca por título, parte ou número (com ou sem pontuação), entre os processos do escritório.
  function aoDigitarNumero(valor: string) {
    setNumeroProcesso(valor)
    setErroForm(null)
    setCasoSelecionado(null)
  }
  const termoBusca = semAcento(numeroProcesso.trim())
  const digitosBusca = soDigitos(numeroProcesso)
  const jaVinculados = new Set((vinculos ?? []).map(v => v.caso_id))
  const resultadosBusca = !casoSelecionado && termoBusca
    ? casosDisponiveis.filter(c => !jaVinculados.has(c.id) && (
        semAcento([c.titulo, c.autor, c.reu, c.acao].filter(Boolean).join(' ')).includes(termoBusca)
        || (digitosBusca.length >= 4 && (c.processos ?? []).some(p => soDigitos(p).includes(digitosBusca))))).slice(0, 8)
    : []

  function previewTexto(): string | null {
    if (!casoSelecionado) return termoBusca && !resultadosBusca.length ? 'Nenhum processo encontrado.' : null
    const parte = casoSelecionado.autor || casoSelecionado.reu || '(parte não informada)'
    const acao = casoSelecionado.acao || '(ação não informada)'
    return `Parte: ${parte} · Ação: ${acao}`
  }

  async function adicionarVinculo() {
    if (!casoSelecionado) {
      setErroForm('Busque e escolha o processo na lista.')
      return
    }
    setEnviando(true)
    setErroForm(null)
    try {
      await enviarJson(cliente, `/casos/${casoId}/vinculos`, { caso_vinculado_id: casoSelecionado.id, tipo })
      avisar({ texto: `Vínculo com “${casoSelecionado.titulo || 'processo'}” adicionado.` })
      setNumeroProcesso('')
      setCasoSelecionado(null)
      setTipo('relacionado')
      carregar()
    } catch (e) {
      setErroForm(e instanceof ErroMCP ? e.message : 'Não foi possível vincular. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  async function removerVinculo(v: Vinculo) {
    setRemovendo(v.caso_id)
    try {
      await enviarJson(cliente, `/casos/${casoId}/vinculos/${v.caso_id}`, {}, 'DELETE')
      carregar()
      avisar({
        texto: `Vínculo com “${v.titulo || 'processo'}” removido.`,
        desfazer: async () => {
          await enviarJson(cliente, `/casos/${casoId}/vinculos`, { caso_vinculado_id: v.caso_id, tipo: v.tipo })
          carregar()
        },
      })
    } catch (e) {
      avisar({ tipo: 'erro', texto: e instanceof ErroMCP ? e.message : 'Não foi possível remover. Tente de novo.' })
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
              <label className="form-campo-label" htmlFor="vinculos-numero-processo">Processo</label>
              <TextField.Root
                id="vinculos-numero-processo"
                placeholder="Título, parte ou número do processo"
                autoComplete="off"
                value={casoSelecionado ? (casoSelecionado.titulo || (casoSelecionado.processos ?? [])[0] || '') : numeroProcesso}
                onChange={(e) => aoDigitarNumero(e.target.value)}
              />
              {resultadosBusca.length > 0 && (
                <Flex direction="column" gap="1" className="busca-resultados" role="listbox" aria-label="Processos encontrados">
                  {resultadosBusca.map(c => (
                    <button key={c.id} type="button" role="option" aria-selected={false} className="aj-busca-item"
                      onClick={() => { setCasoSelecionado(c); setNumeroProcesso('') }}>
                      {c.titulo || '(sem título)'}{(c.processos ?? [])[0] ? ` — ${formatarNumeroCNJ((c.processos ?? [])[0])}` : ''}
                    </button>
                  ))}
                </Flex>
              )}
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
