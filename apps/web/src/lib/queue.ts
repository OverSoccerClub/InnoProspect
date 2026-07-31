/**
 * lib/queue.ts — produtor BullMQ usado pelas rotas de API para enfileirar
 * `SearchTask`s na fila `scrape:search` consumida por `apps/worker`
 * (ARQUITETURA §1.2/§5.3: "web e worker não se chamam por HTTP, comunicam-se
 * por Postgres (estado) + Redis (fila)").
 *
 * ⚠️ O nome literal da fila (`'scrape:search'`) e o nome do job
 * (`'scrape-search-task'`) precisam bater byte a byte com
 * `apps/worker/src/queues.ts` (fonte única "de fato" — ver comentário lá).
 * `apps/web` não pode importar de `apps/worker` (regra de dependência do
 * monorepo, ARQUITETURA §2: só `packages/*` são compartilhados entre apps),
 * então os dois lados duplicam essa constante de propósito — é um contrato
 * de protocolo (nome de canal Redis), não código.
 */
import { Queue } from 'bullmq';

const SCRAPE_SEARCH_QUEUE_NAME = 'scrape:search';
export const SCRAPE_SEARCH_JOB_NAME = 'scrape-search-task';

export type ScrapeSearchJobData = { searchTaskId: string };

let scrapeSearchQueue: Queue<ScrapeSearchJobData> | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

/** Singleton do produtor — reaproveita a conexão entre chamadas de rota dentro do mesmo processo Next.js. */
export function getScrapeSearchQueue(): Queue<ScrapeSearchJobData> {
  if (!scrapeSearchQueue) {
    scrapeSearchQueue = new Queue<ScrapeSearchJobData>(SCRAPE_SEARCH_QUEUE_NAME, {
      connection: { url: redisUrl(), maxRetriesPerRequest: null },
    });
  }
  return scrapeSearchQueue;
}

/**
 * Mesma conversão de prioridade de `apps/worker/src/queues.ts`
 * (`priorityFromPopulation`) — precisa ser idêntica para o fanout inicial
 * (aqui) e o retry (lá) ordenarem a fila da mesma forma. Município mais
 * populoso = prioridade numérica mais baixa = processado primeiro
 * (ARQUITETURA §5.2 — "usuário vê leads das capitais nos primeiros minutos").
 */
const MAX_BULLMQ_PRIORITY = 2_097_151;
const ASSUMED_MAX_POPULATION = 15_000_000;

export function priorityFromPopulation(population: number): number {
  const clampedPopulation = Math.max(0, Math.min(population, ASSUMED_MAX_POPULATION));
  const inverted = ASSUMED_MAX_POPULATION - clampedPopulation;
  return Math.max(1, Math.min(MAX_BULLMQ_PRIORITY, Math.round(inverted / 7) + 1));
}

export async function enqueueScrapeSearchTask(searchTaskId: string, population: number): Promise<void> {
  await getScrapeSearchQueue().add(
    SCRAPE_SEARCH_JOB_NAME,
    { searchTaskId } satisfies ScrapeSearchJobData,
    { priority: priorityFromPopulation(population) },
  );
}
