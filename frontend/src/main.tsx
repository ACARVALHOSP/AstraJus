import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@radix-ui/themes/styles.css'
import './index.scss'
import './routes/casos/processos-radix.css'
import App from './App.tsx'

// Sem nova tentativa automática: erros de API aparecem na hora, como antes. Dados em cache são
// mostrados de imediato; ficam "frescos" por 20 s (sem nova busca ao trocar de tela) e depois são
// atualizados em segundo plano. Qualquer gravação (EVENTO_DADOS_ALTERADOS) atualiza antes disso.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 20_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
