'use client';

import { useCallback, useEffect, useState } from 'react';

import { listTemplates } from '@/lib/api/templates';
import type { Paginated } from '@/types/common';
import type { TemplateItem } from '@/types/template';

export type UseTemplatesState = {
  response: Paginated<TemplateItem> | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refetch: () => void;
};

/** Lista templates com paginação por cursor — mesmo padrão de `useLeads`. */
export function useTemplates(): UseTemplatesState {
  const [response, setResponse] = useState<Paginated<TemplateItem> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listTemplates({ limit: 25 })
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os templates.'));
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
    listTemplates({ cursor: response.page.nextCursor, limit: 25 })
      .then((res) => {
        setResponse((prev) => (prev ? { data: [...prev.data, ...res.data], page: res.page } : res));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais templates.'));
      })
      .finally(() => setIsLoadingMore(false));
  }, [response?.page.nextCursor, isLoadingMore]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, isLoadingMore, error, loadMore, refetch };
}
