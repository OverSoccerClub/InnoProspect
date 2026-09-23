'use client';

import { useCallback, useEffect, useState } from 'react';

import { listEvolutionServers } from '@/lib/api/evolution-servers';
import type { EvolutionServerItem } from '@/types/evolution-server';

export type UseEvolutionServersState = {
  servers: EvolutionServerItem[] | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

/**
 * Lista servidores Evolution — SEM paginação (o contrato devolve `{ data:
 * [] }` flat; é uma lista administrativa, pequena por natureza). Diferente
 * de `useUsers`/`useOptOuts`, que usam cursor.
 */
export function useEvolutionServers(): UseEvolutionServersState {
  const [servers, setServers] = useState<EvolutionServerItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listEvolutionServers()
      .then((data) => {
        if (!cancelled) setServers(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error('Não foi possível carregar os servidores Evolution.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { servers, isLoading, error, refetch };
}
