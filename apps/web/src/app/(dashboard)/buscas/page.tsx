'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchJobsFilters, type SearchJobsFilterState } from '@/components/searches/search-jobs-filters';
import { SearchJobsTable } from '@/components/searches/search-jobs-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearchJobs } from '@/hooks/useSearchJobs';

export default function SearchJobsPage() {
  const [filters, setFilters] = useState<SearchJobsFilterState>({ status: '', uf: '', q: '' });
  const { jobs, isLoading, error, refetch } = useSearchJobs({
    status: filters.status || undefined,
    uf: filters.uf || undefined,
    q: filters.q || undefined,
  });

  const hasAnyFilter = Boolean(filters.status || filters.uf || filters.q);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Buscas"
        description="Histórico e progresso das buscas de leads."
        action={
          <Button asChild>
            <Link href="/buscas/nova">
              <Plus />
              Nova busca
            </Link>
          </Button>
        }
      />

      <SearchJobsFilters value={filters} onChange={setFilters} />

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!error && !isLoading && jobs.length === 0 && !hasAnyFilter && (
        <EmptyState
          icon={<Search className="size-8" aria-hidden="true" />}
          title="Nenhuma busca ainda"
          description="Crie sua primeira busca informando um nicho e uma UF para começar a coletar leads."
          action={
            <Button asChild size="sm">
              <Link href="/buscas/nova">Criar primeira busca</Link>
            </Button>
          }
        />
      )}

      {!error && !isLoading && jobs.length === 0 && hasAnyFilter && (
        <EmptyState
          title="Nenhuma busca encontrada"
          description="Tente ajustar os filtros de status, UF ou texto."
        />
      )}

      {!error && !isLoading && jobs.length > 0 && <SearchJobsTable jobs={jobs} />}
    </div>
  );
}
