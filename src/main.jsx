import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import 'katex/dist/katex.min.css'
import { applyInterfaceFontSize, readInterfaceFontSize } from './utils/interfaceFontSize.ts'
import { i18nReady } from './i18n/config.js'
import { SERVICE_WORKER_URL } from './hooks/useWebPush.ts'

const prepareDocument = () => {
  applyInterfaceFontSize(readInterfaceFontSize())
}

const mountApplication = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

prepareDocument()

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== '1') {
  void import('react-grab')
  void import('react-scan')
}

// The worker only receives push and routes notification taps; it caches
// nothing (see public/sw.js). Registering on every start keeps an existing
// push subscription attached to the current worker script.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
    // Unsupported origins (the desktop shell, plain http on a LAN) still run the app.
  })
}

i18nReady.finally(mountApplication)
