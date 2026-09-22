/**
 * jobs/scrape-search.job.ts — processa 1 `SearchTask` (1 nicho × 1
 * município, ARQUITETURA §5.2). Fonte da verdade do fluxo: ARQUITETURA §1.5
 * (Fluxo A), §5.6 (retry/backoff por código de erro) e a regra de dedupe do
 * Cronos (`buildMachineUpdate`/`computeDedupeKey` de `@inno/core`).
 *
 * Retry é feito à MÃO (não pelo `attempts` nativo do BullMQ): a tabela de
 * `SCRAPE_ERROR_POLICY` (`@inno/scraper`) tem `maxAttempts`/backoff
 * DIFERENTES por código de erro (RATE_LIMITED: 2 tentativas / 15-45min;
 * LAYOUT_CHANGED: 0 tentativas; etc.) — o `attempts` nativo do BullMQ é um
 * único número fixo por job, não dá para expressar isso. Por isso cada job
 * roda com `attempts: 1` (sem retry nativo) e, ao falhar de forma
 * retryable, ESTE módulo re-enfileira manualmente com o delay correto.
 */
import type { Job, Queue } from 'bullmq';
import { type Prisma, prisma } from '@inno/db';
import {
  buildMachineUpdate,
  computeDedupeKey,
  normalizeBrPhone,
} from '@inno/core';
import {
  ScrapeError,
  SCRAPE_ERROR_POLICY,
  backoffForAttempt,
  runSearch,
  type ScrapeErrorCode,
} from '@inno/scraper';
import { SCRAPE_SEARCH_JOB_NAME, priorityFromPopulation } from '../queues.js';
import { logger } from '../observability/logger.js';
import { evaluateAndRecordSanity } from '../observability/sanity.js';
import { sendAlert } from '../observability/alerts.js';
import { persistQueuePause } from '../lib/queue-state.js';

export type ScrapeSearchJobData = { searchTaskId: string };

/**
 * Pausa a fila (BullMQ nativo, já persistido no Redis) e grava o MOTIVO/
 * HORÁRIO num campo de metadata próprio no Redis (`lib/queue-state.ts`) — não
 * mais um `setTimeout` em memória do processo. Onda 1 item 1.2: o timer
 * antigo sumia se o worker reiniciasse, deixando a fila pausada para sempre
 * sem ninguém saber por quê. Agora um sweep periódico (`scheduler.ts`) lê
 * essa metadata do Redis e retoma sozinho quando `resumeAt` vence — sobrevive
 * a restart porque não depende de nenhum estado em memória.
 */
export async function pauseQueueFor(
  scrapeQueue: Queue,
  ms: number,
  code: string,
  message: string,
  severity: 'high' | 'critical',
): Promise<void> {
  // Transição: só alerta se a fila NÃO estava pausada ainda — evita
  // realertar a cada task que falhar com o mesmo erro enquanto a fila já
  // está parada (ex.: 2 tasks em paralelo pegando RATE_LIMITED antes de a
  // primeira pausa surtir efeito no scheduler). Se já estava pausada por
  // outro motivo (ex.: sanidade), também não alerta aqui de novo — o
  // incidente original já foi avisado no seu próprio ponto de disparo.
  const wasAlreadyPaused = await scrapeQueue.isPaused();

  await scrapeQueue.pause();

  const pausedAt = new Date();
  const resumeAt = Number.isFinite(ms) ? new Date(pausedAt.getTime() + ms) : null;

  await persistQueuePause(scrapeQueue, {
    code,
    message,
    severity,
    source: 'scrape_error',
    pausedAt: pausedAt.toISOString(),
    // LAYOUT_CHANGED (ms = Infinity) pausa indefinida — exige `POST
    // /api/v1/scraper/queue/resume` manual, depois de consertar
    // extraction/selectors.ts. RATE_LIMITED/CAPTCHA_DETECTED têm `resumeAt`
    // e o sweep periódico retoma sozinho quando a hora chegar.
    resumeAt: resumeAt ? resumeAt.toISOString() : null,
  });

  logger[severity === 'critical' ? 'fatal' : 'error'](
    { code, resumeAt: resumeAt?.toISOString() ?? 'indefinido (exige POST /api/v1/scraper/queue/resume)' },
    'scrape-search queue paused — intervenção automática de anti-detecção/anti-quebra',
  );

  if (!wasAlreadyPaused) {
    await sendAlert({ kind: 'queue_paused', code, severity, message, reason: 'scrape_error' });
  }
}

