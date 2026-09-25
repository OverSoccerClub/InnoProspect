/**
 * test/fake-dispatch-db.ts — banco falso, em memória, para
 * `jobs/dispatch-tick.job.ts` (o motor de disparo). Mesma filosofia de
 * `apps/web/src/test/fake-db.ts` (REVISAO-QA.md §3): cobre só os métodos que
 * o tick e `executeSendAttempt` (`@inno/sending`, chamado de verdade, NÃO
 * mockado) realmente usam.
 *
 * `$queryRaw` simula o claim atômico (`FOR UPDATE SKIP LOCKED`,
 * `lib/dispatch-claim.ts`) por TEXTO da query (mesmo padrão de
 * `apps/web/src/lib/services/dashboard.test.ts`) — sem Postgres real, não dá
 * pra provar exclusão mútua entre dois processos; o que ESTE fake prova é o
 * CONTRATO da função (claim 1 alvo `pending` devido, avança `scheduledFor`/
 * `attempt`) e, mais importante, que `Message.campaignTargetId @unique` (não
 * o claim) é quem impede o envio duplicado — ver o teste dedicado.
 */
import { vi } from 'vitest';

export interface FakeLead {
  id: string;
  name: string;
  uf: string;
  category: string | null;
  website: string | null;
  phoneE164: string | null;
  phoneType: string;
  status: string;
  cityName: string | null;
}

