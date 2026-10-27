import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001',
    },
  },
  test: {
    pool: 'threads',
    include: ['tests/**/*.{test,spec}.{js,jsx}'],
    exclude: ['tests/e2e/**'],
    maxWorkers: 1,
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
  },
})
