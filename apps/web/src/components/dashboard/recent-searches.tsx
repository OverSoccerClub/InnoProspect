'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { SearchJobStatusBadge } from '@/components/searches/search-job-status-badge';
import { SearchProgressBar } from '@/components/searches/search-progress-bar';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listSearchJobs } from '@/lib/api/searches';
import { formatRelative } from '@/lib/format';
import type { SearchJobSummary } from '@/types/search';

const LIMIT = 5;

/** Buscas recentes — mesmo `GET /api/v1/searches` que a tela Buscas já usa, sem filtro de status, só as últimas `LIMIT`. */
export function RecentSearches() {
  const [jobs, setJobs] = useState<SearchJobSummary[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listSearchJobs({ limit: LIMIT })
      .then((res) => {
        if (!cancelled) setJobs(res.data.slice(0, LIMIT));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar as buscas recentes.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Buscas recentes</CardTitle>
        <Link href="/buscas" className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Ver todas
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {error && <ErrorState message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />}

        {!error && isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!error && !isLoading && jobs.length === 0 && (
          <EmptyState
            icon={<Search className="size-5" aria-hidden="true" />}
            title="Nenhuma busca ainda"
            description="Escolha um nicho e uma UF para começar a coletar leads."
          />
        )}

        {!error &&
          !isLoading &&
          jobs.map((job) => (
            <Link
              key={job.id}
              href={`/buscas/${job.id}`}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 -mx-2 text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{job.name}</p>
                <p className="text-xs text-muted-foreground">{formatRelative(job.createdAt)}</p>
              </div>
              {(job.status === 'running' || job.status === 'queued') && (
                <SearchProgressBar progress={job.progress} className="hidden w-16 sm:flex" />
              )}
              <SearchJobStatusBadge job={job} />
            </Link>
          ))}
      </CardContent>
    </Card>
  );
}
