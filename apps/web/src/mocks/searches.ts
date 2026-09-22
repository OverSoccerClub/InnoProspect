import type {
  CreateSearchRequest,
  CreateSearchResponse,
  SearchJobDetail,
  SearchJobSummary,
  SearchTaskItem,
} from '@/types/search';
import { mockListCities } from './locations';
import { mockNotFound, mulberry32 } from './utils';

type MockJob = {
  id: string;
  name: string;
  niche: string;
  uf: string;
  createdAtMs: number;
  createdAt: string;
  /** true = progresso derivado do tempo (demonstra o polling); false = estado fixo, já "histórico". */
  live: boolean;
  fixedStatus?: SearchJobSummary['status'];
  cities: Array<{ ibgeCode: string; nome: string }>;
  secondsPerTask: number;
  /** para o job "failed" fixo, quantas tasks falham antes de parar */
  failAt?: number;
  /**
   * Reproduz o bug real relatado em produção: job `completed` em que TODOS
   * os municípios falharam (0 concluídos, 0 leads) — distinto do cenário
   * `failAt` acima, que é o job travando no meio (status `failed`).
   */
  failAll?: boolean;
  /** Job `completed` com falha PARCIAL — os últimos N municípios falham, o resto conclui normalmente. */
  failCount?: number;
};

let seq = 100;
const jobs: MockJob[] = [];

function makeTaskList(job: MockJob): SearchTaskItem[] {
  const random = mulberry32(job.id.length * 7919 + job.cities.length);
  return job.cities.map((city, index) => {
    const willFail =
      job.failAll ||
      (job.failAt !== undefined && index === job.failAt) ||
      (job.failCount !== undefined && index >= job.cities.length - job.failCount);
    return {
      id: `${job.id}_task_${index}`,
      cityName: city.nome,
      ibgeCode: city.ibgeCode,
      status: 'pending' as const,
      resultCount: willFail ? 0 : Math.floor(random() * 45),
      attempt: 1,
      errorCode: willFail ? 'SCRAPE_TIMEOUT' : null,
      finishedAt: null,
    };
  });
}

function computeSummary(job: MockJob): SearchJobSummary {
  const total = job.cities.length;
  const tasks = makeTaskList(job);

  if (!job.live) {
    const status = job.fixedStatus ?? 'completed';
    let done = total;
    if (status === 'failed') done = job.failAt ?? Math.floor(total * 0.4);
    if (status === 'cancelled') done = Math.floor(total * 0.55);
    if (job.failAll) done = 0;
    if (job.failCount) done = Math.max(0, total - job.failCount);
    const failed = job.failAll ? total : job.failCount ?? (status === 'failed' ? 1 : 0);
    const leadsFound = tasks.slice(0, done).reduce((sum, t) => sum + t.resultCount, 0);
    return {
      id: job.id,
      name: job.name,
      niche: job.niche,
      uf: job.uf,
      status,
      progress: { total, done, failed, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
      leadsFound,
      leadsNew: Math.round(leadsFound * 0.82),
      createdAt: job.createdAt,
      startedAt: job.createdAt,
      finishedAt: status === 'running' || status === 'queued' ? null : job.createdAt,
    };
  }

  const elapsedSec = (Date.now() - job.createdAtMs) / 1000;
  const done = Math.min(total, Math.floor(elapsedSec / job.secondsPerTask));
  const status: SearchJobSummary['status'] = done === 0 ? 'queued' : done >= total ? 'completed' : 'running';
  const leadsFound = tasks.slice(0, done).reduce((sum, t) => sum + t.resultCount, 0);

  return {
    id: job.id,
    name: job.name,
    niche: job.niche,
    uf: job.uf,
    status,
    progress: { total, done, failed: 0, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
    leadsFound,
    leadsNew: Math.round(leadsFound * 0.82),
    createdAt: job.createdAt,
    startedAt: done > 0 ? job.createdAt : null,
    finishedAt: status === 'completed' ? new Date(job.createdAtMs + total * job.secondsPerTask * 1000).toISOString() : null,
  };
}

function computeDetail(job: MockJob): SearchJobDetail {
  const summary = computeSummary(job);
  const tasks = makeTaskList(job);

  const filled = tasks.map((task, index) => {
    if (job.failAll) {
      return { ...task, status: 'failed' as const, errorCode: task.errorCode ?? 'SCRAPE_TIMEOUT', finishedAt: job.createdAt };
    }
    if (index < summary.progress.done) {
      const isFailingOne = job.failAt === index && !job.live;
      return {
        ...task,
        status: isFailingOne ? ('failed' as const) : ('done' as const),
        finishedAt: job.createdAt,
      };
    }
    if (index === summary.progress.done && summary.status === 'running') {
      return { ...task, status: 'running' as const };
    }
    if (job.failCount && index >= summary.progress.done) {
      return { ...task, status: 'failed' as const, errorCode: task.errorCode ?? 'SCRAPE_TIMEOUT', finishedAt: job.createdAt };
    }
    if (!job.live && job.fixedStatus === 'cancelled' && index >= summary.progress.done) {
      return { ...task, status: 'skipped' as const };
    }
    return task;
  });

  return { ...summary, tasks: filled, error: job.fixedStatus === 'failed' ? 'Muitas tentativas falharam para o município de origem do erro.' : undefined };
}

function seedIfNeeded() {
  if (jobs.length > 0) return;
  const now = Date.now();

  const spCities = mockListCities('SP').slice(0, 12).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));
  const esCities = mockListCities('ES').slice(0, 18).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));
  const mgCities = mockListCities('MG').slice(0, 9).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));
  const rjCities = mockListCities('RJ').slice(0, 6).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));
  const prCities = mockListCities('PR').slice(0, 5).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));
  const pbCities = mockListCities('PB').slice(0, 8).map((c) => ({ ibgeCode: c.ibgeCode, nome: c.nome }));

  jobs.push(
    {
      id: 'search_running_demo',
      name: 'clínica odontológica — SP',
      niche: 'clínica odontológica',
      uf: 'SP',
      createdAtMs: now - 14_000,
      createdAt: new Date(now - 14_000).toISOString(),
      live: true,
      cities: spCities,
      secondsPerTask: 6,
    },
    {
      id: 'search_completed_demo',
      name: 'restaurante — ES',
      niche: 'restaurante',
      uf: 'ES',
      createdAtMs: now - 86_400_000,
      createdAt: new Date(now - 86_400_000).toISOString(),
      live: false,
      fixedStatus: 'completed',
      cities: esCities,
      secondsPerTask: 4,
    },
    {
      id: 'search_failed_demo',
      name: 'escritório de advocacia — MG',
      niche: 'escritório de advocacia',
      uf: 'MG',
      createdAtMs: now - 3_600_000,
      createdAt: new Date(now - 3_600_000).toISOString(),
      live: false,
      fixedStatus: 'failed',
      cities: mgCities,
      secondsPerTask: 4,
      failAt: 3,
    },
    {
      id: 'search_cancelled_demo',
      name: 'pet shop — RJ',
      niche: 'pet shop',
      uf: 'RJ',
      createdAtMs: now - 7_200_000,
      createdAt: new Date(now - 7_200_000).toISOString(),
      live: false,
      fixedStatus: 'cancelled',
      cities: rjCities,
      secondsPerTask: 4,
    },
    {
      // Reproduz o bug real relatado pelo dono: 5 municípios, todos falharam,
      // 0 leads — e a API ainda assim devolve status `completed`.
      id: 'search_completed_empty_demo',
      name: 'barbearia — PR',
      niche: 'barbearia',
      uf: 'PR',
      createdAtMs: now - 5_400_000,
      createdAt: new Date(now - 5_400_000).toISOString(),
      live: false,
      fixedStatus: 'completed',
      cities: prCities,
      secondsPerTask: 4,
      failAll: true,
    },
    {
      id: 'search_completed_partial_demo',
      name: 'imobiliária — PB',
      niche: 'imobiliária',
      uf: 'PB',
      createdAtMs: now - 10_800_000,
      createdAt: new Date(now - 10_800_000).toISOString(),
      live: false,
      fixedStatus: 'completed',
      cities: pbCities,
      secondsPerTask: 4,
      failCount: 3,
    },
  );
}

