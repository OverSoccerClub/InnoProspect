'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listLeads } from '@/lib/api/leads';
import { listSearchJobs } from '@/lib/api/searches';

type Kpis = { activeSearches: number; totalLeads: number };

export default function OverviewPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Seu ponto de partida no InnoProspect.</p>
        </div>
        <Button asChild>
          <Link href="/buscas/nova">
            <Plus />
            Nova busca
          </Link>
        </Button>
      </div>

      {error && <ErrorState message={error.message} onRetry={() => window.location.reload()} />}

      {!error && (
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
      )}
    </div>
  );
}
