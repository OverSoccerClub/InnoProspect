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

/**
 * ⚠️ Sem fallback silencioso em produção.
 *
 * Isto já custou dois dias: em produção, sem `REDIS_URL`, a versão anterior
 * caía em `redis://localhost:6379`, tentava conectar num Redis que não existe
 * dentro do container e falhava com "timeout" — um sintoma que não diz nada
 * sobre a causa. A busca ficava em `queued` para sempre e o log não ajudava.
 *
 * Em desenvolvimento o padrão continua, porque ali `localhost` é de fato o
 * Redis do compose. Em produção, variável ausente é erro de configuração e
 * tem que gritar, não adivinhar.
 */
function redisUrl(): string {
  const fromEnv = process.env.REDIS_URL?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL não está definida. Sem ela não há fila: buscas seriam criadas no banco e nunca processadas. ' +
        'Defina REDIS_URL nas variáveis de ambiente do serviço.',
    );
  }
  return 'redis://localhost:6379';
}

/**
 * Host e porta do Redis configurado, SEM credenciais — para o health check
 * dizer *para onde* tentou conectar. Distinguir `localhost:6379` de
 * `inno-prospect_inno-prospect-redis:6379` na resposta separa na hora
 * "variável não chegou no container" de "o host está inacessível".
 */
export function redisTargetForDisplay(): string {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return '(REDIS_URL ausente)';
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}:${parsed.port || '6379'}`;
  } catch {
    return '(REDIS_URL malformada)';
  }
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
