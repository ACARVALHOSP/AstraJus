// A foto do perfil é guardada no servidor como imagem pequena (data URL). O navegador reduz e
// recorta no centro antes de enviar, para não passar do limite de tamanho do servidor.
export const LADO_FOTO = 256
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']
const LIMITE_ENTRADA = 15 * 1024 * 1024
/** Limite do servidor (caracteres do data URL); a imagem reduzida costuma ter bem menos. */
export const LIMITE_DATA_URL = 150_000

/** Quadrado de origem (centralizado) que vira a foto: devolve [x, y, lado]. */
export function recorteQuadrado(largura: number, altura: number): [number, number, number] {
  const lado = Math.min(largura, altura)
  return [Math.floor((largura - lado) / 2), Math.floor((altura - lado) / 2), lado]
}

export function validarArquivoFoto(arquivo: { type: string; size: number }): string | null {
  if (!TIPOS_FOTO.includes(arquivo.type)) return 'Use uma imagem JPEG, PNG ou WebP.'
  if (arquivo.size > LIMITE_ENTRADA) return 'A imagem é grande demais. Escolha uma de até 15 MB.'
  return null
}

/** Lê o arquivo, recorta no centro, reduz para 256 px e devolve um JPEG em data URL. */
export async function reduzirFoto(arquivo: File): Promise<string> {
  const erro = validarArquivoFoto(arquivo)
  if (erro) throw new Error(erro)
  let imagem: ImageBitmap
  try { imagem = await createImageBitmap(arquivo) } catch { throw new Error('Não foi possível ler essa imagem. Tente outro arquivo.') }
  const [x, y, lado] = recorteQuadrado(imagem.width, imagem.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LADO_FOTO
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.')
  ctx.fillStyle = '#fff'  // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, LADO_FOTO, LADO_FOTO)
  ctx.drawImage(imagem, x, y, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO)
  imagem.close?.()
  for (const qualidade of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/jpeg', qualidade)
    if (url.length <= LIMITE_DATA_URL) return url
  }
  throw new Error('Não foi possível reduzir a imagem o bastante. Tente outra.')
}
