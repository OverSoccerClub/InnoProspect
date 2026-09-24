'use client';

import { useCallback, useEffect, useState } from 'react';

import { listCampaignTargets } from '@/lib/api/campaigns';
import type { Paginated } from '@/types/common';
import type { CampaignTargetItem, CampaignTargetStatus } from '@/types/campaign';

export type UseCampaignTargetsState = {
  response: Paginated<CampaignTargetItem> | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  loadMore: () => void;
  refetch: () => void;
};

/**
 * Lista de alvos materializados de UMA campanha — "carregar mais" por
 * cursor (mesmo formato de `useTemplates`; `GET /campaigns/:id/targets` é
 * cursor, não numerado). `refreshToken` deixa a página de detalhe da
 * campanha (que faz polling a cada 3s) empurrar um refetch da 1ª página sem
 * o componente da lista precisar saber COMO o pai decide "hora de
 * atualizar" — incrementar o número já basta.
 */
export function useCampaignTargets(
  campaignId: string,
  status: CampaignTargetStatus | '',
  refreshToken = 0,
): UseCampaignTargetsState {
  const [response, setResponse] = useState<Paginated<CampaignTargetItem> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listCampaignTargets(campaignId, { status: status || undefined, limit: 25 })
      .then((res) => {
        if (!cancelled) setResponse(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os alvos desta campanha.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, status, reloadKey, refreshToken]);

  const loadMore = useCallback(() => {
    if (!response?.page.nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    listCampaignTargets(campaignId, { status: status || undefined, cursor: response.page.nextCursor, limit: 25 })
      .then((res) => {
        setResponse((prev) => (prev ? { data: [...prev.data, ...res.data], page: res.page } : res));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error('Não foi possível carregar mais alvos.'));
      })
      .finally(() => setIsLoadingMore(false));
  }, [campaignId, status, response?.page.nextCursor, isLoadingMore]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { response, isLoading, isLoadingMore, error, loadMore, refetch };
}
