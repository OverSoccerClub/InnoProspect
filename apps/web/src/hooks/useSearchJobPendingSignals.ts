'use client';

import { useEffect, useState } from 'react';

import { listSearchJobs } from '@/lib/api/searches';

export type SearchJobPendingSignals = {
  /** `status === 'failed'` no nível do JOB (crashou) — não confundir com `completed_partial`/`completed_empty` (terminou, mas o resultado foi ruim; ver `lib/search-job-outcome.ts`). Sinal único, honesto, sem precisar paginar todo o histórico de buscas concluídas para derivar outcome de cada uma. */
  failed: number;
};

/**
 * Contagem para a faixa de pendências (`PendingBand`) de `/buscas` — sempre
 * do total real (`Paginated.page.total`), independente do filtro que o
 * operador tem aplicado na tela agora (mesmo raciocínio de
 * `useLeadPendingSignals`).
 */
export function useSearchJobPendingSignals() {
  const [signals, setSignals] = useState<SearchJobPendingSignals | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSearchJobs({ status: 'failed' })
      .then((res) => {
        if (!cancelled) setSignals({ failed: res.page.total });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { signals, error };
}
