import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // backend Python (server.py) rodando em paralelo durante o desenvolvimento
      '/mcp': 'http://localhost:8000',
      '/integracoes': 'http://localhost:8000',
      '/cep': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
    },
  },
})
