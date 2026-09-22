// TODO: trocar por import de @inno/contracts quando publicado. O endpoint já
// existe (`GET /api/v1/health`, público) — formato espelhado de
// `apps/web/src/lib/services/scraper-health.ts#HealthReport`, campo a campo.
import type { ScraperQueueStatus } from './scraper-queue';

export type DependencyStatus = 'ok' | 'error';

export type HealthReport = {
  status: 'ok' | 'degraded';
  time: string;
  checks: {
    database: { status: DependencyStatus; latencyMs: number | null; error?: string };
    redis: { status: DependencyStatus; latencyMs: number | null; target: string; error?: string };
    worker: { status: 'ok' | 'down'; lastHeartbeatAt: string | null; ageSeconds: number | null };
    queue: { status: ScraperQueueStatus; reason: string | null };
    openIncidents: number;
  };
};
