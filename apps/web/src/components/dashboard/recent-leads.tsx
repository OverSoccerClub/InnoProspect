'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listLeads } from '@/lib/api/leads';
import { formatRelative } from '@/lib/format';
import type { LeadListItem } from '@/types/lead';

const PAGE_SIZE = 25;
const LIMIT = 5;

/** Leads recentes — mesmo `GET /api/v1/leads` que a tela Leads já usa, ordenado por `createdAt` (padrão do contrato). */
export function RecentLeads() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    // `pageSize` só aceita 25|50|100 (contrato) — pega a menor página válida
    // e corta no cliente para os `LIMIT` mais recentes deste card.
    listLeads({ page: 1, pageSize: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setLeads(res.data.slice(0, LIMIT));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os leads recentes.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="!font-sans text-sm font-medium text-muted-foreground">Leads recentes</CardTitle>
        <Link href="/leads" className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Ver todos
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {error && <ErrorState message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />}

        {!error && isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!error && !isLoading && leads.length === 0 && (
          <EmptyState
            icon={<Users className="size-5" aria-hidden="true" />}
            title="Nenhum lead ainda"
            description="Os leads aparecem aqui assim que uma busca encontrar resultados."
          />
        )}

        {!error &&
          !isLoading &&
          leads.map((lead) => (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 -mx-2 text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{lead.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {lead.city ?? '—'}
                  {lead.uf ? `, ${lead.uf}` : ''} · {formatRelative(lead.createdAt)}
                </p>
              </div>
              <LeadStatusBadge status={lead.status} />
            </Link>
          ))}
      </CardContent>
    </Card>
  );
}
