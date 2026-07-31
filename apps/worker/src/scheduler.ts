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

  return {
    scrapeSearchQueue,
    scrapeSearchWorker,
    async close() {
      await scrapeSearchWorker.close();
      await scrapeSearchQueue.close();
      await closeDefaultEngine();
    },
  };
}
