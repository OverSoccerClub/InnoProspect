/**
 * test/fake-db.ts — banco de dados falso, em memória, para os testes de
 * `lib/services/{campaign-targets,webhook,optouts,users}.ts`. Ver REVISAO-QA.md §3:
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
  /** 🆕 Fase 4.B — `lib/services/webhook.ts#resolveExpectedWebhookApiKeys`/`lib/services/evolution-servers.ts`. Opcional/`null` = comportamento pré-Fase-4.B (nenhum teste existente antes desta rodada seta este campo). */
  evolutionServerId?: string | null;
  isActive?: boolean;
  /** 🆕 correção do bug do QR (2026-09-23) — `lib/services/whatsapp-instances.test.ts#getWhatsAppInstanceQr/getWhatsAppInstanceStatus`. Opcional: nenhum teste anterior a esta rodada precisava do nome da instância na Evolution. */
  evolutionInstanceName?: string;
  /** 🆕 correção do webhook mudo (2026-09-23) — `lib/services/webhook.ts#resolveExpectedWebhookApiKeys` (credencial PRÓPRIA da instância, cifrada) e `lib/services/whatsapp-instances.ts#createWhatsAppInstance` (quem grava). `null`/ausente = instância legada ou captura falhou — mesmo comportamento de antes desta correção (cai no fallback do servidor). */
  instanceApiKeyCiphertext?: Uint8Array | null;
  instanceApiKeyIv?: Uint8Array | null;
  instanceApiKeyAuthTag?: Uint8Array | null;
  instanceApiKeyKeyVersion?: number | null;
  /** Campos usados por `createWhatsAppInstance` (`lib/services/whatsapp-instances.ts`) — opcionais: nenhum teste antes desta rodada exercitava a CRIAÇÃO de instância no fake db. */
  name?: string;
  instanceKey?: string;
  createdById?: string;
  warmupStartedAt?: Date | null;
}

