/**
 * test/fake-db.ts — banco de dados falso, em memória, para os testes de
 * `lib/services/{campaign-targets,webhook,optouts}.ts`. Ver REVISAO-QA.md §3:
 * "Fake objects manuais... já basta — zero dependência nova, rápido, e força
 * o teste a documentar exatamente o contrato usado."
 *
 * NÃO é um mock genérico do Prisma — cobre só os métodos que os TRÊS
 * arquivos acima realmente chamam. `$transaction` não isola nada de verdade
 * (não há concorrência real a testar sem Postgres, ver REVISAO-QA.md §3 "O
 * que exige ambiente vivo") — só chama o callback recebido com o MESMO
 * client, para exercitar o código de produção como se estivesse dentro de
 * uma transação.
 *
 * A semântica de `campaign.findMany` COM `instances: { every, some }`
 * reproduz de propósito o comportamento REAL do Prisma (every sobre relação
 * vazia é vacuosamente verdadeiro; só `some: {}` no MESMO filtro exclui
 * relação vazia) — é o que faz o teste do kill switch (REVISAO-QA.md §2.6)
 * pegar de verdade um regressão que remova `some: {}` da query de produção,
 * em vez de só testar "a função foi chamada".
 */
import { vi } from 'vitest';

export interface FakeLead {
  id: string;
  phoneE164: string | null;
  status: string;
  lastSeenAt: Date;
}

export interface FakeMessage {
  id: string;
  leadId: string;
  instanceId: string;
  direction: string;
  body: string;
  providerMessageId: string;
  status: string;
  campaignTargetId: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  errorCode: string | null;
}

export interface FakeCampaignTarget {
  id: string;
  campaignId: string;
  leadId: string | null;
  phoneE164: string;
  status: string;
  skipReason: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}

export interface FakeCampaign {
  id: string;
  status: string;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  respondedCount: number;
  failedCount: number;
  skippedCount: number;
  haltReason: string | null;
  /** Modela `CampaignInstance` (tabela de junção) — só os ids, é tudo que as queries testadas usam. */
  instanceIds: string[];
}

