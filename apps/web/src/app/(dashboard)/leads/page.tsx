'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, Search, Users } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingRows } from '@/components/common/loading-rows';
import { Pagination } from '@/components/common/pagination';
import { PendingBand, type PendingBandItem } from '@/components/common/pending-band';
import { LeadBulkToolbar } from '@/components/leads/lead-bulk-toolbar';
import { LeadFilters } from '@/components/leads/lead-filters';
import { LeadTable } from '@/components/leads/lead-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLeadPendingSignals } from '@/hooks/useLeadPendingSignals';
import { useLeads } from '@/hooks/useLeads';
import { exportLeads } from '@/lib/api/leads';
import { EMPTY_LEADS_FILTER, hasAnyLeadFilter, toApiLeadFilter, type LeadsFilterState } from '@/lib/lead-filter-state';
import { clampPage } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { LEAD_PAGE_SIZES, type LeadPageSize } from '@/types/lead';

export default function LeadsPage() {
  const [filters, setFilters] = useState<LeadsFilterState>(EMPTY_LEADS_FILTER);
  // Só os campos de texto livre (cada tecla mudaria o filtro) são debounced —
  // selects/pills/datas aplicam na hora, como antes desta rodada.
  const debouncedQ = useDebouncedValue(filters.q, 300);
  const debouncedCategory = useDebouncedValue(filters.category, 300);
  const debouncedTags = useDebouncedValue(filters.tags, 300);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<LeadPageSize>(LEAD_PAGE_SIZES[0]);

  const apiFilter = useMemo(
    () => ({
      ...toApiLeadFilter({ ...filters, q: debouncedQ, category: debouncedCategory, tags: debouncedTags }),
      page,
      pageSize,
    }),
    [filters, debouncedQ, debouncedCategory, debouncedTags, page, pageSize],
  );

  const { response, isLoading, error, refetch } = useLeads(apiFilter);
  const { signals: pendingSignals, error: pendingSignalsError } = useLeadPendingSignals();

  // Fila de trabalho, não KPI decorativo (pedido do dono, referência
  // Altezza): os dois sinais são reais do próprio domínio de leads — "sem
  // telefone" (não há como nem tentar WhatsApp) e "fora do nicho" (o Google
  // Maps devolveu vizinho de categoria, decisão de marcar é do dono, nunca
  // descartar sozinho — ver `types/lead.ts#offNiche`). Cada ação aplica o
  // MESMO atalho de filtro que já existe no painel avançado — nunca um 3º
  // caminho de filtro paralelo.
  const pendingBandItems: PendingBandItem[] = pendingSignals
    ? [
        {
          key: 'no-phone',
          label: 'Leads sem telefone',
          count: pendingSignals.noPhone,
          tone: 'warning',
          actionLabel: 'Ver leads',
          onAction: () => setFilters((current) => ({ ...current, hasPhone: 'false' })),
        },
        {
          key: 'off-niche',
          label: 'Leads fora do nicho buscado',
          count: pendingSignals.offNiche,
          tone: 'warning',
          actionLabel: 'Ver leads',
          onAction: () => setFilters((current) => ({ ...current, offNiche: 'true' })),
        },
      ]
    : [];

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hasAnyFilter = hasAnyLeadFilter(filters);
  const leads = response?.data ?? [];
  // Uma vez que já carregou pela 1ª vez, uma troca de página/filtro NUNCA
  // mais mostra o esqueleto de novo — mantém a última lista conhecida na
  // tela, esmaecida, até a resposta nova chegar. Sem isto, cada clique em
  // "página 2" apagava a tabela inteira por um instante (esqueleto de novo),
  // mesmo a busca sendo rápida — a lista "pisca" a cada troca.
  const hasLoadedOnce = response !== null;

  // Trocar qualquer filtro (ou o tamanho da página) sempre volta para a
  // página 1 — senão o operador pode ficar "perdido" na página 6 de um
  // resultado que agora só tem 2.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedQ,
    debouncedCategory,
    debouncedTags,
    filters.status,
    filters.uf,
    filters.cityIbgeCode,
    filters.searchJobId,
    filters.offNiche,
    filters.hasWebsite,
    filters.hasPhone,
    filters.phoneType,
    filters.minRating,
    filters.createdFrom,
    filters.createdTo,
    pageSize,
  ]);

  // Caso real do escopo: o filtro mudou e a página que estava na tela deixou
  // de existir (ex.: estava na 7, o resultado novo só tem 3). O efeito acima
  // já manda pra página 1 antes de qualquer busca nova sair — este aqui é o
  // cinto de segurança para quando a resposta mesmo assim vier com uma
  // `totalPages` menor que a página pedida (filtro mudou por outra via, ou o
  // backend real um dia clampar diferente do cliente).
  useEffect(() => {
    if (!response) return;
    const clamped = clampPage(page, response.totalPages);
    if (clamped !== page) setPage(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // Seleção é sobre o conjunto visível na tela (a página atual) — trocar o
  // filtro OU a página invalida a seleção anterior.
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
      // Exporta o FILTRO inteiro (todas as páginas), nunca só a página visível.
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
              <span className="tabular-nums">{response.total}</span> lead(s) encontrados
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

      {!pendingSignalsError && (pendingSignals ? <PendingBand items={pendingBandItems} /> : <Skeleton className="h-16 w-full" />)}

      <Card variant="flat">
        <CardContent className="pt-4">
          <LeadFilters value={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      {error && <ErrorState message={error.message} onRetry={refetch} />}

      {!error && isLoading && !hasLoadedOnce && (
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

      {!error && hasLoadedOnce && response && (
        <div
          aria-busy={isLoading}
          className={cn('flex flex-col gap-4', isLoading && 'pointer-events-none opacity-60 transition-opacity')}
        >
          {leads.length === 0 && !hasAnyFilter && (
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

          {leads.length === 0 && hasAnyFilter && (
            <EmptyState title="Nenhum lead encontrado" description="Tente ajustar os filtros aplicados." />
          )}

          {leads.length > 0 && (
            <>
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

              <Pagination
                page={response.page}
                totalPages={response.totalPages}
                pageSize={response.pageSize}
                pageSizeOptions={LEAD_PAGE_SIZES}
                total={response.total}
                onPageChange={setPage}
                // `Pagination` só oferece as opções de `LEAD_PAGE_SIZES` — o cast é seguro.
                onPageSizeChange={(size) => setPageSize(size as LeadPageSize)}
                isLoading={isLoading}
                itemLabel="leads"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
