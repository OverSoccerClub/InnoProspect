'use client';

import { useEffect, useState } from 'react';

import { listSearchJobs, type ListSearchesParams } from '@/lib/api/searches';
import type { SearchJobSummary } from '@/types/search';

export function useSearchJobs(params: ListSearchesParams) {
  const [jobs, setJobs] = useState<SearchJobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listSearchJobs(params)
      .then((res) => {
        if (!cancelled) setJobs(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar as buscas.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, reloadKey]);

  return { jobs, isLoading, error, refetch: () => setReloadKey((k) => k + 1) };
}
