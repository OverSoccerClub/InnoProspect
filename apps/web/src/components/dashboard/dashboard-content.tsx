'use client';

import type { CSSProperties } from 'react';
import { Radar, Smartphone, TrendingUp, Users } from 'lucide-react';

import { LeadsAreaChart } from '@/components/dashboard/charts/area-chart';
import { CompareBars } from '@/components/dashboard/charts/compare-bars';
import { ProportionRing } from '@/components/dashboard/charts/proportion-ring';
import { Sparkline } from '@/components/dashboard/charts/sparkline';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { FirstAccessChecklist } from '@/components/dashboard/first-access-checklist';
import { IndicatorCard } from '@/components/dashboard/indicator-card';
import { QueueHealthBanner } from '@/components/dashboard/queue-health-banner';
import { RecentLeads } from '@/components/dashboard/recent-leads';
import { RecentSearches } from '@/components/dashboard/recent-searches';
import { StatusFunnel } from '@/components/dashboard/status-funnel';
import { SummaryHero } from '@/components/dashboard/summary-hero';
import { SystemHealthCard } from '@/components/dashboard/system-health-card';
import { TopListCard } from '@/components/dashboard/top-list-card';
import { ErrorState } from '@/components/common/error-state';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';

/** `--stagger-delay` em passos de 60ms — ver `.inno-stagger-in` em globals.css. Desliga sozinho em prefers-reduced-motion. */
function stagger(index: number): CSSProperties {
  return { '--stagger-delay': `${index * 60}ms` } as CSSProperties;
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * Orquestrador do painel — fonte única de dado (`useDashboardSummary`,
 * `GET /api/v1/dashboard/summary`), decide entre o estado de primeiro
 * acesso (zero leads — produção real começa assim) e o painel rico. Ver
 * DESIGN-SYSTEM.md §9.4 para a hierarquia visual e as decisões de cada
 * seção.
 */
export function DashboardContent({ greeting, firstName }: { greeting: string; firstName?: string }) {
  const { data, error, isLoading, refetch } = useDashboardSummary();

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data) {
    return <ErrorState title="Não foi possível carregar o painel" message={error?.message ?? 'Tente novamente em instantes.'} onRetry={refetch} />;
  }

  if (data.leads.total === 0) {
    return <FirstAccessChecklist greeting={greeting} firstName={firstName} />;
  }

  const withMobilePercent = data.leads.total === 0 ? 0 : (data.leads.withMobile / data.leads.total) * 100;
  const activeSearches = data.searches.queued + data.searches.running;
  const cumulativeByDay = data.leads.byDay.reduce<number[]>((acc, day) => {
    const prev = acc.length > 0 ? acc[acc.length - 1]! : 0;
    acc.push(prev + day.count);
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="inno-stagger-in" style={stagger(0)}>
        <SummaryHero greeting={greeting} firstName={firstName} summary={data} />
      </div>

      <div className="inno-stagger-in" style={stagger(1)}>
        <QueueHealthBanner />
      </div>

      <div className="inno-stagger-in grid gap-4 sm:grid-cols-2 lg:grid-cols-4" style={stagger(2)}>
        <IndicatorCard
          icon={TrendingUp}
          iconClassName="bg-primary/10 text-primary"
          label="Leads na semana"
          value={data.leads.createdLast7d}
          deltaPercent={deltaPercent(data.leads.createdLast7d, data.leads.createdPrev7d)}
          visual={<Sparkline data={data.leads.byDay.map((d) => d.count)} />}
        />
        <IndicatorCard
          icon={Users}
          iconClassName="bg-primary/10 text-primary"
          label="Total de leads"
          value={data.leads.total}
          visual={<Sparkline data={cumulativeByDay} />}
        />
        <IndicatorCard
          icon={Smartphone}
          iconClassName="bg-success/10 text-success"
          label="Leads com celular"
          value={withMobilePercent}
          format={(v) => `${v.toFixed(0)}%`}
          visual={<ProportionRing percent={withMobilePercent} valueClassName="text-success" />}
          secondaryText={`${data.leads.withMobile.toLocaleString('pt-BR')} de ${data.leads.total.toLocaleString('pt-BR')}, o que qualifica para WhatsApp`}
        />
        <IndicatorCard
          icon={Radar}
          iconClassName="bg-accent text-accent-foreground"
          label="Buscas ativas"
          value={activeSearches}
          visual={
            <CompareBars
              items={[
                { label: 'Na fila', value: data.searches.queued, barClassName: 'bg-muted-foreground/40' },
                { label: 'Rodando', value: data.searches.running, barClassName: 'bg-accent-foreground' },
              ]}
            />
          }
          secondaryText={`${data.searches.queued} na fila · ${data.searches.running} rodando`}
        />
      </div>

      <div className="inno-stagger-in grid gap-4 lg:grid-cols-3" style={stagger(3)}>
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Leads coletados nos últimos 30 dias</p>
          <LeadsAreaChart data={data.leads.byDay} />
        </div>
        <StatusFunnel byStatus={data.leads.byStatus} />
      </div>

      <div className="inno-stagger-in grid gap-4 lg:grid-cols-2" style={stagger(4)}>
        <RecentSearches />
        <RecentLeads />
      </div>

      <div className="inno-stagger-in grid gap-4 lg:grid-cols-3" style={stagger(5)}>
        <TopListCard
          title="Top UFs"
          items={data.leads.topUfs.map((u) => ({ label: u.uf, count: u.count }))}
          emptyMessage="Sem dados suficientes ainda."
        />
        <TopListCard
          title="Top categorias"
          items={data.leads.topCategories.map((c) => ({ label: c.category, count: c.count }))}
          emptyMessage="Sem dados suficientes ainda."
        />
        <SystemHealthCard />
      </div>
    </div>
  );
}
