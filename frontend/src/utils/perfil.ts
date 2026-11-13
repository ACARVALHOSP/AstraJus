// Validação do formulário "Meu perfil" (as mesmas regras do servidor).
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Campos que mudaram e a mensagem de erro, se houver. Separado do componente para ser testável. */
export function avaliarPerfil(atual: { nome: string; email: string; foto: string }, novo: { nome: string; email: string; foto: string }) {
  const nome = novo.nome.trim(), email = novo.email.trim()
  let erro: string | null = null
  if (!nome) erro = 'Informe o nome de exibição.'
  else if (nome.length > 200) erro = 'O nome pode ter até 200 caracteres.'
  else if (!email) erro = 'Informe o e-mail.'
  else if (!EMAIL_VALIDO.test(email) || email.length > 254) erro = 'Informe um e-mail válido.'
  const mudancas: Record<string, string> = {}
  if (nome !== atual.nome.trim()) mudancas.nome_completo = nome
  if (email !== atual.email.trim()) mudancas.email = email
  if (novo.foto !== atual.foto) mudancas.foto = novo.foto
  return { erro, mudancas, alterado: Object.keys(mudancas).length > 0 }
}
