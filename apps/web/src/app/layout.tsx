import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'InnoProspect',
  description: 'Plataforma de prospecção B2B — leads e disparo de WhatsApp.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
