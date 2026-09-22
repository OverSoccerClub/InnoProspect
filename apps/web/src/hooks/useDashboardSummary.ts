'use client';

import { useEffect, useState } from 'react';

import { getDashboardSummary } from '@/lib/api/dashboard';
import type { DashboardSummary } from '@/types/dashboard';

/**
 * Fonte única de dado pro painel — um fetch, consumido pelo hero, pela linha
 * de indicadores, pelo gráfico e pelo funil (`components/dashboard/
 * dashboard-content.tsx`). `RecentSearches`/`RecentLeads`/`SystemHealthCard`
 * continuam com fetch próprio: são endpoints DIFERENTES (`/searches`,
 * `/leads`, `/health`), não dado derivável deste resumo.
 */
export function useDashboardSummary() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getDashboardSummary()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar o resumo do painel.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return { data, error, isLoading, refetch: () => setReloadKey((k) => k + 1) };
}
