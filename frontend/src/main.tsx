import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@radix-ui/themes/styles.css'
import './index.scss'
import './routes/casos/processos-radix.css'
import App from './App.tsx'

// Sem nova tentativa automática: erros de API aparecem na hora, como antes. Dados em cache são
// mostrados de imediato e atualizados em segundo plano (staleTime 0).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
