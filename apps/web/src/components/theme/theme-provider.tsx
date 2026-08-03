'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { isTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Não lê o tema real no primeiro render (SSR não tem `document`) — o valor
 * inicial é sempre 'light' para bater com o HTML enviado pelo servidor, e o
 * `useEffect` abaixo sincroniza com a classe que `ThemeScript` já aplicou em
 * `<html>` antes da hidratação. Isso evita erro de hidratação sem depender
 * de `theme` para nenhuma decisão visual neste componente (quem decide a cor
 * é sempre a classe `.dark` + os tokens CSS, não React).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage indisponível (modo privado restrito etc.) — o tema
      // ainda funciona nesta sessão, só não persiste entre visitas.
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, applyTheme]);

  // Mantém abas sincronizadas entre si quando o usuário troca o tema em uma
  // e volta para outra já aberta.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) {
        document.documentElement.classList.toggle('dark', event.newValue === 'dark');
        setThemeState(event.newValue);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: applyTheme, toggleTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de <ThemeProvider>.');
  return ctx;
}