export interface FakeOptOut {
  id: string;
  phoneE164: string;
  source: string;
  leadId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface FakeWhatsAppInstance {
  id: string;
  status: string;
  isDegraded: boolean;
  consecutiveFailures: number;
  lastConnectionAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

export interface FakeLeadActivity {
  id: string;
  leadId: string;
  type: string;
  payload: unknown;
  actor: string;
  actorUserId: string | null;
  createdAt: Date;
}

export interface FakeDbSeed {
  leads?: FakeLead[];
  messages?: FakeMessage[];
  campaignTargets?: FakeCampaignTarget[];
  campaigns?: FakeCampaign[];
  optOuts?: FakeOptOut[];
  whatsAppInstances?: FakeWhatsAppInstance[];
}

const store = {
  leads: [] as FakeLead[],
  messages: [] as FakeMessage[],
  campaignTargets: [] as FakeCampaignTarget[],
  campaigns: [] as FakeCampaign[],
  optOuts: [] as FakeOptOut[],
  whatsAppInstances: [] as FakeWhatsAppInstance[],
  leadActivities: [] as FakeLeadActivity[],
};

let nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${nextId++}`;
}

/** Limpa e resemeia o fake db — chamar em `beforeEach`/no início de cada teste. */
export function resetFakeDb(seed: FakeDbSeed = {}): void {
  store.leads = seed.leads ? [...seed.leads] : [];
  store.messages = seed.messages ? [...seed.messages] : [];
  store.campaignTargets = seed.campaignTargets ? [...seed.campaignTargets] : [];
  store.campaigns = seed.campaigns ? [...seed.campaigns] : [];
  store.optOuts = seed.optOuts ? [...seed.optOuts] : [];
  store.whatsAppInstances = seed.whatsAppInstances ? [...seed.whatsAppInstances] : [];
  store.leadActivities = [];
  nextId = 1;
}

/** Estado atual — usar em asserções (`getFakeDbState().campaigns.find(...)`). */
export function getFakeDbState() {
  return store;
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

/** Simula `P2002` (unique constraint) — mesmo `code` que `webhook.ts`/`optouts.ts` checam no `catch`. */
function throwUniqueViolation(): never {
  const err = new Error('Fake unique constraint violation') as Error & { code: string };
  err.code = 'P2002';
  throw err;
}

function throwNotFoundInFake(what: string): never {
  throw new Error(`fake-db: ${what} não encontrado — seed do teste está incompleto`);
}

type Where = Record<string, unknown> | undefined;

/** Cliente único, compartilhado por todos os testes que o importam — resetar via `resetFakeDb()`, nunca recriar. */
export const fakePrismaClient = {
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof fakePrismaClient) => unknown)(fakePrismaClient);
    }
    return Promise.all(arg as Promise<unknown>[]);
  }),

  lead: {
    findFirst: vi.fn(async ({ where, orderBy }: { where?: Where; orderBy?: Record<string, string> } = {}) => {
      let rows = store.leads;
      const w = where as { phoneE164?: string; id?: string } | undefined;
      if (w?.phoneE164 !== undefined) rows = rows.filter((l) => l.phoneE164 === w.phoneE164);
      if (w?.id !== undefined) rows = rows.filter((l) => l.id === w.id);
      if (orderBy?.lastSeenAt === 'desc') rows = [...rows].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
      return rows[0] ?? null;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.leads.find((l) => l.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const lead = store.leads.find((l) => l.id === where.id);
      if (!lead) throwNotFoundInFake('lead');
      Object.assign(lead, data);
      return { ...lead };
    }),
  },

  message: {
    upsert: vi.fn(
      async ({
        where,
        update,
        create,
      }: {
        where: { providerMessageId: string };
        update: Record<string, unknown>;
        create: Omit<FakeMessage, 'id' | 'campaignTargetId' | 'deliveredAt' | 'readAt' | 'errorCode'>;
      }) => {
        const existing = store.messages.find((m) => m.providerMessageId === where.providerMessageId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const created: FakeMessage = {
          id: genId('msg'),
          campaignTargetId: null,
          deliveredAt: null,
          readAt: null,
          errorCode: null,
          ...create,
        };
        store.messages.push(created);
        return { ...created };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { providerMessageId?: string; id?: string } }) => {
      if (where.providerMessageId !== undefined) {
        return store.messages.find((m) => m.providerMessageId === where.providerMessageId) ?? null;
      }
      return store.messages.find((m) => m.id === where.id) ?? null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const message = store.messages.find((m) => m.id === where.id);
      if (!message) throwNotFoundInFake('message');
      Object.assign(message, data);
      return { ...message };
    }),
  },

  campaignTarget: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.campaignTargets.find((t) => t.id === where.id) ?? null),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: { leadId?: string; status?: { in: string[] } };
        orderBy?: Record<string, string>;
      } = {}) => {
        let rows = store.campaignTargets;
        if (where?.leadId !== undefined) rows = rows.filter((t) => t.leadId === where.leadId);
        if (where?.status?.in) rows = rows.filter((t) => where.status!.in.includes(t.status));
        if (orderBy?.updatedAt === 'desc') rows = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        return rows[0] ?? null;
      },
    ),
    findMany: vi.fn(async ({ where }: { where?: { phoneE164?: string; status?: string } } = {}) => {
      let rows = store.campaignTargets;
      if (where?.phoneE164 !== undefined) rows = rows.filter((t) => t.phoneE164 === where.phoneE164);
      if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
      return rows.map((t) => ({ id: t.id }));
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const target = store.campaignTargets.find((t) => t.id === where.id);
      if (!target) throwNotFoundInFake('campaignTarget');
      Object.assign(target, data, { updatedAt: new Date() });
      return { ...target };
    }),
  },

  campaign: {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const campaign = store.campaigns.find((c) => c.id === where.id);
      if (!campaign) throwNotFoundInFake('campaign');
      applyIncrementsOrSets(campaign as unknown as Record<string, unknown>, data);
      return { ...campaign };
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: { id?: { in: string[] } }; data: Record<string, unknown> }) => {
      const ids = where?.id?.in ?? [];
      const matched = store.campaigns.filter((c) => ids.includes(c.id));
      for (const c of matched) Object.assign(c, data);
      return { count: matched.length };
    }),
    findMany: vi.fn(
      async ({
        where,
      }: {
        where?: { status?: { in: string[] }; instances?: { every?: { instanceId: string }; some?: Record<string, never> } };
      } = {}) => {
        return store.campaigns
          .filter((c) => (where?.status?.in ? where.status.in.includes(c.status) : true))
          .filter((c) => {
            const instFilter = where?.instances;
            if (!instFilter) return true;
            // Réplica proposital da semântica REAL do Prisma para relação
            // filtrada por `every`/`some` no MESMO objeto (REVISAO-QA.md §2.6):
            // `every` sobre relação vazia é vacuosamente verdadeiro; só a
            // presença de `some` (mesmo vazio, `{}`) exige >=1 relação.
            const everyOk = instFilter.every ? c.instanceIds.every((id) => id === instFilter.every!.instanceId) : true;
            const someOk = instFilter.some !== undefined ? c.instanceIds.length > 0 : true;
            return everyOk && someOk;
          })
          .map((c) => ({ id: c.id }));
      },
    ),
  },

  optOut: {
    findUnique: vi.fn(async ({ where }: { where: { phoneE164?: string; id?: string } }) => {
      if (where.phoneE164 !== undefined) return store.optOuts.find((o) => o.phoneE164 === where.phoneE164) ?? null;
      return store.optOuts.find((o) => o.id === where.id) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<FakeOptOut> & { phoneE164: string; source: string } }) => {
      if (store.optOuts.some((o) => o.phoneE164 === data.phoneE164)) throwUniqueViolation();
      const created: FakeOptOut = { id: genId('optout'), reason: null, leadId: null, createdAt: new Date(), ...data };
      store.optOuts.push(created);
      return { ...created };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const idx = store.optOuts.findIndex((o) => o.id === where.id);
      if (idx === -1) throwNotFoundInFake('optOut');
      const [removed] = store.optOuts.splice(idx, 1);
      return { ...removed! };
    }),
  },

  whatsAppInstance: {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const instance = store.whatsAppInstances.find((i) => i.id === where.id);
      if (!instance) throwNotFoundInFake('whatsAppInstance');
      Object.assign(instance, data);
      return { ...instance };
    }),
  },

  leadActivity: {
    create: vi.fn(async ({ data }: { data: Partial<FakeLeadActivity> & { leadId: string; type: string; actor: string } }) => {
      const created: FakeLeadActivity = { id: genId('activity'), createdAt: new Date(), actorUserId: null, payload: null, ...data };
      store.leadActivities.push(created);
      return { ...created };
    }),
  },
};
