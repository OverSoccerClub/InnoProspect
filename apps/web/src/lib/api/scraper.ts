import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPost } from '@/lib/fetcher';
import { mockGetQueueStatus, mockResumeQueue } from '@/mocks/scraper';
import { mockDelay } from '@/mocks/utils';
import type { ResumeScraperQueueResponse, ScraperQueueStatusResponse } from '@/types/scraper-queue';

/** `GET /api/v1/scraper/queue` — estado operacional da fila de coleta (running/paused/unknown) + incidentes abertos. */
export async function getQueueStatus(): Promise<ScraperQueueStatusResponse> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockGetQueueStatus();
  }
  return apiGet<ScraperQueueStatusResponse>('/api/v1/scraper/queue');
}

/**
 * `POST /api/v1/scraper/queue/resume` — retomada manual, sempre com
 * `acknowledge: true` explícito no corpo (confirmação de que um humano
 * investigou o incidente antes de seguir, ARQUITETURA §5.7/§6.5).
 */
export async function resumeQueue(): Promise<ResumeScraperQueueResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockResumeQueue();
  }
  return apiPost<ResumeScraperQueueResponse>('/api/v1/scraper/queue/resume', { acknowledge: true });
}
