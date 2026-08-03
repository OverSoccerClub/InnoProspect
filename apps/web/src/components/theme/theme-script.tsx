import { THEME_STORAGE_KEY } from '@/lib/theme';

// Roda ANTES da hidratação (script inline no <head>, permitido pela CSP
// `script-src 'self' 'unsafe-inline'` já em vigor — ver next.config.ts).
// Sem isso, o React só decide claro/escuro depois de montar, e a tela pisca
// no tema errado por um frame ("flash of wrong theme").
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

/** Server Component — só emite o <script> inline, sem estado nem hooks. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
