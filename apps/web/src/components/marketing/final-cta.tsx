import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function FinalCta() {
  return (
    <section className="border-t border-border py-16 sm:py-24">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-4 text-center sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Pronto para ver seus próximos leads?
        </h2>
        <p className="max-w-xl text-lg text-muted-foreground">
          Entre no painel, escolha um nicho e uma UF, e acompanhe a coleta acontecer.
        </p>
        <Button asChild size="lg">
          <Link href="/login">
            Acessar o painel
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
