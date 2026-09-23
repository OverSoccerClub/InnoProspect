'use client';

import { useCallback, useEffect, useState } from 'react';

import { listUsers, type ListUsersParams } from '@/lib/api/users';
import type { Paginated } from '@/types/common';
import type { UserItem } from '@/types/user';

export type UseUsersState = {
  response: Paginated<UserItem> | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  /** Sem próxima página a carregar — a lista visível é o conjunto INTEIRO do filtro atual. Ver `lib/user-access.ts#AdminGuardContext.listComplete`. */
  listComplete: boolean;
  loadMore: () => void;
  refetch: () => void;
};

/** Lista usuários com paginação por cursor — mesmo padrão de `useOptOuts`/`useTemplates`. */
export function useUsers(params: Pick<ListUsersParams, 'q'> = {}): UseUsersState {
  const { q } = params;
  const [response, setResponse] = useState<Paginated<UserItem> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listUsers({ limit: 25, q })
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os usuários.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, reloadKey]);

  const loadMore = useCallback(() => {
    if (!response?.page.nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    listUsers({ cursor: response.page.nextCursor, limit: 25, q })
      .then((res) => {
        setResponse((prev) => (prev ? { data: [...prev.data, ...res.data], page: res.page } : res));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais usuários.'));
      })
      .finally(() => setIsLoadingMore(false));
  }, [response?.page.nextCursor, isLoadingMore, q]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    response,
    isLoading,
    isLoadingMore,
    error,
    listComplete: response?.page.nextCursor === null,
    loadMore,
    refetch,
  };
}
