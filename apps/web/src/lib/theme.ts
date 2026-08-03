export type Theme = 'light' | 'dark';

/**
 * Chave única de localStorage para o tema — compartilhada entre o script
 * anti-flash (`components/theme/theme-script.tsx`, roda antes da hidratação)
 * e o `ThemeProvider` (client, roda depois). Nunca duplique essa string.
 */
export const THEME_STORAGE_KEY = 'inno-prospect-theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}
