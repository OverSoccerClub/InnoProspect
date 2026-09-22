import { ApiRequestError } from '@/lib/fetcher';
import type { ResumeScraperQueueResponse, ScraperQueueStatusResponse } from '@/types/scraper-queue';

/**
 * Estado mutável do mock (módulo singleton, como o resto de `mocks/*`) —
 * começa PAUSADA de propósito, para o banner de saúde (`components/dashboard/
 * queue-health-banner.tsx`) nunca ser exercitado só no caminho feliz durante
 * o desenvolvimento com `NEXT_PUBLIC_USE_MOCKS=true`.
 */
let queueState: ScraperQueueStatusResponse = {
  status: 'paused',
  reason: 'Taxa de resultados zerados acima do limite em 3 cidades seguidas — pode ser bloqueio do Google Maps.',
  code: 'zero_streak',
  severity: 'critical',
  source: 'sanity',
  pausedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
  resumeAt: null,
  openIncidents: [
    {
      id: 'evt_mock_zero_streak',
      type: 'zero_streak',
      severity: 'critical',
      window: '15m',
      metric: 'zero_result_streak',
      value: 6,
      threshold: 5,
      message: 'Taxa de resultados zerados acima do limite em 3 cidades seguidas.',
      createdAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    },
  ],
};

export function mockGetQueueStatus(): ScraperQueueStatusResponse {
  return queueState;
}

export function mockResumeQueue(): ResumeScraperQueueResponse {
  if (queueState.status !== 'paused') {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'A fila de scraping não está pausada — não há o que retomar.',
      requestId: 'mock',
    });
  }
  const resolvedIncidents = queueState.openIncidents.length;
  queueState = {
    status: 'running',
    reason: null,
    code: null,
    severity: null,
    source: null,
    pausedAt: null,
    resumeAt: null,
    openIncidents: [],
  };
  return { ok: true, status: 'running', resolvedIncidents };
}
