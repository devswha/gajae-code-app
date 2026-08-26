/**
 * i18n Configuration
 *
 * English is bundled: it is the fallback every other language falls through to,
 * and the app must be able to render before any network work happens. The other
 * nine languages are chunks, fetched when one is actually chosen.
 *
 * They used to be static imports, all ten of them - roughly 516KB of JSON in
 * the main bundle so that a user could read the ~52KB written in their own
 * language. The `useSuspense: true` comment claiming lazy-loading had been
 * there the whole time; nothing was ever lazy.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enSidebar from './locales/en/sidebar.json';
import { languages } from './languages.js';

/**
 * Every language the selector offers, except the bundled one. French was
 * offered by `languages.js` and never registered here, so choosing it silently
 * served English; a table built from one place cannot drift like that again.
 */
export const LANGUAGE_BUNDLES = {
  de: () => import('./locales/de/index.js'),
  fr: () => import('./locales/fr/index.js'),
  it: () => import('./locales/it/index.js'),
  ja: () => import('./locales/ja/index.js'),
  ko: () => import('./locales/ko/index.js'),
  ru: () => import('./locales/ru/index.js'),
  tr: () => import('./locales/tr/index.js'),
  'zh-CN': () => import('./locales/zh-CN/index.js'),
  'zh-TW': () => import('./locales/zh-TW/index.js'),
};

/**
 * i18next asks for one namespace at a time; a language arrives as one chunk
 * holding all five, so the first namespace pays for the request and the rest
 * are already resolved.
 */
const lazyLanguageBackend = {
  type: 'backend',
  init: () => {},
  read(language, namespace, callback) {
    const load = LANGUAGE_BUNDLES[language];
    if (!load) {
      // English is bundled, and anything else is not a language we ship.
      callback(null, {});
      return;
    }

    load()
      .then((bundle) => callback(null, bundle.default?.[namespace] ?? {}))
      .catch((error) => {
        console.error(`Failed to load ${language} translations:`, error);
        // `false` tells i18next not to retry; English still renders.
        callback(error, false);
      });
  },
};

// Get saved language preference from localStorage
const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem('userLanguage');
    // Validate that the saved language is supported
    if (saved && languages.some(lang => lang.value === saved)) {
      return saved;
    }
    return 'en';
  } catch {
    return 'en';
  }
};

/**
 * Resolves once the starting language is in the store. `main.jsx` waits on it
 * so a non-English user never sees a frame of English first.
 */
export const i18nReady = i18n
  .use(lazyLanguageBackend)
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Only the fallback is bundled; the backend above supplies the rest.
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
      },
    },

    // Required for a bundled language to coexist with a backend: without it
    // i18next treats `resources` as the complete set and never asks.
    partialBundledLanguages: true,

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // 'zh-CN' must not send the backend looking for a 'zh' bundle we do not ship.
    load: 'currentOnly',

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'sidebar', 'chat', 'codeEditor'],
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      // The wait happens once in main.jsx, before the first render, so no
      // component ever suspends on a translation.
      useSuspense: false,
      bindI18n: 'languageChanged', // Re-render on language change
      bindI18nStore: false, // Don't re-render on resource changes
    },

    // Detection options
    detection: {
      // Order of language detection (local storage first)
      order: ['localStorage'],

      // Keys to look for in localStorage
      lookupLocalStorage: 'userLanguage',

      // Cache user language
      caches: ['localStorage'],
    },
  });

// Save language preference when it changes
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('userLanguage', lng);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }
});

export default i18n;
