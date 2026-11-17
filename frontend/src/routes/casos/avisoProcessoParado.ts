// Texto da opção "Avisar se o processo ficar parado" na ficha. Sem React, para testar em
// tests/aviso-processo-parado.test.mjs.

export type AvisoProcessoParado = { silenciado: boolean; rotina_ativa: boolean; dias: number }

/** Explicação sob o interruptor. Depende de a rotina estar ligada no escritório e de o processo estar silenciado. */
export function explicacaoAviso(estado: AvisoProcessoParado): string {
  if (!estado.rotina_ativa) {
    return 'A rotina "Processo parado" está desligada no escritório (Administração › Automações). Sua escolha vale quando ela for ligada.'
  }
  if (estado.silenciado) return 'Este processo não gera aviso de parado, mesmo sem movimentação.'
  return `O responsável é avisado se o processo ficar ${estado.dias} dias ou mais sem movimentação.`
}
