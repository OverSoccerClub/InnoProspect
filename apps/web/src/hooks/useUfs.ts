'use client';

import { useEffect, useState } from 'react';

import { listUfs } from '@/lib/api/locations';
import type { Uf } from '@/types/location';

export function useUfs() {
  const [ufs, setUfs] = useState<Uf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    listUfs()
      .then((data) => {
        if (!cancelled) setUfs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os estados.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ufs, isLoading, error };
}
