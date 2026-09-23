/**
 * lib/queue-state.ts — estado operacional da fila `scrape-search` que
 * PRECISA sobreviver a um restart do processo worker: motivo/desde quando a
 * fila está pausada (por `SCRAPE_ERROR_POLICY.pauseQueueMs` OU por uma
 * assertion de sanidade A1/A2, `observability/sanity.ts`) e o heartbeat de
 * "worker vivo" (REVISAO-ARQUITETURA §4.2 N2/N3, Onda 1).
 *
 * Antes desta rodada, o "motivo/quando retomar" vivia num `setTimeout` em
 * memória do processo (`scrape-search.job.ts`) — se o worker reiniciasse, o
 * timer sumia e a fila (que o BullMQ já pausa de fato no Redis) ficava
 * pausada para sempre, sem ninguém saber por quê nem quando reavaliar. Aqui
 * gravamos essa metadata no PRÓPRIO Redis que o BullMQ já usa (via
 * `Queue#client`, sem precisar de uma dependência `ioredis` própria — nem
 * `apps/worker` nem `apps/web` declaram `ioredis` direto no `package.json`,
 * e ambos têm `bullmq`, que já a carrega por baixo), então sobrevive a
 * restart do worker inteiro.
 *
 * ⚠️ As chaves literais aqui precisam bater com
 * `apps/web/src/lib/queue-state.ts` (GET /api/v1/health e GET/POST
 * /api/v1/scraper/queue leem/escrevem as MESMAS chaves) — mesmo contrato de
 * protocolo que o nome da fila (`apps/worker/src/queues.ts`), duplicado de
 * propósito pela regra de dependência do monorepo (`apps/web` não importa
 * `apps/worker`, ver convenção em `lib/queue.ts` do lado web).
 */
import type { Queue } from 'bullmq';

export const SCRAPE_QUEUE_PAUSE_META_KEY = 'inno:scrape:queue:pause-meta';
export const WORKER_HEARTBEAT_KEY = 'inno:worker:heartbeat';

/** Intervalo entre heartbeats. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** TTL da chave no Redis — folga de 3x o intervalo para jitter/GC pause; se o worker morrer, a chave expira sozinha (sem precisar de um "unregister" explícito no shutdown). */
export const HEARTBEAT_TTL_SECONDS = 45;

/** Intervalo do sweep que confere pausas temporizadas vencidas — substitui o `setTimeout` antigo, que não sobrevivia a restart. */
export const PAUSE_SWEEP_INTERVAL_MS = 20_000;

export type QueuePauseMeta = {
  /** Código da causa: `ScrapeErrorCode` (RATE_LIMITED/CAPTCHA_DETECTED/LAYOUT_CHANGED) ou o `code` de uma `SanityCheckResult` (ZERO_STREAK/NAME_FILL_RATE_LOW). */
  code: string;
  message: string;
  severity: 'high' | 'critical';
  source: 'scrape_error' | 'sanity';
  pausedAt: string;
  /** `null` = pausa indefinida (LAYOUT_CHANGED, ou qualquer assertion de sanidade) — exige `POST /api/v1/scraper/queue/resume` manual, nunca retoma sozinha. */
  resumeAt: string | null;
};

export async function persistQueuePause(scrapeQueue: Queue, meta: QueuePauseMeta): Promise<void> {
  const client = await scrapeQueue.client;
  await client.set(SCRAPE_QUEUE_PAUSE_META_KEY, JSON.stringify(meta));
}

export async function readQueuePauseMeta(scrapeQueue: Queue): Promise<QueuePauseMeta | null> {
  const client = await scrapeQueue.client;
  const raw = await client.get(SCRAPE_QUEUE_PAUSE_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QueuePauseMeta;
  } catch {
    return null;
  }
}

export async function clearQueuePauseMeta(scrapeQueue: Queue): Promise<void> {
  const client = await scrapeQueue.client;
  await client.del(SCRAPE_QUEUE_PAUSE_META_KEY);
}

export async function recordHeartbeat(scrapeQueue: Queue): Promise<void> {
  const client = await scrapeQueue.client;
  // ⚠️ `'EX', <segundos>` POSICIONAL — nunca `{ EX: ... }`, que era como
  // estava até 2026-09-23 (achado do Vulcano durante o auto-teste da imagem).
  //
  // O tipo `IRedisClient` do BullMQ declara `set(key, value, { EX })` porque
  // ele também aceita `node-redis`, onde essa é a forma correta. Mas o cliente
  // que existe AQUI em runtime é `ioredis` — é o que
  // `bullmq/classes/redis-connection.js` instancia a partir de
  // `connection: { url }` — e nenhuma das 36 sobrecargas de `set` do ioredis
  // 5.11.1 aceita objeto: ele serializaria o argumento e o Redis responderia
  // erro de sintaxe. Resultado: heartbeat nunca gravado, `/api/v1/health`
  // nunca enxergando o worker vivo, e como único rastro um erro repetido a
  // cada 15s que o log de produção afoga.
  //
  // O cast é a forma honesta de dizer "o tipo declarado é mais largo que o
  // cliente real": mantemos a promessa do BullMQ fora daqui e assumimos
  // ioredis só nesta linha. Se um dia o projeto trocar para node-redis, este
  // é o ponto que quebra — de propósito, alto e claro.
  const clienteIoredis = client as unknown as {
    set(chave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
  };
  await clienteIoredis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS);
}
