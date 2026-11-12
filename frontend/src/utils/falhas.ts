/** Falha ao baixar o arquivo de uma tela (ex.: nova versão publicada com a página antiga aberta).
 *  Nesse caso "tentar de novo" não adianta: o arquivo antigo não existe mais e só recarregar resolve. */
export function ehFalhaDeCarregamento(erro: unknown): boolean {
  const texto = erro instanceof Error ? `${erro.name} ${erro.message}` : String(erro ?? '')
  return /dynamically imported module|importing a module script failed|ChunkLoadError|Loading chunk .* failed|Unable to preload CSS/i.test(texto)
}
