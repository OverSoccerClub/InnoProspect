import { USE_MOCKS } from '@/lib/config';
import { apiGet } from '@/lib/fetcher';
import { mockGetHealth } from '@/mocks/health';
import { mockDelay } from '@/mocks/utils';
import type { HealthReport } from '@/types/health';

/** `GET /api/v1/health` — pública, usada aqui pro card de saúde do sistema no painel. */
export async function getHealth(): Promise<HealthReport> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockGetHealth();
  }
  return apiGet<HealthReport>('/api/v1/health');
}
