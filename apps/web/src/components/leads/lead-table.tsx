import Link from 'next/link';
import { BadgeAlert, Globe, Star } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeadListItem } from '@/types/lead';

/** Iniciais (até 2 letras) para o avatar de identidade do lead na tabela. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function LeadTable({ leads }: { leads: LeadListItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Local</TableHead>
          <TableHead>Categoria</TableHead>
          <TableHead className="text-right">Avaliação</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => (
          <TableRow key={lead.id}>
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
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {lead.city ? `${lead.city} — ${lead.uf}` : '—'}
            </TableCell>
            <TableCell className="text-muted-foreground">{lead.category ?? '—'}</TableCell>
            <TableCell className="text-right">
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
        ))}
      </TableBody>
    </Table>
  );
}
