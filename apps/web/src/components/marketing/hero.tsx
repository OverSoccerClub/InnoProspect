import Link from 'next/link';
import { ArrowRight, MapPinned } from 'lucide-react';

import { ProductMockup } from '@/components/marketing/product-mockup';
import { Button } from '@/components/ui/button';

/**
 * Hero da landing — não depende de JS pra aparecer (Server Component puro,
 * `ProductMockup` também é), então o LCP é só HTML+CSS desde o primeiro
 * paint. O halo de fundo usa o mesmo tratamento visual do `(auth)/layout.tsx`
 * (blur sutil da cor de marca), pra manter a mesma "voz" entre login e
 * marketing.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[40rem] w-[60rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.08] blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8 lg:py-28 lg:px-8">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground shadow-xs">
            <MapPinned className="size-3.5 text-primary" aria-hidden="true" />
            Prospecção B2B a partir do Google Maps
          </span>

          <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem]">
            Encontre leads B2B qualificados em qualquer cidade do Brasil, prontos para abordar pelo WhatsApp.
          </h1>

          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            O InnoProspect varre o Google Maps por nicho e cidade, transforma cada resultado em um lead
            organizado — telefone, tipo de linha, site, avaliação — e mostra o progresso da coleta em tempo
            real. Você decide o nicho e a região; o sistema entrega a lista pronta pra abordagem.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="w-fit">
              <Link href="/login">
                Acessar o painel
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Link
              href="#como-funciona"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              Ver como funciona
            </Link>
          </div>
        </div>

        <ProductMockup />
      </div>
    </section>
  );
}