/** 🆕 Fase 4.B — `lib/services/evolution-servers.ts` (CRUD de servidores Evolution API) e `lib/services/webhook.ts` (resolução do apikey esperado por instância). */
export interface FakeEvolutionServer {
  id: string;
  name: string;
  baseUrl: string;
  isActive: boolean;
  apiKeyCiphertext: Buffer;
  apiKeyIv: Buffer;
  apiKeyAuthTag: Buffer;
  apiKeyKeyVersion: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
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

/** `lib/services/users.ts` — CRUD de usuários (Onda 4). */
export interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeDbSeed {
  leads?: FakeLead[];
  messages?: FakeMessage[];
  campaignTargets?: FakeCampaignTarget[];
  campaigns?: FakeCampaign[];
  optOuts?: FakeOptOut[];
  whatsAppInstances?: FakeWhatsAppInstance[];
  users?: FakeUser[];
  evolutionServers?: FakeEvolutionServer[];
}

const store = {
  leads: [] as FakeLead[],
  messages: [] as FakeMessage[],
  campaignTargets: [] as FakeCampaignTarget[],
  campaigns: [] as FakeCampaign[],
  optOuts: [] as FakeOptOut[],
  whatsAppInstances: [] as FakeWhatsAppInstance[],
  leadActivities: [] as FakeLeadActivity[],
  users: [] as FakeUser[],
  evolutionServers: [] as FakeEvolutionServer[],
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
  store.users = seed.users ? [...seed.users] : [];
  store.evolutionServers = seed.evolutionServers ? [...seed.evolutionServers] : [];
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

  // Stub genérico — o único chamador hoje é `lib/services/users.ts`
  // (`lockActiveAdminsAndCount`, `SELECT ... FOR UPDATE` para travar as
  // linhas de admin ativo). Este fake NÃO simula lock/concorrência real
  // (nenhum Postgres por trás) — só evita que o `await tx.$queryRaw` quebre
  // por "não é função" no teste. A correção da corrida em si depende do
  // comportamento real do Postgres, não verificável aqui (ver comentário
  // longo em `users.ts`).
  $queryRaw: vi.fn(async () => []),

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
    findUnique: vi.fn(async ({ where }: { where: { id?: string; instanceKey?: string } }) => {
      if (where.instanceKey !== undefined) return store.whatsAppInstances.find((i) => i.instanceKey === where.instanceKey) ?? null;
      return store.whatsAppInstances.find((i) => i.id === where.id) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where?: { evolutionServerId?: string } } = {}) => {
      let rows = store.whatsAppInstances;
      if (where?.evolutionServerId !== undefined) rows = rows.filter((i) => i.evolutionServerId === where.evolutionServerId);
      return rows.map((i) => ({ ...i }));
    }),
    findFirst: vi.fn(async ({ where }: { where?: { evolutionServerId?: string; evolutionInstanceName?: string } } = {}) => {
      let rows = store.whatsAppInstances;
      if (where?.evolutionServerId !== undefined) rows = rows.filter((i) => i.evolutionServerId === where.evolutionServerId);
      if (where?.evolutionInstanceName !== undefined) rows = rows.filter((i) => i.evolutionInstanceName === where.evolutionInstanceName);
      return rows[0] ? { ...rows[0] } : null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<FakeWhatsAppInstance> & Record<string, unknown> }) => {
      const created: FakeWhatsAppInstance = {
        id: genId('instance'),
        status: 'qr_pending',
        isDegraded: false,
        consecutiveFailures: 0,
        lastConnectionAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        isActive: true,
        ...data,
      } as FakeWhatsAppInstance;
      store.whatsAppInstances.push(created);
      return { ...created };
    }),
    count: vi.fn(async ({ where }: { where?: { evolutionServerId?: string | { in: string[] }; isActive?: boolean } } = {}) => {
      let rows = store.whatsAppInstances;
      if (where?.evolutionServerId !== undefined) {
        rows =
          typeof where.evolutionServerId === 'string'
            ? rows.filter((i) => i.evolutionServerId === where.evolutionServerId)
            : rows.filter((i) => (where.evolutionServerId as { in: string[] }).in.includes(i.evolutionServerId ?? ''));
      }
      if (where?.isActive !== undefined) rows = rows.filter((i) => (i.isActive ?? true) === where.isActive);
      return rows.length;
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: { evolutionServerId?: null }; data: Record<string, unknown> }) => {
      const rows = where?.evolutionServerId === null ? store.whatsAppInstances.filter((i) => !i.evolutionServerId) : store.whatsAppInstances;
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const instance = store.whatsAppInstances.find((i) => i.id === where.id);
      if (!instance) throwNotFoundInFake('whatsAppInstance');
      Object.assign(instance, data);
      return { ...instance };
    }),
  },

  evolutionServer: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; baseUrl?: string } }) => {
      if (where.baseUrl !== undefined) return store.evolutionServers.find((s) => s.baseUrl === where.baseUrl) ?? null;
      return store.evolutionServers.find((s) => s.id === where.id) ?? null;
    }),
    findMany: vi.fn(async () => [...store.evolutionServers].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    count: vi.fn(async () => store.evolutionServers.length),
    create: vi.fn(async ({ data }: { data: Partial<FakeEvolutionServer> & { baseUrl: string; createdById: string } }) => {
      if (store.evolutionServers.some((s) => s.baseUrl === data.baseUrl)) throwUniqueViolation();
      const now = new Date();
      const created: FakeEvolutionServer = {
        id: genId('evoserver'),
        name: 'Servidor',
        isActive: true,
        apiKeyCiphertext: Buffer.from(''),
        apiKeyIv: Buffer.from(''),
        apiKeyAuthTag: Buffer.from(''),
        apiKeyKeyVersion: 1,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      store.evolutionServers.push(created);
      return { ...created };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const server = store.evolutionServers.find((s) => s.id === where.id);
      if (!server) throwNotFoundInFake('evolutionServer');
      if (typeof data.baseUrl === 'string' && store.evolutionServers.some((s) => s.id !== where.id && s.baseUrl === data.baseUrl)) {
        throwUniqueViolation();
      }
      Object.assign(server, data, { updatedAt: new Date() });
      return { ...server };
    }),
  },

  leadActivity: {
    create: vi.fn(async ({ data }: { data: Partial<FakeLeadActivity> & { leadId: string; type: string; actor: string } }) => {
      const created: FakeLeadActivity = { id: genId('activity'), createdAt: new Date(), actorUserId: null, payload: null, ...data };
      store.leadActivities.push(created);
      return { ...created };
    }),
  },

  user: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.email !== undefined) return store.users.find((u) => u.email === where.email) ?? null;
      return store.users.find((u) => u.id === where.id) ?? null;
    }),
    findMany: vi.fn(
      async ({
        where,
        cursor,
        skip,
        take,
      }: {
        where?: { role?: string; isActive?: boolean; OR?: Array<Record<string, unknown>> };
        orderBy?: unknown;
        cursor?: { id: string };
        skip?: number;
        take?: number;
      } = {}) => {
        let rows = [...store.users].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (where?.role !== undefined) rows = rows.filter((u) => u.role === where.role);
        if (where?.isActive !== undefined) rows = rows.filter((u) => u.isActive === where.isActive);
        if (where?.OR) {
          // Só o suficiente para o filtro `q` de `listUsers`: cada item de
          // `OR` é `{ campo: { contains: string } }` — casa se QUALQUER
          // campo contiver o termo (case-insensitive), reproduzindo
          // `mode: 'insensitive'` do Prisma real.
          rows = rows.filter((u) =>
            (where.OR ?? []).some((cond) =>
              Object.entries(cond).some(([field, matcher]) => {
                const value = (u as unknown as Record<string, string>)[field];
                const needle = (matcher as { contains?: string }).contains;
                return typeof value === 'string' && typeof needle === 'string' && value.toLowerCase().includes(needle.toLowerCase());
              }),
            ),
          );
        }
        if (cursor) {
          const idx = rows.findIndex((u) => u.id === cursor.id);
          rows = idx >= 0 ? rows.slice(idx + (skip ?? 0)) : rows;
        }
        if (take !== undefined) rows = rows.slice(0, take);
        return rows;
      },
    ),
    count: vi.fn(async ({ where }: { where?: { role?: string; isActive?: boolean } } = {}) => {
      let rows = store.users;
      if (where?.role !== undefined) rows = rows.filter((u) => u.role === where.role);
      if (where?.isActive !== undefined) rows = rows.filter((u) => u.isActive === where.isActive);
      return rows.length;
    }),
    create: vi.fn(async ({ data }: { data: Partial<FakeUser> & { email: string; passwordHash: string; name: string } }) => {
      if (store.users.some((u) => u.email === data.email)) throwUniqueViolation();
      const now = new Date();
      const created: FakeUser = { id: genId('user'), role: 'operator', isActive: true, createdAt: now, updatedAt: now, ...data };
      store.users.push(created);
      return { ...created };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const user = store.users.find((u) => u.id === where.id);
      if (!user) throwNotFoundInFake('user');
      if (typeof data.email === 'string' && store.users.some((u) => u.id !== where.id && u.email === data.email)) {
        throwUniqueViolation();
      }
      Object.assign(user, data, { updatedAt: new Date() });
      return { ...user };
    }),
  },
};
