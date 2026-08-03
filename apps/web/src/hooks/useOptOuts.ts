'use client';

import { useCallback, useEffect, useState } from 'react';

import { listOptOuts } from '@/lib/api/optouts';
import type { Paginated } from '@/types/common';
import type { OptOutItem } from '@/types/optout';

export type UseOptOutsState = {
  response: Paginated<OptOutItem> | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refetch: () => void;
};

/** Lista opt-outs com paginação por cursor — mesmo padrão de `useLeads`/`useTemplates`. */
export function useOptOuts(): UseOptOutsState {
  const [response, setResponse] = useState<Paginated<OptOutItem> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listOptOuts({ limit: 25 })
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os opt-outs.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const loadMore = useCallback(() => {
    if (!response?.page.nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    listOptOuts({ cursor: response.page.nextCursor, limit: 25 })
      .then((res) => {
        setResponse((prev) => (prev ? { data: [...prev.data, ...res.data], page: res.page } : res));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais opt-outs.'));
      })
      .finally(() => setIsLoadingMore(false));
  }, [response?.page.nextCursor, isLoadingMore]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, isLoadingMore, error, loadMore, refetch };
}
