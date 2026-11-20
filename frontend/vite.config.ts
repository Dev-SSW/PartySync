import { randomUUID } from 'node:crypto'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appVersion = command === 'build' ? randomUUID() : ''
  const versionManifest: Plugin = {
    name: 'partysync-app-version', apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: appVersion }) })
    },
  }
  return {
    plugins: [react(), tailwindcss(), versionManifest],
    define: { 'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(appVersion) },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: false,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      clearMocks: true,
    },
  }
})
