/**
 * test/fake-db.ts — banco falso, em memória, para `jobs/scrape-search.job.ts`
 * (o processador de `SearchTask`, ARQUITETURA §1.5 Fluxo A / §5.6). Cobre só
 * os métodos que ELE realmente chama (mesma filosofia de
 * `apps/web/src/test/fake-db.ts`, REVISAO-QA.md §3): claim atômico de task,
 * upsert de lead com dedupe, e as duas fases de fechamento de SearchJob.
 *
 * Por que isto importa: até 2026-09-23 `createScrapeSearchProcessor`
 * (o coração do produto — é o que grava cada lead que existe no banco) nunca
 * tinha sido exercitado por nenhum teste; só `pauseQueueFor` tinha rede. Ver
 * `.claude/agent-memory/iris/project_innoprospect_testing.md` (inventário
 * "o que está provado vs no escuro").
 */
import { vi } from 'vitest';

export interface FakeCity {
  ibgeCode: string;
  name: string;
  uf: string;
  population: number;
}

export interface FakeSearchJob {
  id: string;
  niche: string;
  uf: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  leadsFound: number;
  leadsNew: number;
  maxResultsPerCity: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface FakeSearchTask {
  id: string;
  searchJobId: string;
  cityId: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  resultCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface FakeLead {
  id: string;
  name: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneType: string;
  address: string | null;
  cityId: string;
  uf: string;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;
  dedupeKey: string;
  offNiche: boolean;
  sourceType: string;
  sourceUrl: string;
  sourceQuery: string;
  collectedAt: Date;
  lastSeenAt: Date;
  searchJobId: string;
  searchTaskId: string;
  engineId: string;
}

export interface FakeDbSeed {
  cities?: FakeCity[];
  searchJobs?: FakeSearchJob[];
  searchTasks?: FakeSearchTask[];
  leads?: FakeLead[];
}

const store = {
  cities: [] as FakeCity[],
  searchJobs: [] as FakeSearchJob[],
  searchTasks: [] as FakeSearchTask[],
  leads: [] as FakeLead[],
};

let nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

/** Limpa e resemeia o fake db — chamar em `beforeEach`. */
export function resetFakeDb(seed: FakeDbSeed = {}): void {
  store.cities = seed.cities ? [...seed.cities] : [];
  store.searchJobs = seed.searchJobs ? seed.searchJobs.map((j) => ({ ...j })) : [];
  store.searchTasks = seed.searchTasks ? seed.searchTasks.map((t) => ({ ...t })) : [];
  store.leads = seed.leads ? seed.leads.map((l) => ({ ...l })) : [];
  nextId = 1;
}

/** Estado atual — usar em asserções (`getFakeDbState().leads`). */
export function getFakeDbState() {
  return store;
}

function findCity(ibgeCode: string): FakeCity {
  const city = store.cities.find((c) => c.ibgeCode === ibgeCode);
  if (!city) throw new Error(`fake-db: city ${ibgeCode} não encontrada — seed do teste está incompleto`);
  return city;
}

function findSearchJob(id: string): FakeSearchJob {
  const job = store.searchJobs.find((j) => j.id === id);
  if (!job) throw new Error(`fake-db: searchJob ${id} não encontrado — seed do teste está incompleto`);
  return job;
}

function applyIncrementsOrSets(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
      const current = (target[key] as number | undefined) ?? 0;
      target[key] = current + (value as { increment: number }).increment;
    } else {
      target[key] = value;
    }
  }
}

/** Cliente único, compartilhado por todos os testes que o importam — resetar via `resetFakeDb()`, nunca recriar. */
export const fakePrismaClient = {
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof fakePrismaClient) => unknown)(fakePrismaClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),

  searchTask: {
    /** Claim atômico: só afeta a linha se `status: 'pending'` — é o que `claimTask` depende. */
    updateMany: vi.fn(
      async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const task = store.searchTasks.find((t) => t.id === where.id);
        if (!task || (where.status !== undefined && task.status !== where.status)) {
          return { count: 0 };
        }
        applyIncrementsOrSets(task as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const task = store.searchTasks.find((t) => t.id === where.id);
      if (!task) return null;
      const job = findSearchJob(task.searchJobId);
      const city = findCity(task.cityId);
      return { ...task, city, searchJob: job };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const task = store.searchTasks.find((t) => t.id === where.id);
      if (!task) throw new Error(`fake-db: searchTask ${where.id} não encontrada`);
      applyIncrementsOrSets(task as unknown as Record<string, unknown>, data);
      return { ...task };
    }),
  },

  searchJob: {
    updateMany: vi.fn(
      async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const job = store.searchJobs.find((j) => j.id === where.id);
        if (!job || (where.status !== undefined && job.status !== where.status)) {
          return { count: 0 };
        }
        applyIncrementsOrSets(job as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const job = store.searchJobs.find((j) => j.id === where.id);
      return job ? { ...job } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const job = store.searchJobs.find((j) => j.id === where.id);
      if (!job) throw new Error(`fake-db: searchJob ${where.id} não encontrado`);
      applyIncrementsOrSets(job as unknown as Record<string, unknown>, data);
      return { ...job };
    }),
  },

  lead: {
    findUnique: vi.fn(async ({ where }: { where: { dedupeKey: string } }) => {
      const lead = store.leads.find((l) => l.dedupeKey === where.dedupeKey);
      if (!lead) return null;
      const originJob = findSearchJob(lead.searchJobId);
      return { id: lead.id, searchJob: { niche: originJob.niche } };
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { dedupeKey: string };
        create: Omit<FakeLead, 'id'>;
        update: Record<string, unknown>;
      }) => {
        const existing = store.leads.find((l) => l.dedupeKey === where.dedupeKey);
        if (existing) {
          applyIncrementsOrSets(existing as unknown as Record<string, unknown>, update);
          return { ...existing };
        }
        const created: FakeLead = { id: genId('lead'), ...create };
        store.leads.push(created);
        return { ...created };
      },
    ),
  },
};
