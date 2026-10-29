import { useState, type FormEvent } from 'react'
import { Button, Checkbox, Form, PasswordInput, InlineNotification, Stack } from '@carbon/react'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'

export default function Acesso() {
  const { cliente, status, conectar, esquecer } = useCliente()
  const [token, setToken] = useState('')
  const [lembrar, setLembrar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const verificando = status === 'verificando'

  async function aoEnviar(evento: FormEvent) {
    evento.preventDefault()
    const valor = token.trim()
    if (!valor) return
    setErro(null)
    try {
      await conectar(valor, lembrar)
    } catch (e) {
      setErro(e instanceof ErroMCP ? e.message : 'Falha inesperada ao conectar.')
    }
  }

  function aoEsquecer() {
    setToken('')
    setLembrar(false)
    setErro(null)
    esquecer()
  }

  return (
    <Stack gap={6}>
      <div>
        <h2>Acesso</h2>
        <p>Cole o token recebido por e-mail para liberar as consultas. Ele fica só neste navegador.</p>
      </div>
      <Form onSubmit={aoEnviar}>
        <Stack gap={5}>
          <PasswordInput
            id="token"
            labelText="Seu token de acesso"
            placeholder="cole aqui o token recebido por e-mail"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Checkbox
            id="lembrar-token"
            labelText="Lembrar neste navegador"
            checked={lembrar}
            onChange={(_e, { checked }) => setLembrar(checked)}
          />
          <div>
            <Button type="submit" disabled={verificando}>
              Conectar
            </Button>{' '}
            <Button kind="ghost" type="button" onClick={aoEsquecer}>
              Esquecer
            </Button>
          </div>
        </Stack>
      </Form>
      <div aria-live="polite">
        {erro && <InlineNotification kind="error" title="Erro" subtitle={erro} lowContrast hideCloseButton />}
        {!erro && cliente && status === 'conectado' && (
          <InlineNotification kind="success" title="Acesso verificado" subtitle="Você já pode consultar." lowContrast hideCloseButton />
        )}
      </div>
    </Stack>
  )
}
