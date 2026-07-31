import Link from 'next/link';
import { BadgeAlert, Globe, Star } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPhone } from '@/lib/format';
import type { LeadListItem } from '@/types/lead';

export function LeadTable({ leads }: { leads: LeadListItem[] }) {
  return (
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
      <TableBody>
        {leads.map((lead) => (
          <TableRow key={lead.id}>
            <TableCell>
              <Link
                href={`/leads/${lead.id}`}
                className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {lead.name}
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                {lead.website && <Globe className="size-3 text-muted-foreground" aria-label="Tem site" />}
                {lead.isOptedOut && (
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <BadgeAlert className="size-3" aria-hidden="true" /> opt-out
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="whitespace-nowrap">{formatPhone(lead.phoneE164)}</TableCell>
            <TableCell className="whitespace-nowrap">
              {lead.city ? `${lead.city} — ${lead.uf}` : '—'}
            </TableCell>
            <TableCell>{lead.category ?? '—'}</TableCell>
            <TableCell>
              {lead.rating !== null ? (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden="true" />
                  {lead.rating.toFixed(1)}
                  <span className="text-xs text-muted-foreground">({lead.reviewCount ?? 0})</span>
                </span>
              ) : (
                '—'
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
