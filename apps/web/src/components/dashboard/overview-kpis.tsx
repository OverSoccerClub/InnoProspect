'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listLeads } from '@/lib/api/leads';
import { listSearchJobs } from '@/lib/api/searches';

type Kpis = { activeSearches: number; totalLeads: number };

/**
 * Números reais do dia (não mock de marketing): `GET /api/v1/searches`
 * (status queued+running) e `GET /api/v1/leads` (facets.total), as duas
 * rotas que já existiam antes desta tela — nenhum endpoint novo aqui.
 */
export function OverviewKpis() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([listSearchJobs({ status: 'queued,running' }), listLeads({ limit: 1 })])
      .then(([searches, leads]) => {
        if (cancelled) return;
        setKpis({
          activeSearches: searches.page.total,
          totalLeads: leads.facets.total,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar a visão geral.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return <ErrorState message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Buscas em andamento</CardTitle>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Search className="size-4" aria-hidden="true" />
          </span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <p className="font-display text-3xl font-semibold tabular-nums">{kpis?.activeSearches ?? 0}</p>
          )}
          <Link
            href="/buscas"
            className="mt-1 inline-block text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver todas as buscas
          </Link>
        </CardContent>
      </Card>

      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Total de leads</CardTitle>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Users className="size-4" aria-hidden="true" />
          </span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <p className="font-display text-3xl font-semibold tabular-nums">{kpis?.totalLeads ?? 0}</p>
          )}
          <Link
            href="/leads"
            className="mt-1 inline-block text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver todos os leads
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
