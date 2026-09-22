/**
 * lib/queue-state.ts — leitura (e, no resume manual, limpeza) do estado
 * operacional da fila `scrape-search` gravado pelo worker em Redis. Ver
 * `apps/worker/src/lib/queue-state.ts` — chaves e formato têm que bater byte
 * a byte (mesmo motivo do nome de fila duplicado em `lib/queue.ts`: `apps/web`
 * não pode importar de `apps/worker`, ARQUITETURA §2).
 *
 * Todas as funções aqui são "fail-soft": se o Redis estiver fora do ar, elas
 * devolvem `null`/erro tratado em vez de lançar — quem chama (`GET
 * /api/v1/health`) precisa continuar respondendo mesmo com o Redis morto (ver
 * REVISAO-ARQUITETURA §4.2 N3, "health check que mente" — a correção não é
 * trocar por um `503` toda vez que uma dependência secundária cai, é reportar
 * cada dependência à parte, nunca travar a resposta inteira nisso).
 */
import { getScrapeSearchQueue } from './queue';

export const SCRAPE_QUEUE_PAUSE_META_KEY = 'inno:scrape:queue:pause-meta';
export const WORKER_HEARTBEAT_KEY = 'inno:worker:heartbeat';
export const HEARTBEAT_TTL_SECONDS = 45;

export type QueuePauseMeta = {
  code: string;
  message: string;
  severity: 'high' | 'critical';
  source: 'scrape_error' | 'sanity';
  pausedAt: string;
  resumeAt: string | null;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis não respondeu em ${ms}ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Client Redis por trás da fila BullMQ, com timeout curto — sem isto, se o
 * Redis estiver totalmente inacessível, `await queue.client` pode ficar
 * pendurado (o `ioredis` por baixo do BullMQ tenta reconectar indefinidamente
 * por padrão) e travaria `GET /api/v1/health` junto.
 */
async function getClientOrNull(timeoutMs = 2000) {
  try {
    return await withTimeout(getScrapeSearchQueue().client, timeoutMs);
  } catch {
    return null;
  }
}

export async function readQueuePauseMeta(): Promise<QueuePauseMeta | null> {
  const client = await getClientOrNull();
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(SCRAPE_QUEUE_PAUSE_META_KEY), 2000);
    if (!raw) return null;
    return JSON.parse(raw) as QueuePauseMeta;
  } catch {
    return null;
  }
}

export async function clearQueuePauseMeta(): Promise<void> {
  const client = await getClientOrNull();
  if (!client) return;
  await client.del(SCRAPE_QUEUE_PAUSE_META_KEY).catch(() => undefined);
}

export async function readWorkerHeartbeat(): Promise<{ lastHeartbeatAt: string; ageSeconds: number } | null> {
  const client = await getClientOrNull();
  if (!client) return null;
  try {
    const raw = await withTimeout(client.get(WORKER_HEARTBEAT_KEY), 2000);
    if (!raw) return null;
    const ageSeconds = (Date.now() - new Date(raw).getTime()) / 1000;
    if (!Number.isFinite(ageSeconds)) return null;
    return { lastHeartbeatAt: raw, ageSeconds };
  } catch {
    return null;
  }
}

export type PingResult = { ok: true; latencyMs: number } | { ok: false; error: string };

/**
 * O `IRedisClient` que o BullMQ expõe via `Queue#client` (bullmq 5.81, ver
 * `redis-client.d.ts`) é uma abstração PRÓPRIA da lib (para suportar
 * ioredis/node-redis/Bun por baixo) e não declara `PING` — usamos `INFO`
 * (presente na interface) como prova de conectividade equivalente: só
 * resolve se o round-trip com o Redis funcionou.
 */
export async function pingRedis(): Promise<PingResult> {
  const startedAt = Date.now();
  try {
    const client = await getClientOrNull();
    if (!client) throw new Error('não foi possível obter conexão Redis dentro do timeout.');
    await withTimeout(client.info(), 2000);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `isPaused()` do BullMQ também bate no Redis — mesma proteção de timeout, para não travar `/health`. */
export async function isScrapeQueuePausedSafe(): Promise<boolean | null> {
  try {
    return await withTimeout(getScrapeSearchQueue().isPaused(), 2000);
  } catch {
    return null;
  }
}
