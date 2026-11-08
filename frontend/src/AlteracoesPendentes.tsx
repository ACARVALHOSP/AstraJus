import { useEffect, useId, useState } from 'react'
import { AlertDialog, Button, Flex } from '@radix-ui/themes'

// Registro dos formulários com alterações ainda não salvas. Qualquer saída (menu, link, botão
// voltar, troca de aba, fechar janela) passa por confirmarSaida, que pergunta antes de descartar.
const pendentes = new Set<string>()
let abrirDialogo: ((acao: () => void) => void) | null = null

export function temAlteracoesPendentes() {
  return pendentes.size > 0
}

/** Executa `acao` direto, ou depois de a pessoa confirmar que quer descartar as alterações. */
export function confirmarSaida(acao: () => void) {
  if (!pendentes.size || !abrirDialogo) { acao(); return }
  abrirDialogo(() => { pendentes.clear(); acao() })
}

/** Marca este formulário como "com alterações não salvas" enquanto `pendente` for verdadeiro. */
export function useAlteracoesPendentes(pendente: boolean) {
  const id = useId()
  useEffect(() => {
    if (!pendente) { pendentes.delete(id); return }
    pendentes.add(id)
    // Fechar a aba ou recarregar: o navegador mostra o próprio aviso.
    const aoSair = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', aoSair)
    return () => { pendentes.delete(id); window.removeEventListener('beforeunload', aoSair) }
  }, [id, pendente])
}

/** Diálogo único de confirmação; fica na raiz do aplicativo. */
export function DialogoSaida() {
  const [acao, setAcao] = useState<(() => void) | null>(null)
  useEffect(() => {
    abrirDialogo = (a) => setAcao(() => a)
    return () => { abrirDialogo = null }
  }, [])
  return (
    <AlertDialog.Root open={acao !== null} onOpenChange={(aberto) => { if (!aberto) setAcao(null) }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Sair sem salvar?</AlertDialog.Title>
        <AlertDialog.Description>
          Há alterações que ainda não foram salvas. Se sair agora, elas serão perdidas.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Continuar editando</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={() => { const a = acao; setAcao(null); a?.() }}>Sair sem salvar</Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
