import CampoData from '../CampoData'
import { useState, type FormEvent } from 'react'
import { Button, Callout, Flex, Text, TextField } from '@radix-ui/themes'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { enviarJson } from '../api/rest'
import PainelPublicacoes from './publicacoes-oab/PainelPublicacoes'

export default function PublicacoesOab() {
  const { cliente } = useCliente()
  return <PainelPublicacoes key={cliente?.token ?? 'sem-conexao'} Captura={CapturaManual} />
}

function CapturaManual({ onCapturado }: { onCapturado: () => void }) {
  const { cliente } = useCliente()
  const [numeroOab, setNumeroOab] = useState('')
  const [ufOab, setUfOab] = useState('')
  const [nome, setNome] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    if (!dataInicio || !dataFim || dataInicio > dataFim) {
      setFalhou(true); setStatus('Informe um período completo. A data inicial deve ser anterior ou igual à data final.'); return
    }
    setEnviando(true)
    setFalhou(false)
    setStatus('Consultando o DJEN…')
    try {
      const resultado = (await enviarJson(cliente, '/publicacoes-oab/capturar-manual', {
        numero_oab: numeroOab.trim(),
        uf_oab: ufOab.trim(),
        nome: nome.trim(),
        data_inicio: dataInicio,
        data_fim: dataFim,
      })) as { encontradas: number; novas: number }
      setStatus(
        `${resultado.encontradas} ${resultado.encontradas === 1 ? 'publicação encontrada' : 'publicações encontradas'} no DJEN. ` +
          `${resultado.novas} ${resultado.novas === 1 ? 'nova publicação adicionada' : 'novas publicações adicionadas'} à lista.`,
      )
      onCapturado()
    } catch (e) {
      setFalhou(true)
      setStatus(e instanceof ErroMCP ? e.message : 'Falha inesperada.')
      onCapturado()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={aoEnviar}>
        <Flex direction="column" gap="5">
          <Text as="p" size="2" color="gray">Captura avulsa: informe a OAB e as duas datas obrigatórias. Para ativar a captura recorrente, crie um monitoramento na tela Monitoramentos.</Text>
          <div className="aj-form-grade">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-oab-manual-numero">Número da OAB</label>
              <TextField.Root
                id="pub-oab-manual-numero"
                placeholder="Ex.: 330659"
                maxLength={6}
                autoComplete="off"
                required
                value={numeroOab}
                onChange={(e) => setNumeroOab(e.target.value)}
              />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-oab-manual-uf">UF da OAB (opcional)</label>
              <TextField.Root
                id="pub-oab-manual-uf"
                placeholder="Ex.: SP"
                maxLength={2}
                autoComplete="off"
                value={ufOab}
                onChange={(e) => setUfOab(e.target.value)}
              />
            </div>
            <div className="form-campo" style={{ gridColumn: 'span 2' }}>
              <label className="form-campo-label" htmlFor="pub-oab-manual-nome">Nome para identificar os registros (opcional)</label>
              <TextField.Root
                id="pub-oab-manual-nome"
                placeholder="Ex.: Maria Silva"
                autoComplete="off"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
              <Text size="1" color="gray">Identifica os registros na lista; não filtra a consulta no DJEN.</Text>
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-oab-manual-data-inicio">Data inicial (obrigatória)</label>
              <CampoData id="pub-oab-manual-data-inicio" required value={dataInicio} onChange={v => setDataInicio(v)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="pub-oab-manual-data-fim">Data final (obrigatória)</label>
              <CampoData id="pub-oab-manual-data-fim" required value={dataFim} onChange={v => setDataFim(v)} />
            </div>
          </div>
          <div>
            <Button size="2" type="submit" disabled={enviando}>
              Capturar agora
            </Button>
          </div>
          {status && (
            <Callout.Root color={falhou ? 'red' : enviando ? 'blue' : 'green'} size="1">
              <Callout.Icon>{falhou ? <AlertTriangle size={14} /> : enviando ? <Info size={14} /> : <CheckCircle2 size={14} />}</Callout.Icon>
              <Callout.Text>{status}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
    </form>
  )
}
