import { USE_MOCKS } from '@/lib/config';
import { apiGet } from '@/lib/fetcher';
import {
  mockGetDashboardSummary,
  mockGetEmptyScenarioHealth,
  mockGetEmptyScenarioInstances,
  mockGetEmptyScenarioQueueStatus,
} from '@/mocks/dashboard';
import { mockDelay } from '@/mocks/utils';
import type { DashboardSummary } from '@/types/dashboard';
import type { HealthReport } from '@/types/health';
import type { ScraperQueueStatusResponse } from '@/types/scraper-queue';
import type { InstanceListItem } from '@/types/whatsapp';

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

export type FirstAccessSystemContext = {
  queue: ScraperQueueStatusResponse;
  health: HealthReport;
  instances: InstanceListItem[];
};

/**
 * Fila/saúde/WhatsApp coerentes com o estado de primeiro acesso (zero
 * leads) — só existe em modo mock. Em produção real (`USE_MOCKS=false`)
 * devolve `null`: `QueueHealthBanner`/`SystemHealthCard` já buscam o estado
 * real sozinhos, e para uma conta nova ele naturalmente já é "fila rodando,
 * zero instâncias de WhatsApp" — não há nada artificial a corrigir ali,
 * então não vale a pena outro round-trip. Ver `mocks/dashboard.ts`.
 */
export async function getFirstAccessSystemContext(): Promise<FirstAccessSystemContext | null> {
  if (!USE_MOCKS) return null;
  await mockDelay(200);
  return {
    queue: mockGetEmptyScenarioQueueStatus(),
    health: mockGetEmptyScenarioHealth(),
    instances: mockGetEmptyScenarioInstances(),
  };
}
