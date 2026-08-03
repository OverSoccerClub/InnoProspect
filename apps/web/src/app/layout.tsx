import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';

import { ThemeProvider } from '@/components/theme/theme-provider';
import { ThemeScript } from '@/components/theme/theme-script';
import { cn } from '@/lib/utils';

import './globals.css';

// Self-hospedado no build pelo next/font (respeita a CSP `font-src 'self'`
// já em vigor — nada é buscado de CDN externo em runtime). Inter é o corpo e
// as tabelas densas de leads (ótima legibilidade em 12–14px, tabular-nums
// nativo); Plus Jakarta Sans é a voz de título/CTA que dá a identidade
// "premium" sem depender de peso/tamanho apenas. Ver DESIGN-SYSTEM.md §2.
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'InnoProspect',
  description: 'Plataforma de prospecção B2B — leads e disparo de WhatsApp.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1318' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: a classe "dark" é aplicada por ThemeScript
    // (inline, pré-hidratação) e pode divergir do HTML renderizado no
    // servidor de propósito — é o jeito documentado de evitar flash de tema
    // errado sem o React reclamar de um mismatch esperado.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={cn(inter.variable, jakarta.variable, 'min-h-screen font-sans antialiased')}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
