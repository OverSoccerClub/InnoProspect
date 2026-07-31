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
          <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
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
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Buscas em andamento</CardTitle>
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : <p className="text-2xl font-semibold">{kpis?.activeSearches ?? 0}</p>}
              <Link href="/buscas" className="text-sm text-primary hover:underline">
                Ver todas as buscas
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de leads</CardTitle>
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-16" /> : <p className="text-2xl font-semibold">{kpis?.totalLeads ?? 0}</p>}
              <Link href="/leads" className="text-sm text-primary hover:underline">
                Ver todos os leads
              </Link>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
