/**
 * lib/services/scraper-health.ts — estado de saúde do sistema de scraping,
 * consumido por `GET /api/v1/health` (visão resumida, para healthcheck de
 * infra) e por `GET /api/v1/scraper/queue` + `POST
 * /api/v1/scraper/queue/resume` (visão operacional completa + ação de
 * retomada). Onda 1 (REVISAO-ARQUITETURA §5, itens 1.2-1.4): antes desta
 * rodada `GET /api/v1/health` só fazia `SELECT 1` — respondia `200 ok` com o
 * worker morto, o Redis fora do ar e a fila pausada há dias (REVISAO-
 * ARQUITETURA §4.2 N3, "health check que mente").
 *
 * Regra de desenho: Postgres é a ÚNICA dependência que decide o HTTP status
 * (200/503) — é a única de que o PRÓPRIO `apps/web` depende para servir
 * requisição. Redis/worker/fila fora do ar são reportados por campo (para o
 * banner da Lyra e para quem está de plantão), mas não derrubam o
 * healthcheck do EasyPanel — trocar "sempre 200" por "503 por causa do
 * worker" seria só inverter o erro, não corrigi-lo (o app Next continua de
 * pé e servindo o resto do dashboard mesmo com o worker fora do ar).
 */
import { prisma, type ScraperHealthEventSeverity, type ScraperHealthEventType } from '@inno/db';
import { conflict } from '@/lib/api-handler';
import { getScrapeSearchQueue } from '@/lib/queue';
import {
  clearQueuePauseMeta,
  isScrapeQueuePausedSafe,
  pingRedis,
  readQueuePauseMeta,
  readWorkerHeartbeat,
} from '@/lib/queue-state';

export type DependencyStatus = 'ok' | 'error';

export type QueueStatusView = {
  status: 'running' | 'paused' | 'unknown';
  reason: string | null;
  code: string | null;
  severity: 'high' | 'critical' | null;
  source: 'scrape_error' | 'sanity' | null;
  pausedAt: string | null;
  resumeAt: string | null;
};

export type HealthReport = {
  status: 'ok' | 'degraded';
  time: string;
  checks: {
    database: { status: DependencyStatus; latencyMs: number | null; error?: string };
    redis: { status: DependencyStatus; latencyMs: number | null; error?: string };
    worker: { status: 'ok' | 'down'; lastHeartbeatAt: string | null; ageSeconds: number | null };
    queue: QueueStatusView;
    openIncidents: number;
  };
};

async function checkDatabase(): Promise<HealthReport['checks']['database']> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'error', latencyMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function buildQueueStatus(): Promise<QueueStatusView> {
  const [isPaused, meta] = await Promise.all([isScrapeQueuePausedSafe(), readQueuePauseMeta()]);
  return {
    status: isPaused === null ? 'unknown' : isPaused ? 'paused' : 'running',
    reason: meta?.message ?? null,
    code: meta?.code ?? null,
    severity: meta?.severity ?? null,
    source: meta?.source ?? null,
    pausedAt: meta?.pausedAt ?? null,
    resumeAt: meta?.resumeAt ?? null,
  };
}

/**
 * `-1` sinaliza "não deu pra contar" (Postgres fora do ar) — não deixamos
 * essa query derrubar `getHealthReport()` inteiro: `checkDatabase()` já
 * reporta `checks.database.status: 'error'` separadamente, e é ESSE campo
 * (não este count) que decide o `503`. Ver comentário no topo do arquivo.
 */
async function countOpenIncidentsSafe(): Promise<number> {
  try {
    return await prisma.scraperHealthEvent.count({ where: { resolvedAt: null } });
  } catch {
    return -1;
  }
}

/** Resumo usado por `GET /api/v1/health` — pensado para orquestração de deploy, não para a UI operacional. */
export async function getHealthReport(): Promise<HealthReport> {
  const [database, redis, heartbeat, queue, openIncidents] = await Promise.all([
    checkDatabase(),
    pingRedis(),
    readWorkerHeartbeat(),
    buildQueueStatus(),
    countOpenIncidentsSafe(),
  ]);

  const worker: HealthReport['checks']['worker'] = heartbeat
    ? { status: 'ok', lastHeartbeatAt: heartbeat.lastHeartbeatAt, ageSeconds: Math.round(heartbeat.ageSeconds) }
    : { status: 'down', lastHeartbeatAt: null, ageSeconds: null };

  return {
    status: database.status === 'ok' ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    checks: {
      database,
      redis: redis.ok ? { status: 'ok', latencyMs: redis.latencyMs } : { status: 'error', latencyMs: null, error: redis.error },
      worker,
      queue,
      openIncidents,
    },
  };
}

export type ScraperHealthIncident = {
  id: string;
  type: ScraperHealthEventType;
  severity: ScraperHealthEventSeverity;
  window: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  createdAt: string;
};

export type ScraperQueueStatusResponse = QueueStatusView & { openIncidents: ScraperHealthIncident[] };

/** Visão completa usada pelo banner de saúde da Lyra e pelo modal de "por que a fila está parada". */
export async function getScraperQueueStatus(): Promise<ScraperQueueStatusResponse> {
  const [queue, incidents] = await Promise.all([
    buildQueueStatus(),
    prisma.scraperHealthEvent.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  return {
    ...queue,
    openIncidents: incidents.map((i) => ({
      id: i.id,
      type: i.type,
      severity: i.severity,
      window: i.window,
      metric: i.metric,
      value: i.value,
      threshold: i.threshold,
      message: i.message,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

/** Só as assertions que efetivamente pausam a fila (A1/A2, ARQUITETURA §5.7) — A3/A4 alertam mas nunca pausam, então não fazem parte do "acknowledge" de retomada. */
const PAUSING_EVENT_TYPES: ScraperHealthEventType[] = ['zero_streak', 'fill_rate_name'];

/**
 * `POST /api/v1/scraper/queue/resume` — retomada manual (Onda 1 item 1.2/1.3:
 * "não existe caminho de recuperação sem shell"). Resolve os incidentes de
 * sanidade que causam pausa (o operador está confirmando "investiguei, pode
 * seguir") e limpa a metadata de pausa antes de chamar `queue.resume()` do
 * BullMQ. Incidentes que NÃO pausam (fill_rate_phone/data_shape) continuam
 * abertos — eles se auto-resolvem quando a métrica volta ao normal (ver
 * `apps/worker/src/observability/sanity.ts`), não fazem parte deste ack.
 */
export async function resumeScraperQueue(): Promise<{ ok: true; status: 'running'; resolvedIncidents: number }> {
  const queue = getScrapeSearchQueue();
  const isPaused = await queue.isPaused();
  if (!isPaused) {
    conflict('A fila de scraping não está pausada — não há o que retomar.');
  }

  const resolved = await prisma.scraperHealthEvent.updateMany({
    where: { type: { in: PAUSING_EVENT_TYPES }, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });

  await clearQueuePauseMeta();
  await queue.resume();

  return { ok: true, status: 'running', resolvedIncidents: resolved.count };
}
