import type { HealthReport } from '@/types/health';
import { mockGetQueueStatus } from './scraper';

/**
 * Mock de `GET /api/v1/health`. Deriva `checks.queue` do MESMO mock de
 * `mocks/scraper.ts` (`mockGetQueueStatus`) — na API real os dois endpoints
 * leem o mesmo estado do Redis (`lib/services/scraper-health.ts`), então os
 * dois mocks não podem contar histórias diferentes sobre a fila.
 */
export function mockGetHealth(): HealthReport {
  const queue = mockGetQueueStatus();
  return {
    status: 'ok',
    time: new Date().toISOString(),
    checks: {
      database: { status: 'ok', latencyMs: 4 },
      redis: { status: 'ok', latencyMs: 2, target: 'redis:6379' },
      worker: { status: 'ok', lastHeartbeatAt: new Date(Date.now() - 8_000).toISOString(), ageSeconds: 8 },
      queue: { status: queue.status, reason: queue.reason },
      openIncidents: queue.openIncidents.length,
    },
  };
}
