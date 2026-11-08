import { ErroMCP, mensagemPorStatus, type ClienteMCP } from './mcpClient'

// Falha de rede (servidor fora do ar, sem internet) vira uma mensagem em linguagem do usuário.
async function pedir(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro
    throw new ErroMCP(0, 'Não foi possível falar com o servidor. Confira sua conexão e tente de novo.')
  }
}

export async function buscarJson<T>(cliente: ClienteMCP | null, url: string, signal?: AbortSignal): Promise<T> {
  if (!cliente) throw new ErroMCP(401, 'Conecte-se primeiro.')
  const resposta = await pedir(url, { headers: { Authorization: `Bearer ${cliente.token}` }, signal })
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}))
    throw new ErroMCP(resposta.status, dados.mensagem || mensagemPorStatus(resposta.status), dados)
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
  const resposta = await pedir(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${cliente.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal,
  })
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) {
    throw new ErroMCP(resposta.status, dados.mensagem || mensagemPorStatus(resposta.status), dados)
  }
  return dados
}
