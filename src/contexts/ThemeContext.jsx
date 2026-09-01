import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();
const mediaQuery = '(prefers-color-scheme: dark)';

const initialDarkMode = () => {
  const storedPreference = localStorage.getItem('theme');
  if (storedPreference) return storedPreference === 'dark';
  return Boolean(window.matchMedia?.(mediaQuery).matches);
};

const updateThemeMetadata = (dark) => {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');

  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.setAttribute('content', dark ? 'black-translucent' : 'default');

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', dark ? '#141414' : '#f6f4ef');
};

export const useTheme = () => {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return theme;
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode);

  useEffect(() => {
    updateThemeMetadata(isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const preference = window.matchMedia(mediaQuery);
    const followSystemPreference = ({ matches }) => {
      if (!localStorage.getItem('theme')) setIsDarkMode(matches);
    };
    preference.addEventListener('change', followSystemPreference);
    return () => preference.removeEventListener('change', followSystemPreference);
  }, []);

  const toggleDarkMode = () => setIsDarkMode((current) => !current);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};
