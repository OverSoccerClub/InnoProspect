'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PollingState<T> = {
  data: T | null;
  error: Error | null;
  /** true só na primeiríssima chamada (sem dado nenhum ainda) */
  isLoading: boolean;
  /** true enquanto o hook segue reagendando novas chamadas */
  isPolling: boolean;
  refetch: () => void;
};

export type UsePollingOptions<T> = {
  intervalMs?: number;
  enabled?: boolean;
  /** decide, a partir do último dado recebido, se deve continuar batendo no endpoint */
  shouldContinue?: (data: T) => boolean;
};

/**
 * Polling genérico: busca `fetchFn` de tempo em tempo enquanto `enabled` e
 * `shouldContinue(data)` forem verdadeiros. Nunca sobrepõe chamadas (só
 * agenda a próxima depois que a anterior termina) e não derruba o último
 * dado bom em caso de erro transitório — só marca `error`, mantém tentando.
 */
export function usePolling<T>(fetchFn: () => Promise<T>, options: UsePollingOptions<T> = {}): PollingState<T> {
  const { intervalMs = 3000, enabled = true, shouldContinue } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(enabled);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const shouldContinueRef = useRef(shouldContinue);
  shouldContinueRef.current = shouldContinue;

  const [tick, setTick] = useState(0);
  const forceRefetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function run() {
      try {
        const result = await fetchFnRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        setIsLoading(false);

        const keepGoing = shouldContinueRef.current ? shouldContinueRef.current(result) : true;
        setIsPolling(keepGoing);
        if (keepGoing) {
          timeoutId = setTimeout(run, intervalMs);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error('Falha ao buscar dados.'));
        setIsLoading(false);
        // erro transitório: continua tentando no mesmo intervalo, a menos
        // que já tenhamos um dado terminal que diga o contrário
        setIsPolling(true);
        timeoutId = setTimeout(run, intervalMs);
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, intervalMs, tick]);

  return { data, error, isLoading, isPolling, refetch: forceRefetch };
}
