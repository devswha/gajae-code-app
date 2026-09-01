import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { getConnectableHost, normalizeLoopbackHost, parseAllowedHosts } from './shared/networkHosts.js'

const chunkGroups = {
  'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react-router-dom', '@tanstack/react-query', 'zustand'],
  'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex', 'katex'],
  'vendor-syntax': ['react-syntax-highlighter'],
  'vendor-icons': ['lucide-react'],
  'vendor-i18n': ['i18next', 'i18next-browser-languagedetector', 'react-i18next'],
  'vendor-tools': ['cmdk', 'jszip', 'react-dropzone']
}

function websocketProxy(host) {
  return { target: `ws://${host}`, ws: true }
}

function buildServer(env) {
  const requestedHost = env.HOST || '0.0.0.0'
  const target = `${getConnectableHost(requestedHost)}:${env.SERVER_PORT || env.PORT || 3001}`
  const allowedHosts = parseAllowedHosts(env.ALLOWED_HOSTS)

  return {
    host: normalizeLoopbackHost(requestedHost),
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    port: parseInt(env.VITE_PORT) || 5173,
    proxy: {
      '/api': `http://${target}`,
      '/ws': websocketProxy(target),
      '/shell': websocketProxy(target),
      '/plugin-ws': websocketProxy(target)
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: buildServer(env),
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: { output: { manualChunks: chunkGroups } }
    }
  }
})
