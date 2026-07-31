'use client';

import { getSearchJob } from '@/lib/api/searches';
import type { SearchJobDetail } from '@/types/search';
import { usePolling } from './usePolling';

const LIVE_STATUSES: SearchJobDetail['status'][] = ['queued', 'running'];

/**
 * Progresso ao vivo de uma busca — polling de 3s (ARQUITETURA.md §4.2)
 * enquanto o job estiver queued/running. Para sozinho quando o job termina,
 * falha ou é cancelado.
 */
export function useSearchJob(id: string) {
  return usePolling<SearchJobDetail>(() => getSearchJob(id), {
    intervalMs: 3000,
    shouldContinue: (job) => LIVE_STATUSES.includes(job.status),
  });
}
