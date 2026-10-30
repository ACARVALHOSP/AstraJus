import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/novo/',
  plugins: [react()],
  resolve: {
    alias: { '~@ibm/plex': fileURLToPath(new URL('./node_modules/@ibm/plex', import.meta.url)) },
  },
  server: {
    proxy: {
      // backend Python (server.py) rodando em paralelo durante o desenvolvimento
      '/mcp': 'http://localhost:8000',
      '/admin': 'http://localhost:8000',
      '/integracoes': 'http://localhost:8000',
      '/cep': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
      '/casos': 'http://localhost:8000',
      '/cjpg-arvore': 'http://localhost:8000',
      '/clientes': 'http://localhost:8000',
      '/lancamentos': 'http://localhost:8000',
      '/notificacoes': 'http://localhost:8000',
      '/pagamentos': 'http://localhost:8000',
      '/pendentes': 'http://localhost:8000',
      '/publicacoes-oab': 'http://localhost:8000',
      '/responsaveis': 'http://localhost:8000',
    },
  },
})
