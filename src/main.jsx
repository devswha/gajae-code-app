import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
// Pretendard (self-hosted, dynamic-subset) — Korean/Latin sans with real Hangul
// glyphs, so Korean no longer falls back to a serif (궁서체). Loaded before app CSS.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import 'katex/dist/katex.min.css'
import { applyInterfaceFontSize, readInterfaceFontSize } from './utils/interfaceFontSize.ts'
// Initialize i18n. Only English is bundled, so a user whose language is a
// chunk waits for it here rather than reading a frame of English first.
import { i18nReady } from './i18n/config.js'

// Apply the persisted interface font size before first paint so the UI does
// not flash at the default size.
applyInterfaceFontSize(readInterfaceFontSize())

const enableReactInspectionTools =
  import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== '1'

if (enableReactInspectionTools) {
  void import('react-grab')
  void import('react-scan')
}

// Unregister any legacy PWA service worker left from prior versions.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {})
}
// `finally`, not `then`: a locale chunk that fails to load must not cost the
// user their app. English is already in the store.
i18nReady.finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
