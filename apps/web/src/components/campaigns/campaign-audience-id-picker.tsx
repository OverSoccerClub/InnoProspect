'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { Pagination } from '@/components/common/pagination';
import { LeadFilters } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeads } from '@/hooks/useLeads';
import { EMPTY_LEADS_FILTER, toApiLeadFilter, type LeadsFilterState } from '@/lib/lead-filter-state';
import { clampPage } from '@/lib/pagination';
import { LEAD_PAGE_SIZES, type LeadPageSize } from '@/types/lead';

type CampaignAudienceIdPickerProps = {
  selected: string[];
  onChange: (leadIds: string[]) => void;
};

/**
 * Escolher leads UM A UM para a campanha — diferente da seleção em massa de
 * `/leads` (`LeadBulkToolbar`), a seleção aqui PERSISTE ao trocar de página
 * ou de filtro: o operador está montando uma lista através de várias buscas
 * (ex.: filtra por SP, marca 5; filtra por RJ, marca mais 3) — perder a
 * marcação de SP ao mudar o filtro para RJ tornaria o modo "por lista"
 * inútil para qualquer público espalhado. Reaproveita `LeadFilters`/
 * `LeadTable`/`Pagination`, os mesmos primitivos de `/leads`.
 */
export function CampaignAudienceIdPicker({ selected, onChange }: CampaignAudienceIdPickerProps) {
  const [filters, setFilters] = useState<LeadsFilterState>(EMPTY_LEADS_FILTER);
  const debouncedQ = useDebouncedValue(filters.q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<LeadPageSize>(LEAD_PAGE_SIZES[0]);

  const apiFilter = useMemo(
    () => ({ ...toApiLeadFilter({ ...filters, q: debouncedQ }), page, pageSize }),
    [filters, debouncedQ, page, pageSize],
  );
  const { response, isLoading, error, refetch } = useLeads(apiFilter);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filters.uf, filters.cityIbgeCode, filters.status, pageSize]);

  useEffect(() => {
    if (!response) return;
    const clamped = clampPage(page, response.totalPages);
    if (clamped !== page) setPage(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const selectedSet = new Set(selected);
  const leads = useMemo(() => response?.data ?? [], [response]);
  const selectedNames = useMemo(() => new Map(leads.map((l) => [l.id, l.name])), [leads]);

  function toggleOne(id: string) {
    onChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  function toggleAllOnPage(checked: boolean) {
    const pageIds = leads.map((l) => l.id);
    if (checked) {
      const merged = new Set(selected);
      pageIds.forEach((id) => merged.add(id));
      onChange([...merged]);
    } else {
      onChange(selected.filter((id) => !pageIds.includes(id)));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <LeadFilters value={filters} onChange={setFilters} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{selected.length}</span> lead(s) selecionado(s) no total
        </p>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            Limpar seleção
          </Button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Leads selecionados">
          {selected.slice(0, 20).map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 pr-1">
              {selectedNames.get(id) ?? id}
              <button
                type="button"
                onClick={() => toggleOne(id)}
                aria-label={`Remover ${selectedNames.get(id) ?? id} da seleção`}
                className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
          {selected.length > 20 && <Badge variant="secondary">+{selected.length - 20} outro(s)</Badge>}
        </div>
      )}

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && !response && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Local</TableHead>
              <TableHead className="hidden lg:table-cell">Categoria</TableHead>
              <TableHead className="hidden xl:table-cell">Avaliação</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            <LoadingRows rows={5} columns={7} />
          </tbody>
        </Table>
      )}

      {!error && response && (
        <>
          {leads.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado com este filtro.
            </p>
          ) : (
            <LeadTable leads={leads} selectedIds={selectedSet} onToggle={toggleOne} onToggleAll={toggleAllOnPage} />
          )}

          <Pagination
            page={response.page}
            totalPages={response.totalPages}
            pageSize={response.pageSize}
            pageSizeOptions={LEAD_PAGE_SIZES}
            total={response.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => setPageSize(size as LeadPageSize)}
            isLoading={isLoading}
            itemLabel="leads"
          />
        </>
      )}
    </div>
  );
}
