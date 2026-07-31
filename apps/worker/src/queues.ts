/**
 * queues.ts — nomes de fila (fonte única, ARQUITETURA §5.3) + config de
 * conexão/limiter compartilhada por quem sobe um `Worker`/`Queue` BullMQ.
 *
 * ⚠️ `apps/web` (rota `POST /api/v1/searches`, que faz o fanout inicial de
 * `SearchTask`) precisa enfileirar nesta MESMA fila sem poder importar deste
 * app (regras de dependência do monorepo — só `packages/*` são
 * compartilhados entre apps, ver ARQUITETURA §2). Por isso o nome literal
 * `'scrape:search'` está duplicado em `apps/web/src/lib/queue.ts`, com
 * comentário cruzado para os dois lados não divergirem — é um contrato de
 * protocolo (nome de fila Redis), não código compartilhável.
 */
import type { ConnectionOptions } from 'bullmq';

export const QUEUES = {
  /** 1 job = 1 SearchTask (1 nicho × 1 município), ARQUITETURA §5.2/§5.3. */
  scrapeSearch: 'scrape:search',
  /** Fase 4 — tick de campanha de disparo. Não usado na Fase 1. */
  dispatchTick: 'dispatch:tick',
  /** Fase 2+ — health-check, retenção, warmup. Não usado na Fase 1. */
  maintenance: 'maintenance',
} as const;

export const SCRAPE_SEARCH_JOB_NAME = 'scrape-search-task';

/** Nº de contextos de browser Playwright em paralelo (ARQUITETURA §5.3). */
export const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 2);

/** Teto de buscas (SearchTask) por minuto, global — perfil de uso humano, não de bot. */
export const SCRAPE_RATE_LIMITER = {
  max: Number(process.env.SCRAPE_RATE_PER_MIN ?? 6),
  duration: 60_000,
};

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

/** Opções de conexão exigidas pelo BullMQ (`maxRetriesPerRequest: null` é obrigatório para Worker/QueueEvents). */
export function bullConnectionOptions(): ConnectionOptions {
  return { url: redisUrl(), maxRetriesPerRequest: null };
}

/**
 * Converte `City.population` (pode passar de 10 milhões em capitais) na
 * escala de prioridade do BullMQ (1 = mais prioritário, inteiro positivo).
 * Fanout é priorizado por população DECRESCENTE (ARQUITETURA §5.2) — por
 * isso invertemos: cidade mais populosa recebe o número de prioridade mais
 * baixo. Clamped em [1, 2_097_151] (limite histórico do BullMQ; manter a
 * margem é mais seguro que assumir que a versão instalada aceita mais).
 */
const MAX_BULLMQ_PRIORITY = 2_097_151;
const ASSUMED_MAX_POPULATION = 15_000_000; // folga acima da maior capital (SP ~12M)

export function priorityFromPopulation(population: number): number {
  const clampedPopulation = Math.max(0, Math.min(population, ASSUMED_MAX_POPULATION));
  const inverted = ASSUMED_MAX_POPULATION - clampedPopulation;
  return Math.max(1, Math.min(MAX_BULLMQ_PRIORITY, Math.round(inverted / 7) + 1));
}
