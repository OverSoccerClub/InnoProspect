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
 *
 * Rodada de refinamento (2026-09-22): a 1ª versão tinha um título de 97
 * caracteres ocupando 6 linhas — hero premium fica em 2-3. Encurtei o
 * título e movi o detalhe (nicho/cidade/telefone/progresso) pro subtítulo,
 * e dei mais peso ao mockup (coluna mais larga, `items-start` em vez de
 * `items-center` pra não deixar vazio embaixo dele) e menos respiro embaixo
 * do CTA (a faixa vazia antes de "Como funciona" também foi reportada).
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[40rem] w-[60rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.08] blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-8 lg:px-8 lg:pb-24 lg:pt-24">
        <div className="flex flex-col items-start gap-6 lg:pt-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground shadow-xs">
            <MapPinned className="size-3.5 text-primary" aria-hidden="true" />
            Prospecção B2B a partir do Google Maps
          </span>

          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Leads B2B prontos para o WhatsApp.
          </h1>

          <p className="max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
            O InnoProspect varre o Google Maps por nicho e cidade, em qualquer UF do Brasil, e organiza cada
            resultado com telefone, tipo de linha e site. Progresso da coleta em tempo real, do primeiro
            município ao último.
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
