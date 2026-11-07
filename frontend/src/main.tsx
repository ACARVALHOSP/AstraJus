import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@radix-ui/themes/styles.css'
import './index.scss'
import './routes/casos/processos-radix.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
