/**
 * observability/sanity.ts — liga as assertions A1-A5 (`@inno/scraper/sanity`,
 * escritas e testadas, mas com zero chamadores até a Onda 1 — REVISAO-
 * ARQUITETURA §5.7/Onda 1 item 1.1: "o modo de falha mais perigoso do projeto
 * é o sucesso silencioso") ao banco real e à fila `scrape-search`.
 *
 * A5 (`checkEnrichmentFillRate`) acrescentada em 2026-09-23: ~260 leads
 * chegaram coletados só com o nome (endereço/telefone/categoria/site TODOS
 * vazios) e nenhuma das A1-A4 disparou — elas medem quantidade (A1),
 * ausência de UM campo isolado (A2 nome, A3 telefone) ou FORMATO (A4), nunca
 * "quão preenchido, no total, um lead ficou". Ver comentário completo em
 * `@inno/scraper/sanity/assertions.ts#checkEnrichmentFillRate`.
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
  checkEnrichmentFillRate,
  type SanityCheckResult,
} from '@inno/scraper';
import { persistQueuePause } from '../lib/queue-state.js';
import { logger } from './logger.js';
import { sendAlert } from './alerts.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const EVENT_TYPES: ScraperHealthEventType[] = [
  'zero_streak',
  'fill_rate_name',
  'fill_rate_phone',
  'data_shape',
  'fill_rate_enrichment',
];

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
      select: { name: true, rating: true, phoneRaw: true, phoneE164: true, address: true, category: true, website: true },
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
  // A5 — `hasPhone` conta RAW OU E.164 (o que importa aqui é "a Evolution/o
  // Maps devolveu ALGUM telefone", não se ele normalizou — normalização
  // falhando é o problema que A4/`dataShapeSamples` já cobre acima).
  const enrichmentSamples = recentLeadsChrono.map((l) => ({
    hasAddress: Boolean(l.address && l.address.trim().length > 0),
    hasPhone: Boolean(l.phoneRaw || l.phoneE164),
    hasCategory: Boolean(l.category && l.category.trim().length > 0),
    hasWebsite: Boolean(l.website && l.website.trim().length > 0),
  }));

  const currentWithPhone = recentLeadsDesc.filter((l) => l.phoneE164).length;
  const currentFillRate = recentLeadsDesc.length > 0 ? currentWithPhone / recentLeadsDesc.length : 0;
  const sevenDayAverageFillRate = sevenDayTotal > 0 ? sevenDayWithPhone / sevenDayTotal : 0;

  return {
    recentTasks,
    recentLeadNames,
    dataShapeSamples,
    enrichmentSamples,
    phoneFillRate: {
      current: currentFillRate,
      // Tamanho da MESMA janela usada para `current` (últimos até 50 leads)
      // — é o que faz o piso absoluto (`checkPhoneFillRate`) não disparar
      // com amostra pequena/ruidosa logo depois do primeiro lead coletado.
      currentSampleSize: recentLeadsDesc.length,
      sevenDayAverage: sevenDayAverageFillRate,
    },
  };
}

function windowDescriptionFor(type: ScraperHealthEventType): string {
  switch (type) {
    case 'zero_streak':
      return 'últimas 5 tasks concluídas em municípios com população > 20.000';
    case 'fill_rate_name':
      return 'últimos 50 leads capturados';
    case 'fill_rate_phone':
      return 'últimos 50 leads capturados — piso absoluto de 20% (amostra >= 20) OU vs. média móvel de 7 dias';
    case 'data_shape':
      return 'últimos 50 leads capturados';
    case 'fill_rate_enrichment':
      return 'últimos 50 leads capturados — piso de 30% de leads "só com o nome" (amostra >= 20)';
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
    fill_rate_phone: checkPhoneFillRate(
      { fillRate: input.phoneFillRate.current, sampleSize: input.phoneFillRate.currentSampleSize },
      input.phoneFillRate.sevenDayAverage,
    ),
    data_shape: checkDataShape(input.dataShapeSamples),
    fill_rate_enrichment: checkEnrichmentFillRate(input.enrichmentSamples),
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

    // Alerta só quando o incidente é NOVO (`created`) — enquanto o mesmo tipo
    // continuar disparando em ciclos seguintes, `recordHealthEventIfNew` acha
    // o evento já aberto e devolve `false`, então não realertamos a cada
    // task. `SanitySeverity` só tem 'high'|'critical' (ver
    // packages/scraper/src/sanity/assertions.ts) — todo incidente de
    // sanidade já se qualifica, não há um terceiro nível "low" para filtrar.
    if (created) {
      await sendAlert({
        kind: 'sanity_incident_opened',
        code: result.code,
        severity: result.severity,
        message: result.message,
        metric: result.metric,
        threshold: result.threshold,
      });
    }

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
    'scrape-search queue pausada — assertion de sanidade disparou (intervenção humana necessária)',
  );
}
