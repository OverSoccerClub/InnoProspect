/**
 * lib/services/searches.ts — lógica de negócio de `SearchJob`/`SearchTask`
 * (ARQUITETURA §4.2). As rotas em `app/api/v1/searches/**` só validam
 * (já feito pelo `api-handler.ts`) e chamam estas funções — nenhuma query
 * Prisma deve viver direto no `route.ts`.
 */
import { prisma, type Prisma, type SearchJob } from '@inno/db';
import { isValidUf } from '@inno/core';
import type {
  CreateSearchJobBody,
  CreateSearchJobResponse,
  ListSearchJobsQuery,
  Paginated,
  SearchJobDetail,
  SearchJobSummary,
} from '@inno/contracts';
import { badRequest, conflict, notFound } from '@/lib/api-handler';
import { enqueueScrapeSearchTask } from '@/lib/queue';
import { logger } from '@/lib/logger';

/**
 * Mesma normalização/formato de `packages/scraper/src/engine/playwright-engine.ts#buildQueryString`
 * (CONTRATO, ARQUITETURA §5.2: `${niche} em ${city.name}, ${uf}`). Duplicado
 * aqui de propósito em vez de importado: `@inno/scraper` carrega o pacote
 * `playwright` no import de nível de módulo (via `engine/browser.ts`), o que
 * infla o bundle do servidor Next.js com o Chromium — `apps/web` nunca deve
 * depender de `@inno/scraper`. Se a normalização mudar lá, mudar aqui também.
 */
function buildQueryString(niche: string, cityName: string, uf: string): string {
  const normalizedNiche = niche.trim().replace(/\s+/g, ' ');
  const normalizedCity = cityName.trim().replace(/\s+/g, ' ');
  return `${normalizedNiche} em ${normalizedCity}, ${uf}`;
}

/** Heurística do contrato: `totalTasks * ~40s / concorrência` (ARQUITETURA §4.2). */
function estimateDurationMinutes(totalTasks: number): number {
  const concurrency = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY ?? 2));
  const seconds = (totalTasks * 40) / concurrency;
  return Math.max(1, Math.round(seconds / 60));
}

function computeProgressPercent(totalTasks: number, doneTasks: number, failedTasks: number): number {
  if (totalTasks <= 0) return 0;
  return Math.round(((doneTasks + failedTasks) / totalTasks) * 100);
}

function toSummary(job: SearchJob): SearchJobSummary {
  return {
    id: job.id,
    name: job.name,
    niche: job.niche,
    uf: job.uf,
    status: job.status,
    progress: {
      total: job.totalTasks,
      done: job.doneTasks,
      failed: job.failedTasks,
      percent: computeProgressPercent(job.totalTasks, job.doneTasks, job.failedTasks),
    },
    leadsFound: job.leadsFound,
    leadsNew: job.leadsNew,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function createSearchJob(input: CreateSearchJobBody, createdById: string): Promise<CreateSearchJobResponse> {
  if (!isValidUf(input.uf)) {
    badRequest('UF inválida.', [{ path: 'uf', message: `"${input.uf}" não é uma UF brasileira válida.` }]);
  }

  const uf = await prisma.uf.findUnique({ where: { sigla: input.uf } });
  if (!uf) {
    badRequest('UF inválida.', [{ path: 'uf', message: `UF "${input.uf}" não está cadastrada (seed do IBGE pendente?).` }]);
  }

  const cities = input.cityIbgeCodes?.length
    ? await prisma.city.findMany({ where: { ibgeCode: { in: input.cityIbgeCodes }, uf: input.uf } })
    : await prisma.city.findMany({ where: { uf: input.uf } });

  if (input.cityIbgeCodes?.length && cities.length !== input.cityIbgeCodes.length) {
    const found = new Set(cities.map((c) => c.ibgeCode));
    const missing = input.cityIbgeCodes.filter((code) => !found.has(code));
    badRequest('Um ou mais municípios informados são inválidos para esta UF.', [
      { path: 'cityIbgeCodes', message: `Código(s) IBGE não encontrado(s) em ${input.uf}: ${missing.join(', ')}` },
    ]);
  }

  if (cities.length === 0) {
    badRequest('Nenhum município encontrado para esta UF.', [{ path: 'cityIbgeCodes', message: 'Lista de municípios vazia.' }]);
  }

  // Checagem "amigável" (mensagem específica) — a garantia de verdade contra
  // corrida é o índice único parcial `search_jobs_active_niche_uf_key`
  // (Cronos, migration.sql), que o `api-handler.ts` traduz de `P2002` para
  // `409 CONFLICT` caso duas requisições concorrentes passem por aqui juntas.
  const activeJob = await prisma.searchJob.findFirst({
    where: { niche: input.niche, uf: input.uf, status: { in: ['queued', 'running'] } },
  });
  if (activeJob) {
    conflict(`Já existe uma busca ativa para "${input.niche}" em ${input.uf} (id: ${activeJob.id}).`);
  }

  cities.sort((a, b) => b.population - a.population);
  const name = input.name?.trim() || `${input.niche} — ${input.uf}`;

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.searchJob.create({
      data: {
        name,
        niche: input.niche,
        uf: input.uf,
        cityIbgeCodes: input.cityIbgeCodes ?? [],
        maxResultsPerCity: input.maxResultsPerCity,
        totalTasks: cities.length,
        createdById,
      },
    });

    await tx.searchTask.createMany({
      data: cities.map((city) => ({
        searchJobId: created.id,
        cityId: city.ibgeCode,
        queryString: buildQueryString(input.niche, city.name, input.uf),
        priority: city.population,
      })),
    });

    return created;
  });

  const tasks = await prisma.searchTask.findMany({
    where: { searchJobId: job.id },
    include: { city: true },
  });

  // Enfileira fora da transação (Redis não participa da transação do
  // Postgres — "Redis é volátil por design; a verdade está no Postgres",
  // ARQUITETURA §1.3). Se o enqueue falhar aqui, as tasks ficam `pending`
  // no banco esperando reprocessamento manual (`retry-failed`) — o job
  // `requeue-orphans` no boot do worker (R10, ainda não implementado) é
  // quem fecharia esse buraco de vez.
  await Promise.all(
    tasks.map(async (task) => {
      try {
        await enqueueScrapeSearchTask(task.id, task.city.population);
      } catch (err) {
        logger.error('falha ao enfileirar SearchTask', { searchTaskId: task.id, searchJobId: job.id, err: err instanceof Error ? err : new Error(String(err)) });
      }
    }),
  );

  return {
    id: job.id,
    name: job.name,
    niche: job.niche,
    uf: job.uf,
    status: 'queued',
    totalTasks: job.totalTasks,
    doneTasks: 0,
    leadsFound: 0,
    leadsNew: 0,
    createdAt: job.createdAt.toISOString(),
    estimatedDurationMinutes: estimateDurationMinutes(job.totalTasks),
  };
}

