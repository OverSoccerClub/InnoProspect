'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { buildPageWindow, pageItemRange } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/**
 * Paginação numerada + seletor de registros por página — genérico (não é
 * `LeadPagination`): qualquer lista da tela (leads, buscas, campanhas…) que
 * migrar de "carregar mais" por cursor para página numerada usa este mesmo
 * componente. Some sozinho quando `totalPages <= 1` (nada para paginar).
 */
export function Pagination({
  page,
  totalPages,
  pageSize,
  pageSizeOptions,
  total,
  onPageChange,
  onPageSizeChange,
  isLoading = false,
  itemLabel = 'itens',
  className,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isLoading?: boolean;
  itemLabel?: string;
  className?: string;
}) {
  const { from, to } = pageItemRange(page, pageSize, total);
  const window = buildPageWindow(page, totalPages, 1);

  return (
    <nav
      aria-label="Paginação"
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {total > 0 ? (
            <>
              Mostrando <span className="font-medium text-foreground tabular-nums">{from}</span>–
              <span className="font-medium text-foreground tabular-nums">{to}</span> de{' '}
              <span className="font-medium text-foreground tabular-nums">{total}</span> {itemLabel}
            </>
          ) : (
            `Nenhum ${itemLabel.replace(/s$/, '')} encontrado`
          )}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Registros por página</span>
          <Select
            aria-label="Registros por página"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 w-auto min-w-[4.5rem] text-xs"
            disabled={isLoading}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}/página
              </option>
            ))}
          </Select>
        </label>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Página anterior"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          <div className="flex items-center gap-1">
            {window.map((entry, index) =>
              entry === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-1.5 text-sm text-muted-foreground" aria-hidden="true">
                  …
                </span>
              ) : (
                <Button
                  key={entry}
                  variant={entry === page ? 'default' : 'outline'}
                  size="icon"
                  aria-label={`Página ${entry}`}
                  aria-current={entry === page ? 'page' : undefined}
                  disabled={isLoading}
                  onClick={() => onPageChange(entry)}
                  className="tabular-nums"
                >
                  {entry}
                </Button>
              ),
            )}
          </div>

          <Button
            variant="outline"
            size="icon"
            aria-label="Próxima página"
            disabled={page >= totalPages || isLoading}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
