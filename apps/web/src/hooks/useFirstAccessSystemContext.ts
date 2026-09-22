'use client';

import { useEffect, useState } from 'react';

import { getFirstAccessSystemContext, type FirstAccessSystemContext } from '@/lib/api/dashboard';

/**
 * Busca só uma vez (sem polling — é um contexto estático para o estado de
 * primeiro acesso) o cenário coerente de fila/saúde/WhatsApp para uma conta
 * recém-criada. `data === null` depois de carregar significa "sem override":
 * quem consome deve deixar `QueueHealthBanner`/`SystemHealthCard` buscarem
 * o estado real sozinhos (é o caso de produção sem mocks).
 */
export function useFirstAccessSystemContext() {
  const [data, setData] = useState<FirstAccessSystemContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getFirstAccessSystemContext()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, isLoading };
}
