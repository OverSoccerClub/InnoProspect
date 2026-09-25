/**
 * lib/health-check-state.ts — contador de falhas CONSECUTIVAS de ping na
 * Evolution API (ARQUITETURA §6.6/§6.9), persistido no MESMO Redis que o
 * BullMQ já usa (via `Queue#client`, ver `[[convention-worker-redis-state]]`
 * na memória do Vega) — não um `ioredis` próprio, não uma tabela do Cronos:
 * é estado OPERACIONAL (não é domínio), e precisa sobreviver a um restart do
 * worker pelo mesmo motivo que a pausa da fila de scraping precisa
 * (`lib/queue-state.ts`) — um worker em crash-loop bem na hora em que a
 * Evolution também está fora do ar NUNCA poderia acumular 3 falhas seguidas
 * se o contador vivesse só em memória do processo.
 */
import type { Queue } from 'bullmq';

export const EVOLUTION_PING_FAILURE_STREAK_KEY = 'inno:dispatch:evolution-ping:failure-streak';

/** `0` se a chave não existir ou não for um inteiro válido (Redis limpo/corrompido conta como "sem histórico de falha", nunca como "já falhou muito"). */
export async function readEvolutionPingFailureStreak(maintenanceQueue: Queue): Promise<number> {
  const client = await maintenanceQueue.client;
  const raw = await client.get(EVOLUTION_PING_FAILURE_STREAK_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Incrementa e devolve o novo valor. `INCR` tem a MESMA semântica em
 * `ioredis` e `node-redis` (ao contrário de `SET ... EX`, ver o gotcha
 * documentado em `queue-state.ts#recordHeartbeat`) — mas o tipo `IRedisClient`
 * do BullMQ não declara `incr` (só os poucos métodos que ele próprio usa
 * internamente). Mesmo cast "o tipo declarado é mais estreito que o cliente
 * real" já usado em `queue-state.ts`/`dispatch-state.ts` — o cliente real em
 * runtime é `ioredis` (ver `bullmq/classes/redis-connection.js`).
 */
export async function recordEvolutionPingFailure(maintenanceQueue: Queue): Promise<number> {
  const client = await maintenanceQueue.client;
  const clienteIoredis = client as unknown as { incr(chave: string): Promise<number> };
  return clienteIoredis.incr(EVOLUTION_PING_FAILURE_STREAK_KEY);
}

/** Chamado a cada ciclo em que PELO MENOS um ping teve sucesso — a recuperação zera o contador na hora, não espera o próximo halt/degrade. */
export async function resetEvolutionPingFailureStreak(maintenanceQueue: Queue): Promise<void> {
  const client = await maintenanceQueue.client;
  await client.del(EVOLUTION_PING_FAILURE_STREAK_KEY);
}
