'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Search, Users } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { LeadBulkToolbar } from '@/components/leads/lead-bulk-toolbar';
import { EMPTY_LEADS_FILTER, LeadFilters, type LeadsFilterState } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeads } from '@/hooks/useLeads';
import { exportLeads } from '@/lib/api/leads';

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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hasAnyFilter = Boolean(filters.q || filters.status.length > 0 || filters.uf || filters.cityIbgeCode);
  const leads = response?.data ?? [];

  // Seleção é sobre o conjunto visível na tela — trocar o filtro invalida a seleção anterior.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkNotice(null);
  }, [apiFilter]);

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(leads.map((l) => l.id)) : new Set());
  }

  function handleBulkApplied({ updated, skipped }: { updated: number; skipped: number }) {
    setSelectedIds(new Set());
    setBulkNotice(
      skipped > 0
        ? `${updated} lead(s) atualizado(s), ${skipped} sem alteração (já estavam no valor pedido ou não foram encontrados).`
        : `${updated} lead(s) atualizado(s).`,
    );
    refetch();
  }

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      await exportLeads(apiFilter);
    } catch {
      setExportError('Não foi possível gerar o CSV agora. Tente novamente.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Empresas coletadas pelas suas buscas."
        meta={
          response && (
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              <span className="tabular-nums">{response.facets.total}</span> lead(s) encontrados
            </span>
          )
        }
        action={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting || leads.length === 0}>
            {isExporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download />}
            Exportar CSV
          </Button>
        }
      />

      {exportError && <ErrorState message={exportError} />}

      <Card variant="flat">
        <CardContent className="pt-4">
          <LeadFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Local</TableHead>
              <TableHead className="hidden lg:table-cell">Categoria</TableHead>
              <TableHead className="hidden xl:table-cell">Avaliação</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows
              rows={6}
              columns={6}
              columnClassNames={['', '', '', 'hidden lg:table-cell', 'hidden xl:table-cell', '']}
            />
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
          {bulkNotice && (
            <Alert variant="success">
              <AlertDescription>{bulkNotice}</AlertDescription>
            </Alert>
          )}

          {selectedIds.size > 0 && (
            <LeadBulkToolbar
              selectedIds={[...selectedIds]}
              onCleared={() => setSelectedIds(new Set())}
              onApplied={handleBulkApplied}
            />
          )}

          <LeadTable leads={leads} selectedIds={selectedIds} onToggle={toggleOne} onToggleAll={toggleAll} />

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
