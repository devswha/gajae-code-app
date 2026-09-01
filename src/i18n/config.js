import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enSidebar from './locales/en/sidebar.json';
import { isLanguageSupported } from './languages.js';

const LANGUAGE_LOADERS = [
  ['de', () => import('./locales/de/index.js')],
  ['fr', () => import('./locales/fr/index.js')],
  ['it', () => import('./locales/it/index.js')],
  ['ja', () => import('./locales/ja/index.js')],
  ['ko', () => import('./locales/ko/index.js')],
  ['ru', () => import('./locales/ru/index.js')],
  ['tr', () => import('./locales/tr/index.js')],
  ['zh-CN', () => import('./locales/zh-CN/index.js')],
  ['zh-TW', () => import('./locales/zh-TW/index.js')],
];

export const LANGUAGE_BUNDLES = Object.fromEntries(LANGUAGE_LOADERS);

const bundledEnglish = {
  common: enCommon,
  settings: enSettings,
  sidebar: enSidebar,
  chat: enChat,
  codeEditor: enCodeEditor,
};

const languageBackend = {
  type: 'backend',
  init() {},
  read(language, namespace, done) {
    const requestBundle = LANGUAGE_BUNDLES[language];
    if (!requestBundle) {
      done(null, {});
      return;
    }

    requestBundle()
      .then(({ default: translations }) => done(null, translations?.[namespace] ?? {}))
      .catch((error) => {
        console.error(`Failed to load ${language} translations:`, error);
        done(error, false);
      });
  },
};

const storedLanguage = () => {
  try {
    const value = localStorage.getItem('userLanguage');
    return value && isLanguageSupported(value) ? value : 'en';
  } catch {
    // Storage is unavailable in some embedded or privacy-restricted contexts.
    return 'en';
  }
};

const options = {
  resources: { en: bundledEnglish },
  partialBundledLanguages: true,
  lng: storedLanguage(),
  fallbackLng: 'en',
  load: 'currentOnly',
  debug: false,
  ns: ['common', 'settings', 'sidebar', 'chat', 'codeEditor'],
  defaultNS: 'common',
  keySeparator: '.',
  nsSeparator: ':',
  saveMissing: false,
  interpolation: { escapeValue: false },
  react: {
    useSuspense: false,
    bindI18n: 'languageChanged',
    bindI18nStore: false,
  },
  detection: {
    order: ['localStorage'],
    lookupLocalStorage: 'userLanguage',
    caches: ['localStorage'],
  },
};

i18n.use(languageBackend);
i18n.use(LanguageDetector);
i18n.use(initReactI18next);
export const i18nReady = i18n.init(options);

i18n.on('languageChanged', (language) => {
  try {
    localStorage.setItem('userLanguage', language);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }
});

export default i18n;
