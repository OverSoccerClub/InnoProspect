'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, Users } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { EMPTY_LEADS_FILTER, LeadFilters, type LeadsFilterState } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeads } from '@/hooks/useLeads';

export default function LeadsPage() {
  const [filters, setFilters] = useState<LeadsFilterState>(EMPTY_LEADS_FILTER);
  const debouncedQ = useDebouncedValue(filters.q, 300);

  const apiFilter = useMemo(
    () => ({
      q: debouncedQ || undefined,
      status: filters.status.length > 0 ? filters.status : undefined,
      uf: filters.uf ? [filters.uf] : undefined,
      cityIbgeCode: filters.cityIbgeCode ? [filters.cityIbgeCode] : undefined,
      limit: 25,
    }),
    [debouncedQ, filters.status, filters.uf, filters.cityIbgeCode],
  );

  const { response, isLoading, isLoadingMore, error, loadMore, refetch } = useLeads(apiFilter);

  const hasAnyFilter = Boolean(filters.q || filters.status.length > 0 || filters.uf || filters.cityIbgeCode);
  const leads = response?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {response ? `${response.facets.total} lead(s) encontrados` : 'Empresas coletadas pelas suas buscas.'}
          </p>
        </div>
      </div>

      <LeadFilters value={filters} onChange={setFilters} />

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Avaliação</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={6} columns={6} />
          </tbody>
        </Table>
      )}

      {!error && !isLoading && leads.length === 0 && !hasAnyFilter && (
        <EmptyState
          icon={<Users className="size-8" aria-hidden="true" />}
          title="Nenhum lead ainda"
          description="Os leads aparecem aqui depois que uma busca é concluída. Crie uma busca para começar a coletar."
          action={
            <Button asChild size="sm">
              <Link href="/buscas/nova">
                <Search />
                Criar uma busca
              </Link>
            </Button>
          }
        />
      )}

      {!error && !isLoading && leads.length === 0 && hasAnyFilter && (
        <EmptyState title="Nenhum lead encontrado" description="Tente ajustar os filtros aplicados." />
      )}

      {!error && !isLoading && leads.length > 0 && (
        <div className="flex flex-col gap-4">
          <LeadTable leads={leads} />
          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais leads'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
