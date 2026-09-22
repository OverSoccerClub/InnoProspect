import type { Metadata } from 'next';

import { ComplianceSection } from '@/components/marketing/compliance-section';
import { Features } from '@/components/marketing/features';
import { FinalCta } from '@/components/marketing/final-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

const TITLE = 'InnoProspect — prospecção B2B a partir do Google Maps';
const DESCRIPTION =
  'Busque empresas por nicho e cidade em qualquer UF do Brasil, transforme os resultados em leads organizados e aborde pelo WhatsApp com descadastro imediato e pausa automática de segurança.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    locale: 'pt_BR',
    siteName: 'InnoProspect',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

/**
 * Landing page pública (`/`) — item "layout premium". Rota liberada
 * explicitamente no `middleware.ts` (checagem exata `pathname === '/'`, ver
 * comentário lá). Tudo aqui é Server Component; nenhuma seção depende de
 * `useEffect`/fetch para aparecer — o hero (LCP) é HTML+CSS puro.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <ComplianceSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
