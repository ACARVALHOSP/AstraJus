import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Button, Callout, Checkbox, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import { useCliente } from '../api/ClienteContext'
import { ErroMCP } from '../api/mcpClient'

export default function Acesso() {
  const { cliente, status, conectar, esquecer } = useCliente()
  const [token, setToken] = useState('')
  const [mostrarToken, setMostrarToken] = useState(false)
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
    <Flex direction="column" gap="6">
      <div>
        <Heading as="h1" size="6">Acesso</Heading>
        <Text as="p" size="2" color="gray" mt="1">Cole o token recebido por e-mail para liberar as consultas. Ele fica só neste navegador.</Text>
      </div>
      <form onSubmit={aoEnviar}>
        <Flex direction="column" gap="5">
          <div className="form-campo">
            <label className="form-campo-label" htmlFor="token">Seu token de acesso</label>
            <TextField.Root
              id="token"
              type={mostrarToken ? 'text' : 'password'}
              placeholder="cole aqui o token recebido por e-mail"
              autoComplete="off"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
            >
              <TextField.Slot side="right">
                <Button type="button" variant="ghost" size="1" onClick={() => setMostrarToken((v) => !v)}>
                  {mostrarToken ? 'Ocultar' : 'Mostrar'}
                </Button>
              </TextField.Slot>
            </TextField.Root>
          </div>
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={lembrar} onCheckedChange={(checked) => setLembrar(Boolean(checked))} />
              Lembrar neste navegador
            </Flex>
          </Text>
          <Flex gap="3">
            <Button size="2" type="submit" disabled={verificando}>
              Conectar
            </Button>
            <Button size="2" variant="ghost" type="button" onClick={aoEsquecer}>
              Esquecer
            </Button>
          </Flex>
        </Flex>
      </form>
      <div aria-live="polite">
        {erro && (
          <Callout.Root color="red" size="1">
            <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
            <Callout.Text>{erro}</Callout.Text>
          </Callout.Root>
        )}
        {!erro && cliente && status === 'conectado' && (
          <Callout.Root color="green" size="1">
            <Callout.Icon><Check size={14} /></Callout.Icon>
            <Callout.Text>Você já pode consultar.</Callout.Text>
          </Callout.Root>
        )}
      </div>
    </Flex>
  )
}
