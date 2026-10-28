const URL_MCP = '/mcp'

export class ErroMCP extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
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
      throw new ErroMCP(resposta.status, texto || `Falha inesperada (HTTP ${resposta.status}).`)
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
    return this.enviar({
      jsonrpc: '2.0',
      id: this.proximoId++,
      method: 'tools/call',
      params: { name: nome, arguments: args },
    })
  }
}

export const CHAVE_TOKEN = 'cnj_token'