export async function listSearchJobs(query: ListSearchJobsQuery): Promise<Paginated<SearchJobSummary>> {
  const where: Prisma.SearchJobWhereInput = {};
  if (query.status?.length) where.status = { in: query.status };
  if (query.uf) where.uf = query.uf;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { niche: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.searchJob.count({ where }),
    prisma.searchJob.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  return {
    data: page.map(toSummary),
    page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total },
  };
}

export async function getSearchJobDetail(id: string): Promise<SearchJobDetail> {
  const job = await prisma.searchJob.findUnique({
    where: { id },
    include: { tasks: { include: { city: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] } },
  });
  if (!job) notFound('Busca não encontrada.');

  return {
    ...toSummary(job),
    error: job.errorMessage ?? undefined,
    tasks: job.tasks.map((task) => ({
      id: task.id,
      cityName: task.city.name,
      ibgeCode: task.city.ibgeCode,
      status: task.status,
      resultCount: task.resultCount,
      attempt: task.attempt,
      errorCode: task.errorCode,
      finishedAt: task.finishedAt?.toISOString() ?? null,
    })),
  };
}

export async function cancelSearchJob(id: string): Promise<{ ok: true; status: 'cancelled'; cancelledTasks: number }> {
  const job = await prisma.searchJob.findUnique({ where: { id } });
  if (!job) notFound('Busca não encontrada.');
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
    conflict(`Busca já está em estado final ("${job.status}") — não é possível cancelar.`);
  }

  const [, tasksResult] = await prisma.$transaction([
    prisma.searchJob.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } }),
    prisma.searchTask.updateMany({
      where: { searchJobId: id, status: 'pending' },
      data: { status: 'skipped', finishedAt: new Date() },
    }),
  ]);

  return { ok: true, status: 'cancelled', cancelledTasks: tasksResult.count };
}

export async function retryFailedSearchTasks(id: string): Promise<{ ok: true; requeuedTasks: number }> {
  const job = await prisma.searchJob.findUnique({ where: { id } });
  if (!job) notFound('Busca não encontrada.');
  if (job.status === 'cancelled') {
    conflict('Busca foi cancelada — não é possível reprocessar tasks falhas.');
  }

  const failedTasks = await prisma.searchTask.findMany({
    where: { searchJobId: id, status: 'failed' },
    include: { city: true },
  });
  if (failedTasks.length === 0) {
    return { ok: true, requeuedTasks: 0 };
  }

  await prisma.$transaction([
    prisma.searchTask.updateMany({
      where: { id: { in: failedTasks.map((t) => t.id) } },
      data: { status: 'pending', attempt: 0, errorCode: null, errorMessage: null, finishedAt: null },
    }),
    prisma.searchJob.update({
      where: { id },
      data: { failedTasks: { decrement: failedTasks.length }, status: 'running', finishedAt: null },
    }),
  ]);

  await Promise.all(
    failedTasks.map(async (task) => {
      try {
        await enqueueScrapeSearchTask(task.id, task.city.population);
      } catch (err) {
        logger.error('falha ao reenfileirar SearchTask (retry-failed)', {
          searchTaskId: task.id,
          searchJobId: id,
          err: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }),
  );

  return { ok: true, requeuedTasks: failedTasks.length };
}
