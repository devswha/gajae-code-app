import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import 'katex/dist/katex.min.css'
import { applyInterfaceFontSize, readInterfaceFontSize } from './utils/interfaceFontSize.ts'
import { i18nReady } from './i18n/config.js'

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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {
      // A failed cleanup must not block startup.
    })
}

i18nReady.finally(mountApplication)
