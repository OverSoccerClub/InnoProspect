/**
 * observability/sanity.ts — liga as assertions A1-A4 (`@inno/scraper/sanity`,
 * escritas e testadas, mas com zero chamadores até esta rodada — REVISAO-
 * ARQUITETURA §5.7/Onda 1 item 1.1: "o modo de falha mais perigoso do projeto
 * é o sucesso silencioso") ao banco real e à fila `scrape:search`.
 *
 * Chamado ao fim de CADA `SearchTask` bem-sucedida (`jobs/scrape-search.job.ts`)
 * — as janelas das assertions são GLOBAIS (últimas N tasks/leads do sistema
 * inteiro, ARQUITETURA §5.7), não só da task que acabou de fechar. Por isso
 * cada chamada relê o estado atual do Postgres em vez de acumular estado em
 * memória (que se perderia num restart, o mesmo defeito que motivou esta
 * rodada inteira).
 *
 * Dedup de incidente: só cria um `ScraperHealthEvent` novo se não houver um
 * já aberto (`resolvedAt: null`) do mesmo `type` — senão cada task gerava uma
 * linha nova enquanto a condição persiste. Quando uma condição deixa de
 * disparar, o evento aberto correspondente é resolvido automaticamente
 * (auto-healing: o banner de saúde não fica preso a um incidente já sanado).
 */
import type { Queue } from 'bullmq';
import { prisma, type ScraperHealthEventType } from '@inno/db';
import {
  checkZeroStreak,
  checkNameFillRate,
  checkPhoneFillRate,
  checkDataShape,
  type SanityCheckResult,
} from '@inno/scraper';
import { persistQueuePause } from '../lib/queue-state.js';
import { logger } from './logger.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const EVENT_TYPES: ScraperHealthEventType[] = ['zero_streak', 'fill_rate_name', 'fill_rate_phone', 'data_shape'];

async function gatherSanityInput() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  const [doneTasksDesc, recentLeadsDesc, sevenDayTotal, sevenDayWithPhone] = await Promise.all([
    prisma.searchTask.findMany({
      where: { status: 'done' },
      orderBy: { finishedAt: 'desc' },
      take: 20,
      select: { resultCount: true, city: { select: { population: true } } },
    }),
    prisma.lead.findMany({
      orderBy: { collectedAt: 'desc' },
      take: 50,
      select: { name: true, rating: true, phoneRaw: true, phoneE164: true },
    }),
    prisma.lead.count({ where: { collectedAt: { gte: sevenDaysAgo } } }),
    prisma.lead.count({ where: { collectedAt: { gte: sevenDaysAgo }, phoneE164: { not: null } } }),
  ]);

  // As assertions esperam janela em ordem cronológica (mais antiga primeiro,
  // ver comentário de `checkZeroStreak`/`checkNameFillRate`) — as queries
  // acima vêm mais-recente-primeiro (índice existente), então invertemos aqui.
  const recentTasks = doneTasksDesc
    .slice()
    .reverse()
    .map((t) => ({ resultCount: t.resultCount, cityPopulation: t.city.population }));

  const recentLeadsChrono = recentLeadsDesc.slice().reverse();
  const recentLeadNames = recentLeadsChrono.map((l) => l.name);
  const dataShapeSamples = recentLeadsChrono.map((l) => ({
    rating: l.rating,
    // Falha de normalização = tinha telefone bruto capturado e mesmo assim
    // não virou E.164 — telefone AUSENTE (nenhum dos dois preenchido) não é
    // falha de normalização, é ausência (não é isto que A4 mede).
    phoneNormalizationFailed: Boolean(l.phoneRaw) && !l.phoneE164,
  }));

  const currentWithPhone = recentLeadsDesc.filter((l) => l.phoneE164).length;
  const currentFillRate = recentLeadsDesc.length > 0 ? currentWithPhone / recentLeadsDesc.length : 0;
  const sevenDayAverageFillRate = sevenDayTotal > 0 ? sevenDayWithPhone / sevenDayTotal : 0;

  return {
    recentTasks,
    recentLeadNames,
    dataShapeSamples,
    phoneFillRate: { current: currentFillRate, sevenDayAverage: sevenDayAverageFillRate },
  };
}

