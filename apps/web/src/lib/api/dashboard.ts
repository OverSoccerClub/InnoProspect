import { USE_MOCKS } from '@/lib/config';
import { apiGet } from '@/lib/fetcher';
import { mockGetDashboardSummary } from '@/mocks/dashboard';
import { mockDelay } from '@/mocks/utils';
import type { DashboardSummary } from '@/types/dashboard';

/**
 * `GET /api/v1/dashboard/summary` — agregados prontos pro painel (leads por
 * dia/status/UF/categoria, contadores de busca). Construído pelo Vega em
 * paralelo a esta rodada; ver `types/dashboard.ts` para o TODO de contrato.
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockGetDashboardSummary();
  }
  return apiGet<DashboardSummary>('/api/v1/dashboard/summary');
}
