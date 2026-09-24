'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Megaphone, Plus } from 'lucide-react';

import { CampaignListFilters, type CampaignListFilterState } from '@/components/campaigns/campaign-list-filters';
import { CampaignTable } from '@/components/campaigns/campaign-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCampaigns } from '@/hooks/useCampaigns';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export default function CampanhasPage() {
  const [filters, setFilters] = useState<CampaignListFilterState>({ status: '', q: '' });
  const debouncedQ = useDebouncedValue(filters.q, 300);
  const { response, isLoading, isLoadingMore, error, loadMore, refetch } = useCampaigns({
    status: filters.status || undefined,
    q: debouncedQ || undefined,
  });
  const campaigns = response?.data ?? [];
  const hasAnyFilter = Boolean(filters.status || filters.q);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campanhas"
        description="Monte o público, confira quem entra e dispare — sem motor automático nesta versão: você inicia e envia cada mensagem."
        meta={
          response && (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              <span className="tabular-nums">{response.page.total}</span> campanha(s)
            </span>
          )
        }
        action={
          <Button asChild size="sm">
            <Link href="/campanhas/nova">
              <Plus />
              Nova campanha
            </Link>
          </Button>
        }
      />

      <CampaignListFilters value={filters} onChange={setFilters} />

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Resposta</TableHead>
              <TableHead>Criada em</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={5} columns={5} columnClassNames={['', '', '', 'hidden text-right lg:table-cell', '']} />
          </tbody>
        </Table>
      )}

      {!error && !isLoading && campaigns.length === 0 && !hasAnyFilter && (
        <EmptyState
          icon={<Megaphone className="size-8" aria-hidden="true" />}
          title="Nenhuma campanha ainda"
          description="Crie a primeira campanha para montar um público, ver o corte de elegibilidade e começar a disparar."
          action={
            <Button asChild size="sm">
              <Link href="/campanhas/nova">
                <Plus />
                Criar primeira campanha
              </Link>
            </Button>
          }
        />
      )}

      {!error && !isLoading && campaigns.length === 0 && hasAnyFilter && (
        <EmptyState title="Nenhuma campanha encontrada" description="Tente ajustar o filtro de status ou o texto buscado." />
      )}

      {!error && !isLoading && campaigns.length > 0 && (
        <div className="flex flex-col gap-4">
          <CampaignTable campaigns={campaigns} />
          {response?.page.nextCursor && (
            <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="w-fit self-center">
              {isLoadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isLoadingMore ? 'Carregando…' : 'Carregar mais campanhas'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
