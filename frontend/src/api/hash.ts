// Endereço da tela no hash da URL: "#/casos?id=123&aba=atividades".
// A parte depois do "?" leva os parâmetros que abrem a tela já no lugar certo (link direto).

export type Parametros = Record<string, string>

// Os valores vêm da URL (qualquer pessoa pode montar um link) e acabam em caminhos de API como
// /casos/<id>. Só aceitamos o formato de ids, números CNJ e rótulos simples; o resto é descartado.
const VALOR_SEGURO = /^[\w.:@-]{1,120}$/ // "@" para logins em formato de e-mail
// Busca por texto digitada pela pessoa (só filtra na tela, não vai para caminhos de API): aceita espaço e acento.
const TEXTO_LIVRE = new Set(['busca'])
const valorSeguro = (nome: string, valor: string) =>
  TEXTO_LIVRE.has(nome) ? valor.length >= 1 && valor.length <= 100 && !/[\u0000-\u001f]/.test(valor) : VALOR_SEGURO.test(valor)
const NOME_SEGURO = /^[A-Za-z][\w]{0,40}$/
const ABA_SEGURA = /^[a-z0-9-]{1,40}(\/[a-z0-9-]{1,40})?$/ // aceita um subnível: "integracoes/admin"

/** Texto do hash sem o "#/" inicial. */
export function chaveHash(hash: string): string {
  return hash.replace(/^#\/?/, '')
}

/** Lê o hash da URL: qual tela e quais parâmetros. Hash vazio ou inválido volta para a tela inicial. */
export function lerHash(hash: string, abaInicial: string): { aba: string; parametros: Parametros } {
  const bruto = chaveHash(hash)
  const corte = bruto.indexOf('?')
  const caminho = corte < 0 ? bruto : bruto.slice(0, corte)
  const aba = ABA_SEGURA.test(caminho) ? caminho : abaInicial
  const parametros: Parametros = {}
  if (corte >= 0) {
    for (const [nome, valor] of new URLSearchParams(bruto.slice(corte + 1))) {
      if (NOME_SEGURO.test(nome) && valorSeguro(nome, valor)) parametros[nome] = valor
    }
  }
  return { aba, parametros }
}

/** Monta o hash ("/casos?id=1") de uma tela com os parâmetros que podem ir para a URL.
 *  Vazios, objetos e valores fora do formato seguro ficam só na memória, não no endereço. */
export function montarHash(aba: string, payload?: unknown): string {
  const consulta = new URLSearchParams()
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [nome, valor] of Object.entries(payload)) {
      if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') continue
      const texto = String(valor)
      if (NOME_SEGURO.test(nome) && valorSeguro(nome, texto)) consulta.set(nome, texto)
    }
  }
  const texto = consulta.toString()
  return texto ? `/${aba}?${texto}` : `/${aba}`
}
