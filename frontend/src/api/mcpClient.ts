const URL_MCP = '/mcp'

/** Mensagem para quem usa o sistema quando o servidor não explica o erro. */
export function mensagemPorStatus(status: number): string {
  if (status === 0) return 'Não foi possível falar com o servidor. Confira sua conexão e tente de novo.'
  if (status === 401) return 'Seu acesso expirou ou foi revogado. Entre de novo em Configurações › Acesso.'
  if (status === 403) return 'Seu usuário não tem permissão para esta ação. Fale com o administrador.'
  if (status === 404) return 'Não encontramos este item. Ele pode ter sido excluído; atualize a página.'
  if (status === 409) return 'Este item foi alterado por outra pessoa. Atualize a página e tente de novo.'
  if (status === 413) return 'O conteúdo enviado é grande demais.'
  if (status === 429) return 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.'
  if (status >= 500) return 'O servidor não conseguiu responder agora. Tente de novo em alguns minutos; nada foi perdido.'
  return 'Não foi possível concluir a ação. Tente de novo.'
}

export class ErroMCP extends Error {
  status: number
  /** Corpo JSON da resposta de erro, quando o servidor manda detalhes (ex.: cliente_existente). */
  dados?: Record<string, any>
  constructor(status: number, mensagem: string, dados?: Record<string, any>) {
    super(mensagem)
    this.status = status
    this.dados = dados
  }
}

type CorpoJsonRpc = {
  jsonrpc: '2.0'
  id?: number
  method: string
  params?: unknown
}

export class ClienteMCP {
  token: string
  sessionId: string | null = null
  proximoId = 1

  constructor(token: string) {
    this.token = token
  }

  private async enviar(
    corpo: CorpoJsonRpc,
    { comResposta = true, podeReiniciar = true }: { comResposta?: boolean; podeReiniciar?: boolean } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.token}`,
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId

    const controlador = new AbortController()
    const limite = setTimeout(() => controlador.abort(), 170000)
    let resposta: Response
    try {
      resposta = await fetch(URL_MCP, {
        method: 'POST',
        headers,
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      })
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === 'AbortError') {
        throw new ErroMCP(0, 'A consulta demorou demais e foi interrompida. Tente novamente.')
      }
      throw new ErroMCP(0, 'Não foi possível conectar ao servidor. Confira sua conexão.')
    } finally {
      clearTimeout(limite)
    }

    const sid = resposta.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => '')
      if (resposta.status === 401) {
        throw new ErroMCP(401, 'Token inválido, expirado ou revogado. Confira o token ou peça um novo em /cadastro.')
      }
      if (resposta.status === 429) {
        const espera = resposta.headers.get('retry-after')
        throw new ErroMCP(429, `Limite de uso atingido. Tente de novo em ${espera ? espera + 's' : 'alguns instantes'}.`)
      }
      if ((resposta.status === 400 || resposta.status === 404) && podeReiniciar && this.sessionId) {
        this.sessionId = null
        await this.iniciar()
        return this.enviar(corpo, { comResposta, podeReiniciar: false })
      }
      // Corpo em texto puro do servidor só é mostrado quando é uma mensagem curta e legível.
      const legivel = texto && texto.length < 200 && !/^\s*[<{]/.test(texto) && resposta.status < 500
      throw new ErroMCP(resposta.status, legivel ? texto : mensagemPorStatus(resposta.status))
    }

    if (!comResposta) {
      await resposta.text().catch(() => {})
      return null
    }

    const tipo = resposta.headers.get('content-type') || ''
    const corpoTexto = await resposta.text()
    if (!corpoTexto) return null

    let dados: { error?: { message?: string }; result?: unknown } | null
    if (tipo.includes('text/event-stream')) {
      const linha = corpoTexto
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .pop()
      dados = linha ? JSON.parse(linha.slice(5).trim()) : null
    } else {
      dados = JSON.parse(corpoTexto)
    }
    if (dados?.error) {
      throw new ErroMCP(200, dados.error.message || 'O servidor recusou a requisição.')
    }
    return dados ? dados.result : null
  }

  async iniciar(): Promise<void> {
    this.proximoId = 1
    await this.enviar({
      jsonrpc: '2.0',
      id: this.proximoId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'astrajus-react', version: '0.1.0' },
      },
    })
    await this.enviar({ jsonrpc: '2.0', method: 'notifications/initialized' }, { comResposta: false })
  }

  async chamarFerramenta(nome: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.sessionId) await this.iniciar()
    const resultado = (await this.enviar({
      jsonrpc: '2.0',
      id: this.proximoId++,
      method: 'tools/call',
      params: { name: nome, arguments: args },
    })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | null
    if (resultado?.isError) {
      throw new ErroMCP(200, resultado.content?.[0]?.text || 'Não foi possível concluir a solicitação.')
    }
    const item = resultado?.content?.[0]
    if (!item || typeof item.text !== 'string') {
      throw new ErroMCP(200, 'Resposta vazia do servidor.')
    }
    try {
      return JSON.parse(item.text)
    } catch {
      throw new ErroMCP(200, item.text)
    }
  }
}

export const CHAVE_TOKEN = 'cnj_token'
export const CHAVE_TEMA = 'cnj_tema'
