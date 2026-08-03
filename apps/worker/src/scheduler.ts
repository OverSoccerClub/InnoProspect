/**
 * scheduler.ts — sobe os `Worker`/`Queue` BullMQ do processo. Fase 1 só tem
 * a fila `scrape:search` (ARQUITETURA §8, item 1.4). `dispatch:tick` (Fase
 * 4) e `maintenance` (health-check/retenção/warmup, Fase 2-5) entram aqui
 * nas próximas rodadas — a estrutura já reserva o lugar.
 */
import { Queue, Worker } from 'bullmq';
import { closeDefaultEngine } from '@inno/scraper';
import {
  QUEUES,
  SCRAPE_CONCURRENCY,
  SCRAPE_RATE_LIMITER,
  bullConnectionOptions,
} from './queues.js';
import { createScrapeSearchProcessor, type ScrapeSearchJobData } from './jobs/scrape-search.job.js';
import { logger } from './observability/logger.js';
import {
  HEARTBEAT_INTERVAL_MS,
  PAUSE_SWEEP_INTERVAL_MS,
  clearQueuePauseMeta,
  readQueuePauseMeta,
  recordHeartbeat,
} from './lib/queue-state.js';

export type WorkerHandles = {
  scrapeSearchQueue: Queue<ScrapeSearchJobData>;
  scrapeSearchWorker: Worker<ScrapeSearchJobData>;
  close: () => Promise<void>;
};

export function startWorkers(): WorkerHandles {
  const connection = bullConnectionOptions();

  const scrapeSearchQueue = new Queue<ScrapeSearchJobData>(QUEUES.scrapeSearch, { connection });

  const scrapeSearchWorker = new Worker<ScrapeSearchJobData>(
    QUEUES.scrapeSearch,
    createScrapeSearchProcessor(scrapeSearchQueue),
    {
      connection,
      concurrency: SCRAPE_CONCURRENCY,
      limiter: SCRAPE_RATE_LIMITER,
    },
  );

  scrapeSearchWorker.on('failed', (job, err) => {
    // Só chega aqui se o processor lançar (bug não tratado) — o fluxo normal
    // de retry/backoff por código de erro é feito à mão dentro do job (ver
    // jobs/scrape-search.job.ts) e NUNCA relança, para não disparar o retry
    // nativo do BullMQ em cima do nosso.
    logger.error({ jobId: job?.id, searchTaskId: job?.data.searchTaskId, err }, 'job scrape:search falhou sem tratamento interno');
  });

  scrapeSearchWorker.on('error', (err) => {
    logger.error({ err }, 'erro no Worker scrape:search (nível de conexão/infra)');
  });

  logger.info(
    { queue: QUEUES.scrapeSearch, concurrency: SCRAPE_CONCURRENCY, rateLimiter: SCRAPE_RATE_LIMITER },
    'worker scrape:search no ar',
  );

  // Heartbeat (Onda 1 item 1.4 — "hoje não há como saber se o worker está
  // vivo", REVISAO-ARQUITETURA §4.2 N3): grava uma chave no Redis com TTL a
  // cada `HEARTBEAT_INTERVAL_MS`. `GET /api/v1/health` (apps/web) lê essa
  // chave — se o worker morrer, ela expira sozinha (sem precisar de nenhum
  // "unregister" no shutdown), então ausência da chave já É o sinal de
  // "worker fora do ar".
  const heartbeatTimer = setInterval(() => {
    void recordHeartbeat(scrapeSearchQueue).catch((err: unknown) => {
      logger.error({ err }, 'falha ao gravar heartbeat do worker (Redis fora do ar?)');
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  void recordHeartbeat(scrapeSearchQueue).catch((err: unknown) => {
    logger.error({ err }, 'falha ao gravar heartbeat inicial do worker');
  });

  // Sweep de retomada de pausas temporizadas (Onda 1 item 1.2) — substitui o
  // `setTimeout` antigo em `scrape-search.job.ts`: em vez de um timer em
  // memória que se perde num restart, este sweep relê o `resumeAt` gravado no
  // Redis a cada `PAUSE_SWEEP_INTERVAL_MS` e retoma quando a hora chegar,
  // não importa há quanto tempo o worker atual está no ar. Pausas sem
  // `resumeAt` (LAYOUT_CHANGED, ou qualquer assertion de sanidade) NUNCA são
  // tocadas aqui — só `POST /api/v1/scraper/queue/resume` (manual) as encerra.
  const pauseSweepTimer = setInterval(() => {
    void sweepQueuePause(scrapeSearchQueue).catch((err: unknown) => {
      logger.error({ err }, 'falha no sweep de retomada da fila (não afeta o processamento de tasks)');
    });
  }, PAUSE_SWEEP_INTERVAL_MS);
  pauseSweepTimer.unref?.();

  return {
    scrapeSearchQueue,
    scrapeSearchWorker,
    async close() {
      clearInterval(heartbeatTimer);
      clearInterval(pauseSweepTimer);
      await scrapeSearchWorker.close();
      await scrapeSearchQueue.close();
      await closeDefaultEngine();
    },
  };
}

async function sweepQueuePause(scrapeQueue: Queue<ScrapeSearchJobData>): Promise<void> {
  const meta = await readQueuePauseMeta(scrapeQueue);
  if (!meta || !meta.resumeAt) return; // não pausada, ou pausa indefinida (exige acknowledge manual).
  if (new Date(meta.resumeAt).getTime() > Date.now()) return; // ainda não venceu.

  const isPaused = await scrapeQueue.isPaused();
  if (!isPaused) {
    // Já foi retomada por outro caminho (ex.: `POST .../resume` manual)
    // enquanto isso — só limpa a metadata órfã.
    await clearQueuePauseMeta(scrapeQueue);
    return;
  }

  await scrapeQueue.resume();
  await clearQueuePauseMeta(scrapeQueue);
  logger.info({ code: meta.code }, 'scrape:search queue retomada automaticamente — pausa temporizada expirou');
}
