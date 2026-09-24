/**
 * scheduler.ts — sobe os `Worker`/`Queue` BullMQ do processo. Fase 1 só tem
 * a fila `scrape-search` (ARQUITETURA §8, item 1.4). `dispatch-tick` (Fase
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
import { sendAlert } from './observability/alerts.js';
import {
  HEARTBEAT_INTERVAL_MS,
  PAUSE_SWEEP_INTERVAL_MS,
  clearQueuePauseMeta,
  readQueuePauseMeta,
  recordHeartbeat,
} from './lib/queue-state.js';
import { DISPATCH_HEARTBEAT_INTERVAL_MS, recordDispatchTickHeartbeat } from './lib/dispatch-state.js';

export type WorkerHandles = {
  scrapeSearchQueue: Queue<ScrapeSearchJobData>;
  scrapeSearchWorker: Worker<ScrapeSearchJobData>;
  /**
   * 🆕 Fase 4.F.3 — só um `Queue` (sem `Worker`/processor ainda): o tick de
   * verdade (claim/eligibilidade/disparo, §6.8.2-§6.8.7) é Fase 4.F.4, fora
   * de escopo aqui. Existe já para (a) dar um handle com `.client` para o
   * heartbeat abaixo, e (b) o 4.F.4 anexar o `Worker` na MESMA fila sem
   * precisar tocar neste arquivo de novo.
   */
  dispatchTickQueue: Queue;
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
    logger.error({ jobId: job?.id, searchTaskId: job?.data.searchTaskId, err }, 'job scrape-search falhou sem tratamento interno');
  });

  scrapeSearchWorker.on('error', (err) => {
    logger.error({ err }, 'erro no Worker scrape-search (nível de conexão/infra)');
  });

  logger.info(
    { queue: QUEUES.scrapeSearch, concurrency: SCRAPE_CONCURRENCY, rateLimiter: SCRAPE_RATE_LIMITER },
    'worker scrape-search no ar',
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

  // 🆕 Fase 4.F.3 — heartbeat do dispatch, ANTES de o tick existir (§8 Fase
  // 4.F: "o freio é construído antes do acelerador"). Só um `Queue` (sem
  // processor) — grava `lastTickAt` incondicionalmente, pausado ou não, pela
  // MESMA razão do heartbeat geral acima: "parado" (motor pausado de
  // propósito) e "quebrado" (worker morto) não podem ser a mesma tela
  // (ARQUITETURA §6.8.9/§8.0 regra 4). Ver o comentário de
  // `dispatch-state.ts` sobre o que este heartbeat prova HOJE (processo de
  // pé) e o que vai passar a provar na Fase 4.F.4 (o tick de fato rodou).
  const dispatchTickQueue = new Queue(QUEUES.dispatchTick, { connection });
  const dispatchHeartbeatTimer = setInterval(() => {
    void recordDispatchTickHeartbeat(dispatchTickQueue).catch((err: unknown) => {
      logger.error({ err }, 'falha ao gravar heartbeat do dispatch (Redis fora do ar?)');
    });
  }, DISPATCH_HEARTBEAT_INTERVAL_MS);
  dispatchHeartbeatTimer.unref?.();
  void recordDispatchTickHeartbeat(dispatchTickQueue).catch((err: unknown) => {
    logger.error({ err }, 'falha ao gravar heartbeat inicial do dispatch');
  });
  logger.info({ queue: QUEUES.dispatchTick }, 'heartbeat do dispatch no ar (motor nasce PAUSADO — ARQUITETURA §6.8.9)');

  return {
    scrapeSearchQueue,
    scrapeSearchWorker,
    dispatchTickQueue,
    async close() {
      clearInterval(heartbeatTimer);
      clearInterval(pauseSweepTimer);
      clearInterval(dispatchHeartbeatTimer);
      await scrapeSearchWorker.close();
      await scrapeSearchQueue.close();
      await dispatchTickQueue.close();
      await closeDefaultEngine();
    },
  };
}

export async function sweepQueuePause(scrapeQueue: Queue<ScrapeSearchJobData>): Promise<void> {
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
  logger.info({ code: meta.code }, 'scrape-search queue retomada automaticamente — pausa temporizada expirou');

  // Fecha o ciclo do alerta: só dispara aqui porque a linha acima de fato
  // mudou o estado (`isPaused` era `true` no início desta função, ver early
  // return logo depois de lê-lo) — retomada manual via `POST
  // /api/v1/scraper/queue/resume` (apps/web, pausa indefinida de sanidade)
  // NÃO passa por aqui, então não gera este alerta (quem chamou aquele
  // endpoint já sabe que acabou de retomar).
  await sendAlert({ kind: 'queue_resumed', code: meta.code, message: `pausa temporizada expirou (motivo original: ${meta.message})` });
}
