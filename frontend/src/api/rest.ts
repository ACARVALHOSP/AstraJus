import { ErroMCP, type ClienteMCP } from './mcpClient'

export async function buscarJson<T>(cliente: ClienteMCP | null, url: string, signal?: AbortSignal): Promise<T> {
  if (!cliente) throw new ErroMCP(401, 'Conecte-se primeiro.')
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${cliente.token}` }, signal })
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}))
    throw new ErroMCP(resposta.status, dados.mensagem || `Falha ao consultar ${url} (HTTP ${resposta.status}).`)
  }
  return resposta.json()
}

export async function enviarJson<T>(
  cliente: ClienteMCP | null,
  url: string,
  corpo: unknown,
  metodo: 'POST' | 'PATCH' | 'DELETE' = 'POST',
  signal?: AbortSignal,
): Promise<T> {
  if (!cliente) throw new ErroMCP(401, 'Conecte-se primeiro.')
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${cliente.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal,
  })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) {
    throw new ErroMCP(resposta.status, dados.mensagem || `Falha ao enviar para ${url} (HTTP ${resposta.status}).`)
  }
  return dados
}
