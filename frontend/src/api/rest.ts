import { ErroMCP, mensagemPorStatus } from './mcpClient'

import { avisarDadosAlterados } from './queryClient'

// Após qualquer gravação bem-sucedida, avisarDadosAlterados atualiza o cache de consultas.
export { avisarDadosAlterados }

/** Quem tem um token de acesso: a pessoa conectada (ClienteMCP) ou a sessão administrativa. */
export type Credencial = { token: string }

export type OpcoesRequisicao = {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Objeto enviado como JSON. Sem corpo, nenhum Content-Type é enviado. */
  corpo?: unknown
  cabecalhos?: Record<string, string>
  /** 'no-store' para telas que não podem mostrar dado velho (ex.: administração). */
  cache?: RequestCache
  signal?: AbortSignal
}

// Falha de rede (servidor fora do ar, sem internet) vira uma mensagem em linguagem do usuário.
async function pedir(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro
    throw new ErroMCP(0, 'Não foi possível falar com o servidor. Confira sua conexão e tente de novo.')
  }
}

/** Requisição autenticada. Devolve a resposta quando o status é 2xx; senão lança ErroMCP com a mensagem
 *  do servidor (`mensagem` ou `erro`) ou, na falta dela, a mensagem padrão do status. */
export async function requisitar(credencial: Credencial | null, url: string, opcoes: OpcoesRequisicao = {}): Promise<Response> {
  if (!credencial) throw new ErroMCP(401, 'Conecte-se primeiro.')
  const { metodo = 'GET', corpo, cabecalhos, cache, signal } = opcoes
  const resposta = await pedir(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${credencial.token}`,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...cabecalhos,
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    ...(cache ? { cache } : {}),
    signal,
  })
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => ({}))
    throw new ErroMCP(resposta.status, dados.mensagem || dados.erro || mensagemPorStatus(resposta.status), dados)
  }
  return resposta
}

export async function buscarJson<T>(
  cliente: Credencial | null,
  url: string,
  signal?: AbortSignal,
  opcoes: Pick<OpcoesRequisicao, 'cache' | 'cabecalhos'> = {},
): Promise<T> {
  const resposta = await requisitar(cliente, url, { ...opcoes, signal })
  return resposta.json()
}

export async function enviarJson<T>(
  cliente: Credencial | null,
  url: string,
  corpo: unknown,
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  signal?: AbortSignal,
  opcoes: Pick<OpcoesRequisicao, 'cache' | 'cabecalhos'> = {},
): Promise<T> {
  const resposta = await requisitar(cliente, url, { ...opcoes, metodo, corpo, signal })
  const dados = await resposta.json().catch(() => ({}))
  avisarDadosAlterados()
  return dados
}
