import { useState, type FormEvent } from 'react'
import { Accordion, AccordionItem, Button, Column, DatePicker, DatePickerInput, Grid, Stack, TextInput } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'
import { enviarJson } from '../api/rest'
import { formatarDdMmAaaa } from '../utils/formatadores'
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

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
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
      setStatus(e instanceof ErroMCP ? e.message : 'Falha inesperada.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Accordion>
      <AccordionItem title="Capturar publicações por OAB">
        <form onSubmit={aoEnviar}>
          <Stack gap={5}>
            <Grid withRowGap narrow fullWidth>
              <Column sm={4} md={4} lg={4}>
                <TextInput
                  id="pub-oab-manual-numero"
                  labelText="Número da OAB"
                  placeholder="Ex.: 330659"
                  maxLength={6}
                  autoComplete="off"
                  required
                  value={numeroOab}
                  onChange={(e) => setNumeroOab(e.target.value)}
                />
              </Column>
              <Column sm={4} md={4} lg={4}>
                <TextInput
                  id="pub-oab-manual-uf"
                  labelText="UF da OAB (opcional)"
                  placeholder="Ex.: SP"
                  maxLength={2}
                  autoComplete="off"
                  value={ufOab}
                  onChange={(e) => setUfOab(e.target.value)}
                />
              </Column>
              <Column sm={4} md={8} lg={8}>
                <TextInput
                  id="pub-oab-manual-nome"
                  labelText="Nome para identificar os registros (opcional)"
                  placeholder="Ex.: Maria Silva"
                  helperText="Identifica os registros na lista; não filtra a consulta no DJEN."
                  autoComplete="off"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                />
              </Column>
              <Column sm={4} md={8} lg={16}>
                <DatePicker
                  datePickerType="range"
                  dateFormat="Y-m-d"
                  onChange={(datas: Date[]) => {
                    const [inicio, fim] = datas
                    setDataInicio(inicio ? isoDeData(inicio) : '')
                    setDataFim(fim ? isoDeData(fim) : '')
                  }}
                >
                  <DatePickerInput id="pub-oab-manual-data-inicio" labelText="Data inicial" placeholder="aaaa-mm-dd" />
                  <DatePickerInput id="pub-oab-manual-data-fim" labelText="Data final" placeholder="aaaa-mm-dd" />
                </DatePicker>
              </Column>
            </Grid>
            <div>
              <Button kind="primary" type="submit" size="sm" disabled={enviando}>
                Capturar agora
              </Button>
            </div>
            {status && <p role="status">{status}</p>}
          </Stack>
        </form>
      </AccordionItem>
    </Accordion>
  )
}

function isoDeData(data: Date): string {
  const [dia, mes, ano] = formatarDdMmAaaa(data).split('/')
  return `${ano}-${mes}-${dia}`
}