export interface FakeMessage {
  id: string;
  leadId: string;
  instanceId: string;
  direction: string;
  body: string;
  status: string;
  campaignTargetId: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface FakeCampaignTarget {
  id: string;
  campaignId: string;
  leadId: string;
  phoneE164: string;
  status: string;
  skipReason: string | null;
  scheduledFor: Date | null;
  attempt: number;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeCampaignInstance {
  id: string;
  campaignId: string;
  instanceId: string;
  sentCount: number;
  failedCount: number;
}

export interface FakeCampaign {
  id: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  haltReason: string | null;
  renderedTemplateSnapshot: string | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendWindowDaysOfWeek: number[];
  jitterMinSeconds: number;
  jitterMaxSeconds: number;
  dailyLimitPerInstance: number | null;
  totalTargets: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  respondedCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface FakeWhatsAppInstance {
  id: string;
  name: string;
  status: string;
  isDegraded: boolean;
  consecutiveFailures: number;
  consecutiveUncertain: number;
  warmupDay: number;
  dailyLimitOverride: number | null;
  nextSendAllowedAt: Date | null;
  sendsSinceMicroPause: number;
  evolutionServerId: string | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  /** 🆕 Fase 4.F.5 — `jobs/warmup-roll.job.test.ts`/`jobs/health-check.job.test.ts`. Default `true` no seed (nenhum teste anterior a esta rodada precisava filtrar por isto). */
  isActive?: boolean;
  /** 🆕 Fase 4.F.5 — `jobs/health-check.job.test.ts`/`jobs/warmup-roll.job.test.ts`. `null`/ausente = não congelado (default de produção). */
  warmupFrozenAt?: Date | null;
}

/** 🆕 Fase 4.F.5 — `jobs/health-check.job.test.ts` (ping em toda `EvolutionServer` ativa). */
export interface FakeEvolutionServer {
  id: string;
  baseUrl: string;
  isActive: boolean;
  apiKeyCiphertext: Buffer;
  apiKeyIv: Buffer;
  apiKeyAuthTag: Buffer;
  apiKeyKeyVersion: number;
}

export interface FakeInstanceDailyStat {
  instanceId: string;
  date: Date;
  sentCount: number;
  failedCount: number;
}

export interface FakeOptOut {
  phoneE164: string;
}

export interface FakeLeadActivity {
  id: string;
  leadId: string;
  type: string;
  payload: unknown;
  actor: string;
  actorUserId: string | null;
}

export interface FakeDbSeed {
  leads?: FakeLead[];
  campaigns?: FakeCampaign[];
  campaignInstances?: FakeCampaignInstance[];
  campaignTargets?: FakeCampaignTarget[];
  whatsAppInstances?: FakeWhatsAppInstance[];
  instanceDailyStats?: FakeInstanceDailyStat[];
  optOuts?: FakeOptOut[];
  messages?: FakeMessage[];
  evolutionServers?: FakeEvolutionServer[];
}

const store = {
  leads: [] as FakeLead[],
  campaigns: [] as FakeCampaign[],
  campaignInstances: [] as FakeCampaignInstance[],
  campaignTargets: [] as FakeCampaignTarget[],
  whatsAppInstances: [] as FakeWhatsAppInstance[],
  instanceDailyStats: [] as FakeInstanceDailyStat[],
  optOuts: [] as FakeOptOut[],
  messages: [] as FakeMessage[],
  leadActivities: [] as FakeLeadActivity[],
  evolutionServers: [] as FakeEvolutionServer[],
};

let nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

export function resetFakeDispatchDb(seed: FakeDbSeed = {}): void {
  store.leads = seed.leads ? seed.leads.map((l) => ({ ...l })) : [];
  store.campaigns = seed.campaigns ? seed.campaigns.map((c) => ({ ...c })) : [];
  store.campaignInstances = seed.campaignInstances ? seed.campaignInstances.map((ci) => ({ ...ci })) : [];
  store.campaignTargets = seed.campaignTargets ? seed.campaignTargets.map((t) => ({ ...t })) : [];
  store.whatsAppInstances = seed.whatsAppInstances ? seed.whatsAppInstances.map((i) => ({ ...i })) : [];
  store.instanceDailyStats = seed.instanceDailyStats ? seed.instanceDailyStats.map((s) => ({ ...s })) : [];
  store.optOuts = seed.optOuts ? seed.optOuts.map((o) => ({ ...o })) : [];
  store.messages = seed.messages ? seed.messages.map((m) => ({ ...m })) : [];
  store.leadActivities = [];
  store.evolutionServers = seed.evolutionServers ? seed.evolutionServers.map((s) => ({ ...s })) : [];
  nextId = 1;
}

export function getFakeDispatchDbState() {
  return store;
}

function applyIncrementsOrSets(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
      const current = (target[key] as number | undefined) ?? 0;
      target[key] = current + (value as { increment: number }).increment;
    } else if (value !== null && typeof value === 'object' && 'decrement' in (value as Record<string, unknown>)) {
      const current = (target[key] as number | undefined) ?? 0;
      target[key] = current - (value as { decrement: number }).decrement;
    } else {
      target[key] = value;
    }
  }
}

function throwNotFound(what: string): never {
  throw new Error(`fake-dispatch-db: ${what} não encontrado — seed do teste está incompleto`);
}

/** Mesmo `code` (`P2002`) que o Prisma real usa para violação de índice único — é ISTO que prova a defesa contra envio duplicado (ARQUITETURA §6.8.2: "a garantia dura é `Message.campaignTargetId @unique`, não o lease"). */
function throwUniqueViolation(field: string): never {
  const err = new Error(`fake unique constraint violation: ${field}`) as Error & { code: string };
  err.code = 'P2002';
  throw err;
}

type Where = Record<string, unknown> | undefined;

export const fakePrismaClient = {
  $transaction: vi.fn(async (arg: unknown, _opts?: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof fakePrismaClient) => unknown)(fakePrismaClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),

  /** Simula `advanceNextSendAllowedAt` (`@inno/sending/pace.ts`) — mesma regra de monotonicidade do Postgres real (`WHERE nextSendAllowedAt IS NULL OR < candidate`), só para não quebrar por "$executeRaw is not a function" a cada envio/falha/incerto (TODO envio chama isto). */
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('');
    if (sql.includes('nextSendAllowedAt')) {
      const candidate = values[0] as Date;
      const instanceId = values[1] as string;
      const instance = store.whatsAppInstances.find((i) => i.id === instanceId);
      if (instance && (instance.nextSendAllowedAt === null || instance.nextSendAllowedAt.getTime() < candidate.getTime())) {
        instance.nextSendAllowedAt = candidate;
      }
      return 1;
    }
    throw new Error(`fake-dispatch-db: $executeRaw inesperado no teste: ${sql}`);
  }),

  /** Simula `claimNextCampaignTarget` (`lib/dispatch-claim.ts`) por TEXTO da query — ver cabeçalho do arquivo. */
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('');
    if (sql.includes('FOR UPDATE SKIP LOCKED')) {
      const leaseUntil = values[0] as Date;
      const campaignId = values[1] as string;
      const now = Date.now();
      const candidate = store.campaignTargets
        .filter((t) => t.campaignId === campaignId && t.status === 'pending' && (t.scheduledFor?.getTime() ?? 0) <= now)
        .sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0))[0];
      if (!candidate) return [];
      candidate.scheduledFor = leaseUntil;
      candidate.attempt += 1;
      candidate.updatedAt = new Date();
      return [{ id: candidate.id, leadId: candidate.leadId, phoneE164: candidate.phoneE164, attempt: candidate.attempt }];
    }
    throw new Error(`fake-dispatch-db: $queryRaw inesperado no teste: ${sql}`);
  }),

  lead: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const lead = store.leads.find((l) => l.id === where.id);
      if (!lead) return null;
      const { cityName, ...rest } = lead;
      return { ...rest, city: cityName ? { name: cityName } : null };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const lead = store.leads.find((l) => l.id === where.id);
      if (!lead) throwNotFound('lead');
      Object.assign(lead, data);
      return { ...lead };
    }),
  },

  message: {
    create: vi.fn(async ({ data }: { data: Partial<FakeMessage> & { leadId: string; instanceId: string; direction: string; body: string } }) => {
      if (data.campaignTargetId != null && store.messages.some((m) => m.campaignTargetId === data.campaignTargetId)) {
        throwUniqueViolation('campaignTargetId');
      }
      const created: FakeMessage = {
        id: genId('msg'),
        status: 'queued',
        campaignTargetId: null,
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        createdAt: new Date(),
        ...data,
      };
      store.messages.push(created);
      return { ...created };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const message = store.messages.find((m) => m.id === where.id);
      if (!message) throwNotFound('message');
      Object.assign(message, data);
      return { ...message };
    }),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: { leadId?: string; direction?: string; instanceId?: { in: string[] } };
        orderBy?: Record<string, string>;
      } = {}) => {
        let rows = store.messages;
        if (where?.leadId !== undefined) rows = rows.filter((m) => m.leadId === where.leadId);
        if (where?.direction !== undefined) rows = rows.filter((m) => m.direction === where.direction);
        if (where?.instanceId?.in) rows = rows.filter((m) => where.instanceId!.in.includes(m.instanceId));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.messages.find((m) => m.id === where.id) ?? null),
    /** 🆕 Fase 4.F.5 — `health-check.job.ts#evaluateInstanceFailureRate` (janela dos últimos N envios resolvidos de uma instância). */
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        take,
      }: {
        where?: { instanceId?: string; direction?: string; status?: { in: string[] } };
        orderBy?: Record<string, string>;
        take?: number;
      } = {}) => {
        let rows = store.messages;
        if (where?.instanceId !== undefined) rows = rows.filter((m) => m.instanceId === where.instanceId);
        if (where?.direction !== undefined) rows = rows.filter((m) => m.direction === where.direction);
        if (where?.status?.in) rows = rows.filter((m) => where.status!.in.includes(m.status));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows.map((m) => ({ status: m.status }));
      },
    ),
  },

  campaignTarget: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.campaignTargets.find((t) => t.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const target = store.campaignTargets.find((t) => t.id === where.id);
      if (!target) throwNotFound('campaignTarget');
      applyIncrementsOrSets(target as unknown as Record<string, unknown>, data);
      target.updatedAt = new Date();
      return { ...target };
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where?: { campaignId?: string; status?: string; scheduledFor?: { lte: Date } };
        data: Record<string, unknown>;
      }) => {
        let rows = store.campaignTargets;
        if (where?.campaignId !== undefined) rows = rows.filter((t) => t.campaignId === where.campaignId);
        if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
        if (where?.scheduledFor?.lte) rows = rows.filter((t) => (t.scheduledFor?.getTime() ?? 0) <= where.scheduledFor!.lte.getTime());
        for (const row of rows) {
          applyIncrementsOrSets(row as unknown as Record<string, unknown>, data);
          row.updatedAt = new Date();
        }
        return { count: rows.length };
      },
    ),
    count: vi.fn(async ({ where }: { where?: { campaignId?: string; status?: string } } = {}) => {
      let rows = store.campaignTargets;
      if (where?.campaignId !== undefined) rows = rows.filter((t) => t.campaignId === where.campaignId);
      if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
      return rows.length;
    }),
  },

  campaign: {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where?: { status?: string | { in: string[] }; instances?: { every?: { instanceId: string }; some?: Record<string, never> } };
      } = {}) => {
        let rows = store.campaigns;
        const status = where?.status;
        if (typeof status === 'string') rows = rows.filter((c) => c.status === status);
        else if (status?.in) rows = rows.filter((c) => status.in.includes(c.status));
        if (where?.instances) {
          const instFilter = where.instances;
          rows = rows.filter((c) => {
            const ids = store.campaignInstances.filter((ci) => ci.campaignId === c.id).map((ci) => ci.instanceId);
            // Mesma semântica REAL do Prisma (ver `apps/web/src/test/fake-db.ts`):
            // `every` sobre relação vazia é vacuosamente verdadeiro; `some: {}`
            // no MESMO filtro é quem exige >=1 relação.
            const everyOk = instFilter.every ? ids.every((id) => id === instFilter.every!.instanceId) : true;
            const someOk = instFilter.some !== undefined ? ids.length > 0 : true;
            return everyOk && someOk;
          });
        }
        return rows.map((c) => ({ ...c, instances: store.campaignInstances.filter((ci) => ci.campaignId === c.id).map((ci) => ({ ...ci })) }));
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const campaign = store.campaigns.find((c) => c.id === where.id);
      if (!campaign) throwNotFound('campaign');
      applyIncrementsOrSets(campaign as unknown as Record<string, unknown>, data);
      return { ...campaign };
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where?: { id?: string | { in: string[] }; status?: string };
        data: Record<string, unknown>;
      }) => {
        let rows = store.campaigns;
        const id = where?.id;
        if (typeof id === 'string') rows = rows.filter((c) => c.id === id);
        else if (id && typeof id === 'object' && 'in' in id) rows = rows.filter((c) => id.in.includes(c.id));
        if (where?.status !== undefined) rows = rows.filter((c) => c.status === where.status);
        for (const row of rows) applyIncrementsOrSets(row as unknown as Record<string, unknown>, data);
        return { count: rows.length };
      },
    ),
  },

  campaignInstance: {
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { campaignId_instanceId: { campaignId: string; instanceId: string } };
        data: Record<string, unknown>;
      }) => {
        const { campaignId, instanceId } = where.campaignId_instanceId;
        const row = store.campaignInstances.find((ci) => ci.campaignId === campaignId && ci.instanceId === instanceId);
        if (!row) throwNotFound('campaignInstance');
        applyIncrementsOrSets(row as unknown as Record<string, unknown>, data);
        return { ...row };
      },
    ),
  },

  whatsAppInstance: {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where?: { id?: { in: string[] }; isActive?: boolean; status?: string | { not: string }; evolutionServerId?: string | null };
      } = {}) => {
        let rows = store.whatsAppInstances;
        if (where?.id?.in) rows = rows.filter((i) => where.id!.in.includes(i.id));
        // 🆕 Fase 4.F.5 — `warmup-roll.job`/`health-check.job` filtram por
        // `isActive`/`status: {not: 'banned'}`. Default `isActive: true`
        // (nenhum teste anterior a esta rodada setava o campo).
        if (where?.isActive !== undefined) rows = rows.filter((i) => (i.isActive ?? true) === where.isActive);
        if (where?.status !== undefined) {
          rows =
            typeof where.status === 'string'
              ? rows.filter((i) => i.status === where.status)
              : rows.filter((i) => i.status !== (where.status as { not: string }).not);
        }
        if (where?.evolutionServerId !== undefined) rows = rows.filter((i) => i.evolutionServerId === where.evolutionServerId);
        return rows.map((i) => ({ ...i }));
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const instance = store.whatsAppInstances.find((i) => i.id === where.id);
      return instance ? { ...instance } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const instance = store.whatsAppInstances.find((i) => i.id === where.id);
      if (!instance) throwNotFound('whatsAppInstance');
      applyIncrementsOrSets(instance as unknown as Record<string, unknown>, data);
      return { ...instance };
    }),
    /** 🆕 Fase 4.F.5 — `health-check.job.ts#pingAllEvolutionTargets` (conta instância legada sem `evolutionServerId`). */
    count: vi.fn(async ({ where }: { where?: { evolutionServerId?: string | null; isActive?: boolean } } = {}) => {
      let rows = store.whatsAppInstances;
      if (where?.evolutionServerId !== undefined) rows = rows.filter((i) => i.evolutionServerId === where.evolutionServerId);
      if (where?.isActive !== undefined) rows = rows.filter((i) => (i.isActive ?? true) === where.isActive);
      return rows.length;
    }),
  },

  instanceDailyStat: {
    findMany: vi.fn(async ({ where }: { where?: { instanceId?: { in: string[] }; date?: Date } } = {}) => {
      let rows = store.instanceDailyStats;
      if (where?.instanceId?.in) rows = rows.filter((s) => where.instanceId!.in.includes(s.instanceId));
      if (where?.date) rows = rows.filter((s) => s.date.getTime() === where.date!.getTime());
      return rows.map((s) => ({ ...s }));
    }),
    /** 🆕 Fase 4.F.5 — `warmup-roll.job.ts` (passo 1: `InstanceDailyStat` de ONTEM). */
    findUnique: vi.fn(async ({ where }: { where: { instanceId_date: { instanceId: string; date: Date } } }) => {
      const { instanceId, date } = where.instanceId_date;
      const row = store.instanceDailyStats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime());
      return row ? { ...row } : null;
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { instanceId_date: { instanceId: string; date: Date } };
        create: Partial<FakeInstanceDailyStat> & { instanceId: string; date: Date };
        update: Record<string, unknown>;
      }) => {
        const { instanceId, date } = where.instanceId_date;
        const existing = store.instanceDailyStats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime());
        if (existing) {
          applyIncrementsOrSets(existing as unknown as Record<string, unknown>, update);
          return { ...existing };
        }
        const created: FakeInstanceDailyStat = { sentCount: 0, failedCount: 0, ...create };
        store.instanceDailyStats.push(created);
        return { ...created };
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { instanceId_date: { instanceId: string; date: Date } };
        data: Record<string, unknown>;
      }) => {
        const { instanceId, date } = where.instanceId_date;
        const row = store.instanceDailyStats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime());
        if (!row) throwNotFound('instanceDailyStat');
        applyIncrementsOrSets(row as unknown as Record<string, unknown>, data);
        return { ...row };
      },
    ),
  },

  optOut: {
    findUnique: vi.fn(async ({ where }: { where: { phoneE164: string } }) => {
      const row = store.optOuts.find((o) => o.phoneE164 === where.phoneE164);
      return row ? { ...row, id: `optout_${row.phoneE164}`, source: 'manual', leadId: null, reason: null, createdAt: new Date() } : null;
    }),
  },

  leadActivity: {
    create: vi.fn(async ({ data }: { data: Partial<FakeLeadActivity> & { leadId: string; type: string; actor: string } }) => {
      const created: FakeLeadActivity = { id: genId('activity'), payload: null, actorUserId: null, ...data };
      store.leadActivities.push(created);
      return { ...created };
    }),
  },

  evolutionServer: {
    findUnique: vi.fn(async () => null),
    /** 🆕 Fase 4.F.5 — `health-check.job.ts#pingAllEvolutionTargets`. */
    findMany: vi.fn(async ({ where }: { where?: { isActive?: boolean } } = {}) => {
      let rows = store.evolutionServers;
      if (where?.isActive !== undefined) rows = rows.filter((s) => s.isActive === where.isActive);
      return rows.map((s) => ({ ...s }));
    }),
  },
} as const;

/** Where sem tipo forte (só para as poucas assinaturas acima que precisam de um genérico). */
export type { Where };
