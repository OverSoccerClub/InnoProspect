/**
 * lib/dispatch-queue.ts — 🆕 Fase 4.F.3: handle da fila `dispatch-tick`
 * (ARQUITETURA §6.8.3, motor de disparo) do LADO DO WEB — só para obter
 * `Queue#client` (a conexão Redis compartilhada) e ler/escrever o estado de
 * pausa global/heartbeat em `lib/dispatch-state.ts`. `apps/web` NUNCA
 * enfileira/consome jobs desta fila (isso é do worker, Fase 4.F.4) — mesmo
 * espírito de `lib/queue.ts` (produtor de `scrape-search`), mas aqui não há
 * produção de job nenhuma nesta rodada, só o canal Redis compartilhado.
 *
 * ⚠️ `DISPATCH_TICK_QUEUE_NAME` precisa bater byte a byte com
 * `apps/worker/src/queues.ts` (`QUEUES.dispatchTick`) — `apps/web` não pode
 * importar de `apps/worker` (ARQUITETURA §2), então o nome é duplicado de
 * propósito, mesmo contrato de protocolo que `SCRAPE_SEARCH_QUEUE_NAME` já
 * usa.
 */
import { Queue } from 'bullmq';

export const DISPATCH_TICK_QUEUE_NAME = 'dispatch-tick';

let dispatchTickQueue: Queue | null = null;

/** Mesma regra de `lib/queue.ts#redisUrl` — sem fallback silencioso em produção (variável ausente é erro de configuração, tem que gritar, não adivinhar). */
function redisUrl(): string {
  const fromEnv = process.env.REDIS_URL?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL não está definida. Sem ela não há como consultar/mudar a pausa global do motor de disparo. ' +
        'Defina REDIS_URL nas variáveis de ambiente do serviço.',
    );
  }
  return 'redis://localhost:6379';
}

/** Singleton do handle — reaproveita a conexão entre chamadas de rota dentro do mesmo processo Next.js. */
export function getDispatchTickQueue(): Queue {
  if (!dispatchTickQueue) {
    dispatchTickQueue = new Queue(DISPATCH_TICK_QUEUE_NAME, {
      connection: { url: redisUrl(), maxRetriesPerRequest: null },
    });
  }
  return dispatchTickQueue;
}
