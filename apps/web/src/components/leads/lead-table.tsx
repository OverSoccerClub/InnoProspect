import Link from 'next/link';
import { BadgeAlert, Globe, Star } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeadListItem } from '@/types/lead';

/** Iniciais (até 2 letras) para o avatar de identidade do lead na tabela. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * Prioridade de coluna (estratégia geral em `components/ui/table.tsx`):
 * Nome/Telefone/Local/Status são o mínimo para escanear e agir sobre um
 * lead — sempre visíveis. Categoria e Avaliação enriquecem a leitura mas não
 * são essenciais; saem do fluxo em telas mais estreitas (`hidden lg:table-cell`
 * / `hidden xl:table-cell`) para nunca competir por espaço com as colunas que
 * importam. Texto de tamanho variável (Local/Categoria) é truncado com
 * `title` — o valor completo continua a um hover/foco de distância, nunca
 * "perdido".
 */
export function LeadTable({
  leads,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  leads: LeadListItem[];
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
}) {
  const selectable = Boolean(onToggle && onToggleAll);
  const allSelected = selectable && leads.length > 0 && leads.every((l) => selectedIds?.has(l.id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-10">
              <Checkbox
                aria-label={allSelected ? 'Desmarcar todos os leads desta página' : 'Selecionar todos os leads desta página'}
                checked={allSelected}
                onChange={(e) => onToggleAll?.(e.target.checked)}
              />
            </TableHead>
          )}
          <TableHead>Nome</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Local</TableHead>
          <TableHead className="hidden lg:table-cell">Categoria</TableHead>
          <TableHead className="hidden xl:table-cell text-right">Avaliação</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => {
          const isSelected = selectedIds?.has(lead.id) ?? false;
          return (
            <TableRow key={lead.id} className={cn(isSelected && 'bg-accent/40')}>
              {selectable && (
                <TableCell>
                  <Checkbox
                    aria-label={`Selecionar ${lead.name}`}
                    checked={isSelected}
                    onChange={() => onToggle?.(lead.id)}
                  />
                </TableCell>
              )}
              <TableCell>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                  >
                    {initials(lead.name)}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="block truncate font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {lead.name}
                    </Link>
                    {(lead.website || lead.isOptedOut) && (
                      <div className="mt-0.5 flex items-center gap-2">
                        {lead.website && <Globe className="size-3 text-muted-foreground" aria-label="Tem site" />}
                        {lead.isOptedOut && (
                          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                            <BadgeAlert className="size-3" aria-hidden="true" /> opt-out
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatPhone(lead.phoneE164)}</TableCell>
              <TableCell
                className="max-w-[180px] truncate text-muted-foreground"
                title={lead.city ? `${lead.city} — ${lead.uf}` : undefined}
              >
                {lead.city ? `${lead.city} — ${lead.uf}` : '—'}
              </TableCell>
              <TableCell className="hidden max-w-[160px] truncate text-muted-foreground lg:table-cell" title={lead.category ?? undefined}>
                {lead.category ?? '—'}
              </TableCell>
              <TableCell className="hidden text-right xl:table-cell">
                {lead.rating !== null ? (
                  <span className={cn('inline-flex items-center gap-1 tabular-nums', 'justify-end')}>
                    <Star className="size-3.5 fill-warning text-warning" aria-hidden="true" />
                    {lead.rating.toFixed(1)}
                    <span className="text-xs text-muted-foreground">({lead.reviewCount ?? 0})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <LeadStatusBadge status={lead.status} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