function windowDescriptionFor(type: ScraperHealthEventType): string {
  switch (type) {
    case 'zero_streak':
      return 'últimas 5 tasks concluídas em municípios com população > 20.000';
    case 'fill_rate_name':
      return 'últimos 50 leads capturados';
    case 'fill_rate_phone':
      return 'últimos 50 leads capturados vs. média móvel de 7 dias';
    case 'data_shape':
      return 'últimos 50 leads capturados';
  }
}

/** Cria o evento só se não houver um já aberto do mesmo tipo. Devolve `true` se criou (incidente NOVO). */
async function recordHealthEventIfNew(
  type: ScraperHealthEventType,
  result: Extract<SanityCheckResult, { triggered: true }>,
): Promise<boolean> {
  const existing = await prisma.scraperHealthEvent.findFirst({ where: { type, resolvedAt: null } });
  if (existing) return false;

  await prisma.scraperHealthEvent.create({
    data: {
      type,
      severity: result.severity,
      window: windowDescriptionFor(type),
      metric: result.code,
      value: result.metric,
      threshold: result.threshold,
      message: result.message,
    },
  });
  return true;
}

async function resolveOpenHealthEvents(type: ScraperHealthEventType): Promise<void> {
  await prisma.scraperHealthEvent.updateMany({
    where: { type, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

/**
 * Roda A1-A4 contra o estado atual do banco, grava/resolve `ScraperHealthEvent`
 * e pausa a fila (BullMQ nativo + meta em Redis, `lib/queue-state.ts`) quando
 * A1 (zero-streak) ou A2 (fill-rate de nome) disparam — as únicas que pausam
 * (ARQUITETURA §5.7). NUNCA lança: erro aqui é logado e não deve derrubar a
 * task que acabou de fechar com sucesso (ver chamador em `scrape-search.job.ts`).
 */
export async function evaluateAndRecordSanity(scrapeQueue: Queue): Promise<void> {
  const input = await gatherSanityInput();

  const results: Record<ScraperHealthEventType, SanityCheckResult> = {
    zero_streak: checkZeroStreak(input.recentTasks),
    fill_rate_name: checkNameFillRate(input.recentLeadNames),
    fill_rate_phone: checkPhoneFillRate(input.phoneFillRate.current, input.phoneFillRate.sevenDayAverage),
    data_shape: checkDataShape(input.dataShapeSamples),
  };

  let newPausingResult: Extract<SanityCheckResult, { triggered: true }> | null = null;

  for (const type of EVENT_TYPES) {
    const result = results[type];
    if (!result.triggered) {
      await resolveOpenHealthEvents(type);
      continue;
    }

    const created = await recordHealthEventIfNew(type, result);
    logger.warn(
      { type, code: result.code, severity: result.severity, metric: result.metric, threshold: result.threshold, newIncident: created },
      'assertion de sanidade do scraper disparou',
    );
    if (result.pauseQueue && created) {
      newPausingResult = result;
    }
  }

  if (!newPausingResult) return;

  await scrapeQueue.pause();
  await persistQueuePause(scrapeQueue, {
    code: newPausingResult.code,
    message: newPausingResult.message,
    severity: newPausingResult.severity,
    source: 'sanity',
    pausedAt: new Date().toISOString(),
    // Assertion de sanidade nunca retoma sozinha — exige investigação humana
    // (conserto de seletor/investigação de fill-rate) + `POST
    // /api/v1/scraper/queue/resume` (`acknowledge: true`).
    resumeAt: null,
  });

  logger[newPausingResult.severity === 'critical' ? 'fatal' : 'error'](
    { code: newPausingResult.code, metric: newPausingResult.metric, threshold: newPausingResult.threshold },
    'scrape:search queue pausada — assertion de sanidade disparou (intervenção humana necessária)',
  );
}
