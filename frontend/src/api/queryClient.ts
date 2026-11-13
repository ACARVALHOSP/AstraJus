import { QueryClient } from '@tanstack/react-query'

// Sem nova tentativa automática: erros de API aparecem na hora, como antes. Dados em cache são
// mostrados de imediato; ficam "frescos" por 20 s (sem nova busca ao trocar de tela) e depois são
// atualizados em segundo plano. Qualquer gravação (avisarDadosAlterados) atualiza antes disso.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 20_000 } },
})

let espera: number | undefined
// Após uma gravação, descarta o cache das telas fechadas (voltar a elas mostra o carregamento e os
// dados novos) e atualiza as consultas das telas abertas. Ações em lote disparam várias gravações
// seguidas: junta tudo numa atualização só.
export function avisarDadosAlterados() {
  window.clearTimeout(espera)
  espera = window.setTimeout(() => {
    queryClient.removeQueries({ type: 'inactive' })
    void queryClient.invalidateQueries({ type: 'active' })
  }, 150)
}
