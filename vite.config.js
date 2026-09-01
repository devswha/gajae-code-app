import { URL, fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { loadEnv, defineConfig } from 'vite'

import { getConnectableHost, normalizeLoopbackHost, parseAllowedHosts } from './shared/networkHosts.js'

const browserSourceDirectory = fileURLToPath(new URL('./src', import.meta.url))

// These stable groups keep frequently used editor dependencies out of the application chunk.
const dependencyChunks = {
  'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react-router-dom', '@tanstack/react-query', 'zustand'],
  'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex', 'katex'],
  'vendor-syntax': ['react-syntax-highlighter'],
  'vendor-icons': ['lucide-react'],
  'vendor-i18n': ['i18next', 'i18next-browser-languagedetector', 'react-i18next'],
  'vendor-tools': ['cmdk', 'react-dropzone'],
}

function websocketTarget(address) {
  return { target: `ws://${address}`, ws: true }
}

function developmentProxy(address) {
  return {
    '/api': `http://${address}`,
    '/ws': websocketTarget(address),
    '/shell': websocketTarget(address),
    '/plugin-ws': websocketTarget(address),
  }
}

function developmentServer(environment) {
  const requestedHost = environment.HOST || '0.0.0.0'
  const servicePort = environment.SERVER_PORT || environment.PORT || 3001
  const upstreamAddress = `${getConnectableHost(requestedHost)}:${servicePort}`
  const allowedHosts = parseAllowedHosts(environment.ALLOWED_HOSTS)

  return {
    host: normalizeLoopbackHost(requestedHost),
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    port: parseInt(environment.VITE_PORT) || 5173,
    proxy: developmentProxy(upstreamAddress),
  }
}

function reactWithCompiler() {
  return react({
    babel: {
      plugins: [['babel-plugin-react-compiler', {}]],
    },
  })
}

function browserAliases() {
  return { '@': browserSourceDirectory }
}

function productionBuild() {
  return {
    chunkSizeWarningLimit: 1000,
    rollupOptions: { output: { manualChunks: dependencyChunks } },
    outDir: 'dist',
  }
}

function applicationConfiguration(mode) {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
    server: developmentServer(environment),
    plugins: [reactWithCompiler()],
    resolve: { alias: browserAliases() },
    build: productionBuild(),
  }
}

const viteConfiguration = defineConfig(({ mode }) => applicationConfiguration(mode))

export default viteConfiguration
