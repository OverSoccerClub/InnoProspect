import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DashboardSummary } from '@/types/dashboard';

const WEEKDAY_DATE = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function buildStatusLine(summary: DashboardSummary): string {
  const running = summary.searches.running;
  const runningPart =
    running === 0 ? 'Nenhuma busca rodando agora' : `${running} ${pluralize(running, 'busca rodando', 'buscas rodando')}`;
  const leadsPart = `${summary.leads.createdLast7d.toLocaleString('pt-BR')} ${pluralize(summary.leads.createdLast7d, 'lead novo', 'leads novos')} esta semana`;
  return `${runningPart} · ${leadsPart}`;
}

function initials(name: string | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'U';
}

/**
 * Hero de boas-vindas — recebe `summary` já carregado por
 * `DashboardContent` (não busca nada sozinho: é puramente apresentacional,
 * fonte única de dado é `useDashboardSummary`). Avatar com iniciais + data
 * por extenso + frase que reflete o estado real do dia, não um rótulo fixo
 * ("Sua visão geral do InnoProspect" foi reprovado por não dizer nada).
 */
export function SummaryHero({
  greeting,
  firstName,
  summary,
}: {
  greeting: string;
  firstName?: string;
  summary: DashboardSummary;
}) {
  // `capitalize` (CSS) maiusculiza CADA palavra ("Terça-Feira, 22 De
  // Setembro") — errado em português, que só maiusculiza a primeira letra
  // da frase. Capitalizar só o 1º caractere em JS é o jeito certo aqui.
  const todayRaw = WEEKDAY_DATE.format(new Date());
  const today = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1);

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/[0.07] via-card to-card p-6 shadow-sm sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/[0.1] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-16 size-56 rounded-full bg-warning/[0.08] blur-3xl"
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="hidden shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-lg font-semibold text-primary sm:flex sm:size-14"
          >
            {initials(firstName)}
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{today}</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-1.5 max-w-xl text-pretty text-sm font-medium text-foreground/80">{buildStatusLine(summary)}</p>
          </div>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link href="/buscas/nova">
            <Plus aria-hidden="true" />
            Nova busca
          </Link>
        </Button>
      </div>
    </section>
  );
}
