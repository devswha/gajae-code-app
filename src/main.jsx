import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
// Pretendard (self-hosted, dynamic-subset) — Korean/Latin sans with real Hangul
// glyphs, so Korean no longer falls back to a serif (궁서체). Loaded before app CSS.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import 'katex/dist/katex.min.css'
import { applyInterfaceFontSize, readInterfaceFontSize } from './utils/interfaceFontSize.ts'

// Apply the persisted interface font size before first paint so the UI does
// not flash at the default size.
applyInterfaceFontSize(readInterfaceFontSize())

const enableReactInspectionTools =
  import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== '1'

if (enableReactInspectionTools) {
  void import('react-grab')
  void import('react-scan')
}

// Initialize i18n
import './i18n/config.js'

// Unregister any legacy PWA service worker left from prior versions.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {})
}
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