/**
 * Reivindica a task atomicamente: `pending -> running` com incremento de
 * `attempt`. Equivalente, em efeito, a um `SELECT ... FOR UPDATE SKIP
 * LOCKED`: o `UPDATE ... WHERE status = 'pending'` só afeta 1 linha mesmo
 * sob concorrência (dois workers tentando pegar a mesma task ao mesmo
 * tempo) — quem chega depois recebe `count === 0` e desiste sem reprocessar.
 * Cobre também o caso de a task ter sido cancelada
 * (`POST /searches/:id/cancel` já a move para `skipped` antes daqui).
 */
async function claimTask(searchTaskId: string) {
  const result = await prisma.searchTask.updateMany({
    where: { id: searchTaskId, status: 'pending' },
    data: { status: 'running', attempt: { increment: 1 }, startedAt: new Date() },
  });
  return result.count === 1;
}

/** Marca o `SearchJob` como `running` na primeira task que de fato começa a rodar. */
async function markSearchJobStarted(searchJobId: string) {
  await prisma.searchJob.updateMany({
    where: { id: searchJobId, status: 'queued' },
    data: { status: 'running', startedAt: new Date() },
  });
}

/** Depois de fechar uma task (done ou failed), fecha o `SearchJob` se não sobrar task pendente/rodando. */
async function maybeCompleteSearchJob(searchJobId: string) {
  const job = await prisma.searchJob.findUnique({
    where: { id: searchJobId },
    select: { status: true, totalTasks: true, doneTasks: true, failedTasks: true },
  });
  if (!job || job.status !== 'running') return;
  if (job.doneTasks + job.failedTasks < job.totalTasks) return;

  // `updateMany` com `WHERE status='running'` — mesma técnica de claim
  // atômico acima, evita duas tasks concluindo "ao mesmo tempo" fecharem o
  // job duas vezes (só a primeira UPDATE bem-sucedida realmente aplica).
  await prisma.searchJob.updateMany({
    where: { id: searchJobId, status: 'running' },
    data: { status: 'completed', finishedAt: new Date() },
  });
}

