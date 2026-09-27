import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const mediaQuery = '(prefers-color-scheme: dark)';
const STORAGE_KEY = 'theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

type ThemeContextValue = {
  /** What is on screen right now. */
  isDarkMode: boolean;
  /** What the user chose; `system` follows the OS appearance live. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** Flips what is on screen; from System that pins the opposite theme. */
  toggleDarkMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * An explicit choice is stored; following the system is the absence of one.
 * Only a user's choice writes the key - the provider never persists what it
 * merely derived, or the first launch would pin the system theme forever.
 */
const readPreference = (): ThemePreference => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
};

const systemPrefersDark = (): boolean => Boolean(window.matchMedia?.(mediaQuery).matches);

const applyTheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark);

  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.setAttribute('content', dark ? 'black-translucent' : 'default');

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', dark ? '#141414' : '#f6f4ef');
};

export const useTheme = (): ThemeContextValue => {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return theme;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [preference, setPreferenceState] = useState(readPreference);
  const [systemIsDark, setSystemIsDark] = useState(systemPrefersDark);
  const isDarkMode = preference === 'system' ? systemIsDark : preference === 'dark';

  useEffect(() => {
    applyTheme(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(mediaQuery);
    const follow = ({ matches }: MediaQueryListEvent) => setSystemIsDark(matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  const setPreference = (next: ThemePreference) => {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    setPreferenceState(next);
  };

  const toggleDarkMode = () => setPreference(isDarkMode ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ isDarkMode, preference, setPreference, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
