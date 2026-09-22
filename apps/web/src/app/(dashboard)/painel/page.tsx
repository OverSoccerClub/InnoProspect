import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { OverviewKpis } from '@/components/dashboard/overview-kpis';
import { QueueHealthBanner } from '@/components/dashboard/queue-health-banner';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Painel — InnoProspect',
};

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Abertura do painel logado (era `/`, agora `/painel` — item "layout
 * premium"). Server Component: lê a sessão real (`auth()`, `lib/auth.ts`,
 * mesmo import que `api/auth/[...nextauth]/route.ts` já usa) só para o
 * primeiro nome da saudação — nada de estado de UI aqui, isso fica nos
 * Client Components abaixo (`QueueHealthBanner`, `OverviewKpis`), que já
 * tratam loading/erro/vazio na chamada às APIs reais.
 */
export default async function PainelPage() {
  const session = await auth();
  const firstName = session?.user?.name?.trim().split(' ')[0];
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/[0.08] blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Sua visão geral do InnoProspect
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Acompanhe suas buscas ativas, seus leads e a saúde da coleta — tudo em um lugar só.
            </p>
          </div>
          <Button asChild size="lg" className="w-fit">
            <Link href="/buscas/nova">
              <Plus aria-hidden="true" />
              Nova busca
            </Link>
          </Button>
        </div>
      </section>

      <QueueHealthBanner />

      <OverviewKpis />
    </div>
  );
}
