/**
 * jobs/requeue-orphans.ts — roda 1x no BOOT do worker (não é um job BullMQ
 * recorrente). Cobre o risco R10 da REVISAO-ARQUITETURA (§4.1): "Redis cai, a
 * fila se perde" — e o buraco irmão dele, já citado na mesma revisão (§2.2):
 * `createSearchJob` (`apps/web/src/lib/services/searches.ts`) enfileira fora
 * da transação do Postgres; se o `Queue.add` falhar (Redis fora do ar bem
 * naquele instante), a `SearchTask` fica `pending` no banco sem NENHUM job
 * correspondente no Redis — e sem este boot task, ela fica assim para
 * sempre, sem que ninguém a recolha.
 *
 * Duas categorias de órfã, na ordem que este módulo trata:
 *
 * 1. `status: 'running'` presa além de um teto de segurança
 *    (`STALE_RUNNING_MINUTES`) — só pode acontecer se o processo anterior
 *    morreu no meio de `claimTask()`/processamento (nenhum outro código
 *    path deixa uma task em `running` "esperando"). O teto evita roubar uma
 *    task de um SEGUNDO worker ainda vivo durante um deploy com sobreposição
 *    (rolling restart) — scrape de 1 cidade leva segundos a poucos minutos
 *    (`estimateDurationMinutes`), então qualquer coisa `running` por mais de
 *    `STALE_RUNNING_MINUTES` não é mais um processamento legítimo em curso.
 *    Resetadas para `pending` (preserva `attempt` — o retry manual do job já
 *    soma +1 de novo ao reclamar).
 *
 * 2. `status: 'pending'` (inclui as recém-resetadas acima) de qualquer
 *    `SearchJob` ainda ativo (`queued`/`running`) — reenfileiradas TODAS,
 *    mesmo que um job correspondente já exista no Redis (não dá para saber
 *    barato, sem listar a fila inteira). É seguro duplicar: `claimTask()`
 *    (`scrape-search.job.ts`) usa `updateMany WHERE status='pending'`
 *    atômico — só a PRIMEIRA execução concorrente de fato reivindica a task;
 *    a segunda encontra `status !== 'pending'` e vira no-op (log + return).
 */
import type { Queue } from 'bullmq';
import { prisma } from '@inno/db';
import { SCRAPE_SEARCH_JOB_NAME, priorityFromPopulation } from '../queues.js';
import type { ScrapeSearchJobData } from './scrape-search.job.js';
import { logger } from '../observability/logger.js';

const STALE_RUNNING_MINUTES = Number(process.env.STALE_RUNNING_TASK_MINUTES ?? 15);

export async function requeueOrphanTasks(scrapeQueue: Queue<ScrapeSearchJobData>): Promise<{ runningReset: number; pendingRequeued: number }> {
  const staleRunningBefore = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000);

  const staleRunning = await prisma.searchTask.findMany({
    where: { status: 'running', startedAt: { lt: staleRunningBefore } },
    select: { id: true },
  });

  if (staleRunning.length > 0) {
    await prisma.searchTask.updateMany({
      where: { id: { in: staleRunning.map((t) => t.id) } },
      data: { status: 'pending' },
    });
    logger.warn(
      { count: staleRunning.length, staleAfterMinutes: STALE_RUNNING_MINUTES },
      'requeue-orphans: SearchTask presas em running (worker anterior morreu no meio) resetadas para pending',
    );
  }

  const pendingTasks = await prisma.searchTask.findMany({
    where: { status: 'pending', searchJob: { status: { in: ['queued', 'running'] } } },
    select: { id: true, city: { select: { population: true } } },
  });

  let requeued = 0;
  await Promise.all(
    pendingTasks.map(async (task) => {
      try {
        await scrapeQueue.add(
          SCRAPE_SEARCH_JOB_NAME,
          { searchTaskId: task.id } satisfies ScrapeSearchJobData,
          { priority: priorityFromPopulation(task.city.population) },
        );
        requeued += 1;
      } catch (err) {
        logger.error(
          { searchTaskId: task.id, err: err instanceof Error ? err : new Error(String(err)) },
          'requeue-orphans: falha ao reenfileirar SearchTask pendente',
        );
      }
    }),
  );

  logger.info(
    { runningReset: staleRunning.length, pendingRequeued: requeued },
    'requeue-orphans concluído',
  );

  return { runningReset: staleRunning.length, pendingRequeued: requeued };
}
