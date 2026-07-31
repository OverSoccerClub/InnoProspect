'use client';

import { useCallback, useEffect, useState } from 'react';

import { listLeads } from '@/lib/api/leads';
import type { LeadFilter, LeadListResponse } from '@/types/lead';

export type UseLeadsState = {
  response: LeadListResponse | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refetch: () => void;
};

/** Busca leads para um filtro e acumula páginas ao chamar `loadMore` (paginação por cursor). */
export function useLeads(filter: LeadFilter): UseLeadsState {
  const [response, setResponse] = useState<LeadListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
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

  const loadMore = useCallback(() => {
    if (!response?.page.nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    listLeads({ ...filter, cursor: response.page.nextCursor })
      .then((res) => {
        setResponse((prev) =>
          prev
            ? { data: [...prev.data, ...res.data], page: res.page, facets: res.facets }
            : res,
        );
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais leads.'));
      })
      .finally(() => setIsLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, response?.page.nextCursor, isLoadingMore]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, isLoadingMore, error, loadMore, refetch };
}