export function mockListSearchJobs(params: { status?: string; uf?: string; q?: string }): SearchJobSummary[] {
  seedIfNeeded();
  let result = jobs.map(computeSummary);
  if (params.status) {
    const statuses = params.status.split(',');
    result = result.filter((j) => statuses.includes(j.status));
  }
  if (params.uf) {
    const ufs = params.uf.split(',');
    result = result.filter((j) => ufs.includes(j.uf));
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    result = result.filter((j) => j.niche.toLowerCase().includes(q) || j.name.toLowerCase().includes(q));
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function mockGetSearchJob(id: string): SearchJobDetail {
  seedIfNeeded();
  const job = jobs.find((j) => j.id === id);
  if (!job) mockNotFound(`Busca "${id}" não encontrada.`);
  return computeDetail(job);
}

export function mockCreateSearchJob(input: CreateSearchRequest): CreateSearchResponse {
  seedIfNeeded();
  const random = mulberry32(Date.now() % 100000);
  const cityPool = mockListCities(input.uf.toUpperCase());
  const chosen =
    input.cityIbgeCodes && input.cityIbgeCodes.length > 0
      ? cityPool.filter((c) => input.cityIbgeCodes?.includes(c.ibgeCode))
      : cityPool;

  const cities = (chosen.length > 0 ? chosen : cityPool.slice(0, 5)).map((c) => ({
    ibgeCode: c.ibgeCode,
    nome: c.nome,
  }));

  const id = `search_${seq++}`;
  const now = Date.now();
  const job: MockJob = {
    id,
    name: input.name?.trim() || `${input.niche} — ${input.uf.toUpperCase()}`,
    niche: input.niche,
    uf: input.uf.toUpperCase(),
    createdAtMs: now,
    createdAt: new Date(now).toISOString(),
    live: true,
    cities,
    secondsPerTask: 5 + Math.floor(random() * 3),
  };
  jobs.unshift(job);

  return {
    id,
    name: job.name,
    niche: job.niche,
    uf: job.uf,
    status: 'queued',
    totalTasks: cities.length,
    doneTasks: 0,
    leadsFound: 0,
    leadsNew: 0,
    createdAt: job.createdAt,
    estimatedDurationMinutes: Math.max(1, Math.round((cities.length * 40) / 60)),
  };
}

export function mockCancelSearchJob(id: string): { ok: true; status: 'cancelled'; cancelledTasks: number } {
  seedIfNeeded();
  const job = jobs.find((j) => j.id === id);
  if (!job) mockNotFound(`Busca "${id}" não encontrada.`);
  const before = computeSummary(job);
  job.live = false;
  job.fixedStatus = 'cancelled';
  job.createdAtMs = Date.now() - before.progress.done * job.secondsPerTask * 1000;
  const after = computeSummary(job);
  return { ok: true, status: 'cancelled', cancelledTasks: after.progress.total - after.progress.done };
}
