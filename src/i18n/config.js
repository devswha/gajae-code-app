/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - Lazy-loading of translation namespaces
 * - Language detection from localStorage
 * - Fallback to English for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation resources
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enSidebar from './locales/en/sidebar.json';
import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
import koCommon from './locales/ko/common.json';
import koSettings from './locales/ko/settings.json';
import koSidebar from './locales/ko/sidebar.json';
import koChat from './locales/ko/chat.json';
import koCodeEditor from './locales/ko/codeEditor.json';
import zhCommon from './locales/zh-CN/common.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhSidebar from './locales/zh-CN/sidebar.json';
import zhChat from './locales/zh-CN/chat.json';
import zhCodeEditor from './locales/zh-CN/codeEditor.json';
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaSidebar from './locales/ja/sidebar.json';
import jaChat from './locales/ja/chat.json';
import jaCodeEditor from './locales/ja/codeEditor.json';
import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruSidebar from './locales/ru/sidebar.json';
import ruChat from './locales/ru/chat.json';
import ruCodeEditor from './locales/ru/codeEditor.json';
import deCommon from './locales/de/common.json';
import deSettings from './locales/de/settings.json';
import deSidebar from './locales/de/sidebar.json';
import deChat from './locales/de/chat.json';
import deCodeEditor from './locales/de/codeEditor.json';
import trCommon from './locales/tr/common.json';
import trSettings from './locales/tr/settings.json';
import trSidebar from './locales/tr/sidebar.json';
import trChat from './locales/tr/chat.json';
import trCodeEditor from './locales/tr/codeEditor.json';
import itCommon from './locales/it/common.json';
import itSettings from './locales/it/settings.json';
import itSidebar from './locales/it/sidebar.json';
import itChat from './locales/it/chat.json';
import itCodeEditor from './locales/it/codeEditor.json';
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWSidebar from './locales/zh-TW/sidebar.json';
import zhTWChat from './locales/zh-TW/chat.json';
import zhTWCodeEditor from './locales/zh-TW/codeEditor.json';
// Import supported languages configuration
import { languages } from './languages.js';

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

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Resources containing all translations
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
      },
      ko: {
        common: koCommon,
        settings: koSettings,
        sidebar: koSidebar,
        chat: koChat,
        codeEditor: koCodeEditor,
      },
      'zh-CN': {
        common: zhCommon,
        settings: zhSettings,
        sidebar: zhSidebar,
        chat: zhChat,
        codeEditor: zhCodeEditor,
      },
      ja: {
        common: jaCommon,
        settings: jaSettings,
        sidebar: jaSidebar,
        chat: jaChat,
        codeEditor: jaCodeEditor,
      },
      ru: {
        common: ruCommon,
        settings: ruSettings,
        sidebar: ruSidebar,
        chat: ruChat,
        codeEditor: ruCodeEditor,
      },
      de: {
        common: deCommon,
        settings: deSettings,
        sidebar: deSidebar,
        chat: deChat,
        codeEditor: deCodeEditor,
      },
      tr: {
        common: trCommon,
        settings: trSettings,
        sidebar: trSidebar,
        chat: trChat,
        codeEditor: trCodeEditor,
      },
      it: {
        common: itCommon,
        settings: itSettings,
        sidebar: itSidebar,
        chat: itChat,
        codeEditor: itCodeEditor,
      },
      'zh-TW': {
        common: zhTWCommon,
        settings: zhTWSettings,
        sidebar: zhTWSidebar,
        chat: zhTWChat,
        codeEditor: zhTWCodeEditor,
      },
    },

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

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
      useSuspense: true, // Use Suspense for lazy-loading
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
