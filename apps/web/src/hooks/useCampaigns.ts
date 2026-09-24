'use client';

import { useCallback, useEffect, useState } from 'react';

import { listCampaigns, type ListCampaignsParams } from '@/lib/api/campaigns';
import type { Paginated } from '@/types/common';
import type { CampaignSummary } from '@/types/campaign';

export type UseCampaignsState = {
  response: Paginated<CampaignSummary> | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refetch: () => void;
};

/** Lista campanhas com paginação por cursor ("carregar mais") — mesmo padrão de `useTemplates` (o contrato de `GET /campaigns` é cursor, não numerado). */
export function useCampaigns(params: ListCampaignsParams = {}): UseCampaignsState {
  const [response, setResponse] = useState<Paginated<CampaignSummary> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listCampaigns({ ...params, limit: params.limit ?? 25 })
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar as campanhas.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, reloadKey]);

  const loadMore = useCallback(() => {
    if (!response?.page.nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    listCampaigns({ ...params, cursor: response.page.nextCursor, limit: params.limit ?? 25 })
      .then((res) => {
        setResponse((prev) => (prev ? { data: [...prev.data, ...res.data], page: res.page } : res));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais campanhas.'));
      })
      .finally(() => setIsLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response?.page.nextCursor, isLoadingMore, paramsKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, isLoadingMore, error, loadMore, refetch };
}