export function createScrapeSearchProcessor(scrapeQueue: Queue) {
  return async function processScrapeSearchJob(job: Job<ScrapeSearchJobData>): Promise<void> {
    const { searchTaskId } = job.data;

    const claimed = await claimTask(searchTaskId);
    if (!claimed) {
      logger.info({ searchTaskId }, 'task não estava pending (já processada/cancelada) — ignorando job');
      return;
    }

    const task = await prisma.searchTask.findUnique({
      where: { id: searchTaskId },
      include: { city: true, searchJob: true },
    });
    if (!task) {
      logger.error({ searchTaskId }, 'task reivindicada mas não encontrada — inconsistência, abortando job');
      return;
    }

    await markSearchJobStarted(task.searchJobId);

    logger.info(
      { searchTaskId, searchJobId: task.searchJobId, city: task.city.name, uf: task.city.uf, attempt: task.attempt },
      'iniciando scrape de SearchTask',
    );

    try {
      const output = await runSearch(
        {
          niche: task.searchJob.niche,
          city: { name: task.city.name, uf: task.city.uf, ibgeCode: task.city.ibgeCode },
          maxResults: task.searchJob.maxResultsPerCity,
        },
        { taskId: task.id },
      );

      const collectedAt = new Date();
      let newCount = 0;

      for (const business of output.businesses) {
        const phone = normalizeBrPhone(business.phoneRaw);
        const dedupeKey = computeDedupeKey({
          externalRef: business.externalRef,
          phoneE164: phone.e164,
          name: business.name,
          cityIbgeCode: task.city.ibgeCode,
        });

        // Checagem prévia só para o contador `leadsNew` (métrica de UX, não
        // de integridade — o upsert abaixo é o que garante a unicidade de
        // verdade). Numa corrida rara entre 2 tasks de cidades vizinhas
        // capturando a mesma empresa, o contador pode errar por 1; aceitável.
        const existing = await prisma.lead.findUnique({ where: { dedupeKey }, select: { id: true } });

        await prisma.lead.upsert({
          where: { dedupeKey },
          create: {
            name: business.name,
            phoneRaw: business.phoneRaw,
            phoneE164: phone.e164,
            phoneType: phone.type,
            address: business.address,
            cityId: task.city.ibgeCode,
            uf: task.city.uf,
            website: business.website,
            category: business.category,
            rating: business.rating,
            reviewCount: business.reviewCount,
            latitude: business.latitude,
            longitude: business.longitude,
            externalRef: business.externalRef,
            dedupeKey,
            sourceType: 'google_maps_scrape',
            sourceUrl: business.sourceUrl,
            sourceQuery: output.meta.queryString,
            collectedAt,
            searchJobId: task.searchJobId,
            searchTaskId: task.id,
            engineId: output.meta.engineId,
          },
          // NUNCA espalhar um objeto literal aqui — `buildMachineUpdate`
          // (regra do Cronos) é o único jeito permitido de montar este
          // `update`, para tornar impossível vazar status/notes/tags/ownerId
          // num refactor futuro (packages/core/src/leads/dedupe.ts).
          update: buildMachineUpdate({
            name: business.name,
            phoneRaw: business.phoneRaw,
            phoneE164: phone.e164,
            phoneType: phone.type,
            address: business.address,
            website: business.website,
            category: business.category,
            rating: business.rating,
            reviewCount: business.reviewCount,
            latitude: business.latitude,
            longitude: business.longitude,
            lastSeenAt: collectedAt,
          }),
        });

        if (!existing) newCount += 1;
      }

      await prisma.$transaction([
        prisma.searchTask.update({
          where: { id: task.id },
          data: {
            status: 'done',
            resultCount: output.businesses.length,
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        }),
        prisma.searchJob.update({
          where: { id: task.searchJobId },
          data: {
            doneTasks: { increment: 1 },
            leadsFound: { increment: output.businesses.length },
            leadsNew: { increment: newCount },
          },
        }),
      ]);

      await maybeCompleteSearchJob(task.searchJobId);

      logger.info(
        { searchTaskId, resultCount: output.businesses.length, newLeads: newCount },
        'SearchTask concluída',
      );

      // Assertions de sanidade (A1-A4, Onda 1 item 1.1) — SEMPRE depois da
      // task já ter fechado com sucesso, e em seu PRÓPRIO try/catch: um erro
      // aqui (ex.: Postgres soluçou no meio da leitura) é um bug de
      // observabilidade, não motivo para marcar a task que acabou de
      // completar como falha.
      try {
        await evaluateAndRecordSanity(scrapeQueue);
      } catch (sanityErr) {
        logger.error(
          { searchTaskId, err: sanityErr instanceof Error ? sanityErr : new Error(String(sanityErr)) },
          'falha ao avaliar sanidade do scraper (não afeta a SearchTask, que já concluiu)',
        );
      }
    } catch (err) {
      await handleScrapeFailure(scrapeQueue, task, err);
    }
  };
}

async function handleScrapeFailure(
  scrapeQueue: Queue,
  task: Prisma.SearchTaskGetPayload<{ include: { city: true; searchJob: true } }>,
  err: unknown,
): Promise<void> {
  const code: ScrapeErrorCode = err instanceof ScrapeError ? err.code : 'UNKNOWN';
  const message = err instanceof Error ? err.message : String(err);
  const policy = SCRAPE_ERROR_POLICY[code];
  // Teto duplo: a política do código de erro E o teto de segurança gravado
  // na própria SearchTask (schema do Cronos, default 3) — o menor prevalece.
  const effectiveMaxAttempts = Math.min(policy.maxAttempts, task.maxAttempts);

  logger.error(
    { searchTaskId: task.id, code, attempt: task.attempt, effectiveMaxAttempts, err: message },
    'falha ao processar SearchTask',
  );

  if (policy.pauseQueueMs !== undefined) {
    await pauseQueueFor(scrapeQueue, policy.pauseQueueMs, code, message, policy.alarmSeverity ?? 'high');
  }

  if (task.attempt < effectiveMaxAttempts) {
    await prisma.searchTask.update({
      where: { id: task.id },
      data: { status: 'pending', errorCode: code, errorMessage: message },
    });

    const delay = backoffForAttempt(code, task.attempt - 1);
    await scrapeQueue.add(
      SCRAPE_SEARCH_JOB_NAME,
      { searchTaskId: task.id } satisfies ScrapeSearchJobData,
      { delay, priority: priorityFromPopulation(task.city.population) },
    );

    logger.warn({ searchTaskId: task.id, code, delayMs: delay }, 'SearchTask reenfileirada para retry');
    return;
  }

  // Tentativas esgotadas: a task falha em definitivo, mas o SearchJob
  // CONTINUA — "uma cidade falha não derruba o estado inteiro" (§5.6).
  await prisma.$transaction([
    prisma.searchTask.update({
      where: { id: task.id },
      data: { status: 'failed', errorCode: code, errorMessage: message, finishedAt: new Date() },
    }),
    prisma.searchJob.update({
      where: { id: task.searchJobId },
      data: { failedTasks: { increment: 1 } },
    }),
  ]);

  await maybeCompleteSearchJob(task.searchJobId);
}
