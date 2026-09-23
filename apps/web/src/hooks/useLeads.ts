'use client';

import { useCallback, useEffect, useState } from 'react';

import { listLeads } from '@/lib/api/leads';
import type { LeadFilter, LeadListResponse } from '@/types/lead';

export type UseLeadsState = {
  response: LeadListResponse | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

/**
 * Busca UMA página de leads para um filtro (`filter.page`/`filter.pageSize`
 * incluídos) — paginação NUMERADA, substituiu o acúmulo por cursor
 * (`loadMore`) que este hook tinha antes de 2026-09-23. Cada troca de página,
 * de registros-por-página ou de qualquer filtro dispara uma busca nova que
 * SUBSTITUI `data` — nunca concatena, porque a tela agora mostra "página X de
 * Y", não uma lista que cresce.
 */
export function useLeads(filter: LeadFilter): UseLeadsState {
  const [response, setResponse] = useState<LeadListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listLeads(filter)
      .then((res) => {
        if (cancelled) return;
        setResponse(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error('Não foi possível carregar os leads.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, error, refetch };
}
