/**
 * campaigns.test.ts — Fase 4.D (ARQUITETURA §4.5). Fake de Prisma local
 * dedicado (mesmo padrão de `messages.test.ts`/REVISAO-QA.md §3: "fake
 * object manual, zero dependência nova"). `advanceCampaignTargetStatus`
 * (`@/lib/services/campaign-targets`) é REAL — não mockado — porque é a
 * regra de ouro do §4.5.0 ("nenhuma escrita direta em `campaignTarget.
 * status`") e testá-la de verdade aqui é o que prova que `campaigns.ts` a
 * está usando corretamente.
 *
 * `sendCampaignTargetMessage` (disparo manual) MOCKA `sendLeadMessage`
 * (`@/lib/services/messages`) de propósito: o comportamento do PORTÃO
 * (`evaluateSendGuard`, `SEND_PACE_LOCKED` incluso) já está provado em
 * `messages.test.ts` (30 testes). O que ESTE arquivo prova é a FIAÇÃO —
 * que `campaigns.ts` delega para o mesmo portão em vez de reimplementar um
 * segundo caminho, que a rejeição do guard (pace lock) propaga sem
 * silenciar, e que a lista de instâncias fica restrita à campanha.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateCampaignBody, PatchCampaignBody } from '@inno/contracts';

vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});

const sendLeadMessageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/messages', () => ({ sendLeadMessage: sendLeadMessageMock }));

type FakeLead = { id: string; name: string; phoneE164: string | null; phoneType: string; uf: string; category: string | null; website: string | null; createdAt: Date; city: { name: string } | null };
type FakeInstance = { id: string; name: string; status: string; isDegraded: boolean; warmupDay: number; dailyLimitOverride: number | null; nextSendAllowedAt: Date | null };
type FakeTemplate = { id: string; body: string; isActive: boolean };
type FakeOptOut = { phoneE164: string };
type FakeMessage = { leadId: string; direction: string; createdAt: Date };
type FakeCampaign = {
  id: string;
  name: string;
  templateId: string;
  status: string;
  audienceSnapshot: unknown;
  renderedTemplateSnapshot: string | null;
  dailyLimitPerInstance: number | null;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendWindowDaysOfWeek: number[];
  jitterMinSeconds: number;
  jitterMaxSeconds: number;
  skipRecentlyContactedDays: number;
  haltReason: string | null;
  scheduledFor: Date | null;
  createdById: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  totalTargets: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  respondedCount: number;
  failedCount: number;
  skippedCount: number;
};
type FakeCampaignInstance = { id: string; campaignId: string; instanceId: string; sentCount: number; failedCount: number };
type FakeCampaignTarget = { id: string; campaignId: string; leadId: string; phoneE164: string; status: string; skipReason: string | null; attempt: number; scheduledFor: Date | null; sentAt: Date | null; createdAt: Date; updatedAt: Date };

const store = vi.hoisted(() => ({
  nextId: 1,
  leads: [] as FakeLead[],
  instances: [] as FakeInstance[],
  templates: [] as FakeTemplate[],
  optOuts: [] as FakeOptOut[],
  messages: [] as FakeMessage[],
  campaigns: [] as FakeCampaign[],
  campaignInstances: [] as FakeCampaignInstance[],
  campaignTargets: [] as FakeCampaignTarget[],
}));

function genId(prefix: string): string {
  return `${prefix}-${store.nextId++}`;
}

function resetStore(): void {
  store.nextId = 1;
  store.leads = [];
  store.instances = [];
  store.templates = [];
  store.optOuts = [];
  store.messages = [];
  store.campaigns = [];
  store.campaignInstances = [];
  store.campaignTargets = [];
}

function applyIncrementsOrSets(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
      target[key] = ((target[key] as number | undefined) ?? 0) + (value as { increment: number }).increment;
    } else if (key === 'template' || key === 'instances') {
      // relação — não usada nos testes via `update` (só `create` nested), ignorar no `applyIncrementsOrSets`.
      continue;
    } else {
      target[key] = value;
    }
  }
}

function withInstances(campaign: FakeCampaign) {
  return {
    ...campaign,
    instances: store.campaignInstances
      .filter((ci) => ci.campaignId === campaign.id)
      .map((ci) => ({ ...ci, instance: store.instances.find((i) => i.id === ci.instanceId)! })),
  };
}

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
  lead: {
    findMany: vi.fn(async ({ where, orderBy }: { where?: { id?: { in: string[] } }; orderBy?: unknown } = {}) => {
      let rows = store.leads;
      if (where?.id?.in) rows = rows.filter((l) => where.id!.in.includes(l.id));
      if (orderBy) rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return rows.map((l) => ({ ...l }));
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = store.leads.find((l) => l.id === where.id);
      return found ? { ...found } : null;
    }),
  },
  whatsAppInstance: {
    findMany: vi.fn(async ({ where }: { where?: { id?: { in: string[] } } } = {}) => {
      let rows = store.instances;
      if (where?.id?.in) rows = rows.filter((i) => where.id!.in.includes(i.id));
      return rows.map((i) => ({ ...i }));
    }),
  },
  instanceDailyStat: {
    findMany: vi.fn(async () => []),
  },
  messageTemplate: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.templates.find((t) => t.id === where.id) ?? null),
  },
  optOut: {
    findMany: vi.fn(async ({ where }: { where?: { phoneE164?: { in: string[] } } } = {}) => {
      if (!where?.phoneE164?.in) return [];
      return store.optOuts.filter((o) => where.phoneE164!.in.includes(o.phoneE164)).map((o) => ({ ...o }));
    }),
  },
  message: {
    findMany: vi.fn(
      async ({ where }: { where?: { leadId?: { in: string[] }; direction?: string; createdAt?: { gte: Date } } } = {}) => {
        let rows = store.messages;
        if (where?.leadId?.in) rows = rows.filter((m) => where.leadId!.in.includes(m.leadId));
        if (where?.direction) rows = rows.filter((m) => m.direction === where.direction);
        if (where?.createdAt?.gte) rows = rows.filter((m) => m.createdAt.getTime() >= where.createdAt!.gte.getTime());
        const seen = new Set<string>();
        return rows.filter((m) => (seen.has(m.leadId) ? false : (seen.add(m.leadId), true))).map((m) => ({ leadId: m.leadId }));
      },
    ),
  },
  campaignTarget: {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where?: { campaignId?: string; status?: string; leadId?: { in: string[] }; phoneE164?: { in: string[] }; campaign?: { status?: { in: string[] }; id?: { not: string } } };
      } = {}) => {
        let rows = store.campaignTargets;
        if (where?.campaignId !== undefined) rows = rows.filter((t) => t.campaignId === where.campaignId);
        if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
        if (where?.leadId?.in) rows = rows.filter((t) => where.leadId!.in.includes(t.leadId));
        if (where?.phoneE164?.in) rows = rows.filter((t) => where.phoneE164!.in.includes(t.phoneE164));
        if (where?.campaign) {
          rows = rows.filter((t) => {
            const camp = store.campaigns.find((c) => c.id === t.campaignId);
            if (!camp) return false;
            if (where.campaign!.status?.in && !where.campaign!.status!.in.includes(camp.status)) return false;
            if (where.campaign!.id?.not && camp.id === where.campaign!.id.not) return false;
            return true;
          });
        }
        return rows.map((t) => ({ ...t }));
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = store.campaignTargets.find((t) => t.id === where.id);
      return found ? { ...found } : null;
    }),
    findFirst: vi.fn(async ({ where }: { where?: { campaignId?: string; status?: string } } = {}) => {
      let rows = store.campaignTargets;
      if (where?.campaignId !== undefined) rows = rows.filter((t) => t.campaignId === where.campaignId);
      if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
      const sorted = [...rows].sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));
      return sorted[0] ?? null;
    }),
    count: vi.fn(async ({ where }: { where?: { campaignId?: string; status?: string } } = {}) => {
      let rows = store.campaignTargets;
      if (where?.campaignId !== undefined) rows = rows.filter((t) => t.campaignId === where.campaignId);
      if (where?.status !== undefined) rows = rows.filter((t) => t.status === where.status);
      return rows.length;
    }),
    createMany: vi.fn(async ({ data }: { data: Array<Partial<FakeCampaignTarget> & { campaignId: string; leadId: string; phoneE164: string }> }) => {
      for (const d of data) {
        store.campaignTargets.push({
          id: genId('ct'),
          status: 'pending',
          skipReason: null,
          attempt: 0,
          scheduledFor: null,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...d,
        });
      }
      return { count: data.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      const before = store.campaignTargets.length;
      store.campaignTargets = store.campaignTargets.filter((t) => !where.id.in.includes(t.id));
      return { count: before - store.campaignTargets.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const target = store.campaignTargets.find((t) => t.id === where.id);
      if (!target) throw new Error('fake: campaignTarget não encontrado');
      Object.assign(target, data, { updatedAt: new Date() });
      return { ...target };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { campaignId: string; status: string }; data: Record<string, unknown> }) => {
      const rows = store.campaignTargets.filter((t) => t.campaignId === where.campaignId && t.status === where.status);
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    }),
  },
  campaignInstance: {
    createMany: vi.fn(async ({ data }: { data: Array<{ campaignId: string; instanceId: string }> }) => {
      for (const d of data) store.campaignInstances.push({ id: genId('ci'), sentCount: 0, failedCount: 0, ...d });
      return { count: data.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      const before = store.campaignInstances.length;
      store.campaignInstances = store.campaignInstances.filter((ci) => !where.id.in.includes(ci.id));
      return { count: before - store.campaignInstances.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { campaignId_instanceId: { campaignId: string; instanceId: string } }; data: Record<string, unknown> }) => {
      const ci = store.campaignInstances.find((c) => c.campaignId === where.campaignId_instanceId.campaignId && c.instanceId === where.campaignId_instanceId.instanceId);
      if (!ci) throw new Error('fake: campaignInstance não encontrado');
      applyIncrementsOrSets(ci as unknown as Record<string, unknown>, data);
      return { ...ci };
    }),
  },
  campaign: {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Partial<FakeCampaign> & { name: string; templateId: string; createdById: string; instances?: { create: Array<{ instanceId: string }> } };
      }) => {
        const id = genId('camp');
        const { instances, ...rest } = data;
        const created: FakeCampaign = {
          id,
          audienceSnapshot: {},
          renderedTemplateSnapshot: null,
          dailyLimitPerInstance: null,
          sendWindowStartHour: 9,
          sendWindowEndHour: 18,
          sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
          jitterMinSeconds: 45,
          jitterMaxSeconds: 180,
          skipRecentlyContactedDays: 30,
          haltReason: null,
          scheduledFor: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
          totalTargets: 0,
          sentCount: 0,
          deliveredCount: 0,
          readCount: 0,
          respondedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          status: 'draft',
          ...rest,
        };
        store.campaigns.push(created);
        if (instances?.create) {
          for (const inst of instances.create) store.campaignInstances.push({ id: genId('ci'), campaignId: id, instanceId: inst.instanceId, sentCount: 0, failedCount: 0 });
        }
        return { ...created };
      },
    ),
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { template?: unknown; instances?: unknown } }) => {
      const found = store.campaigns.find((c) => c.id === where.id);
      if (!found) return null;
      const result: Record<string, unknown> = { ...found };
      if (include?.template) result.template = store.templates.find((t) => t.id === found.templateId) ?? null;
      if (include?.instances) result.instances = withInstances(found).instances;
      return result;
    }),
    findMany: vi.fn(async ({ where }: { where?: { status?: string; name?: { contains: string } } } = {}) => {
      let rows = store.campaigns;
      if (where?.status !== undefined) rows = rows.filter((c) => c.status === where.status);
      if (where?.name?.contains) rows = rows.filter((c) => c.name.toLowerCase().includes(where.name!.contains.toLowerCase()));
      return rows.map((c) => {
        const withRel = withInstances(c) as unknown as Record<string, unknown>;
        withRel.template = store.templates.find((t) => t.id === c.templateId) ?? { name: '' };
        return withRel;
      });
    }),
    count: vi.fn(async () => store.campaigns.length),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const campaign = store.campaigns.find((c) => c.id === where.id);
      if (!campaign) throw new Error('fake: campaign não encontrado');
      applyIncrementsOrSets(campaign as unknown as Record<string, unknown>, data);
      return { ...campaign };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      store.campaigns = store.campaigns.filter((c) => c.id !== where.id);
    }),
  },
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock, Prisma: {} }));

const { createCampaign, patchCampaign, startCampaign, sendCampaignTargetMessage } = await import('./campaigns');

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id'>): FakeLead {
  return {
    name: 'Lead Teste',
    phoneE164: '+5511987654321',
    phoneType: 'mobile',
    uf: 'SP',
    category: null,
    website: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    city: { name: 'São Paulo' },
    ...overrides,
  };
}

function instance(overrides: Partial<FakeInstance> & Pick<FakeInstance, 'id'>): FakeInstance {
  return { name: 'Instância', status: 'connected', isDegraded: false, warmupDay: 22, dailyLimitOverride: null, nextSendAllowedAt: null, ...overrides };
}

const TEMPLATE_OK = 'Promoção {a|b} para {{primeiro_nome}}. Somos a {{minha_empresa}}. Não quer receber mais? Responda SAIR.';

beforeEach(() => {
  resetStore();
  sendLeadMessageMock.mockReset();
  process.env.APP_COMPANY_NAME = 'Innovare';
  store.templates.push({ id: 'tpl-1', body: TEMPLATE_OK, isActive: true });
  store.instances.push(instance({ id: 'inst-1' }));
});

// ─────────────────────────────────────────────────────────────────────────
// 1) Materialização com cada motivo de exclusão (ARQUITETURA §4.5.4)
// ─────────────────────────────────────────────────────────────────────────

describe('createCampaign — materialização e exclusão por motivo', () => {
  it('discrimina os 6 motivos e totalMatched = eligible + Σ excluded', async () => {
    store.leads.push(
      lead({ id: 'l-ok', phoneE164: '+5511900000001', createdAt: new Date('2026-01-01T00:00:00Z') }), // elegível
      lead({ id: 'l-nophone', phoneE164: null }), // noPhone
      lead({ id: 'l-fixo', phoneE164: '+5511900000002', phoneType: 'landline' }), // landline
      lead({ id: 'l-optout', phoneE164: '+5511900000003' }), // optedOut
      lead({ id: 'l-dup-a', phoneE164: '+5511900000004', createdAt: new Date('2026-01-01T00:00:00Z') }), // fica (mais antigo)
      lead({ id: 'l-dup-b', phoneE164: '+5511900000004', createdAt: new Date('2026-01-02T00:00:00Z') }), // duplicatePhone
      lead({ id: 'l-recente', phoneE164: '+5511900000005' }), // recentlyContacted
      lead({ id: 'l-alvo', phoneE164: '+5511900000006' }), // alreadyTargeted
    );
    store.optOuts.push({ phoneE164: '+5511900000003' });
    store.messages.push({ leadId: 'l-recente', direction: 'outbound', createdAt: new Date() });
    store.campaigns.push({
      id: 'other-camp',
      name: 'Outra',
      templateId: 'tpl-1',
      status: 'running',
      audienceSnapshot: {},
      renderedTemplateSnapshot: 'x',
      dailyLimitPerInstance: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
      sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
      jitterMinSeconds: 45,
      jitterMaxSeconds: 180,
      skipRecentlyContactedDays: 30,
      haltReason: null,
      scheduledFor: null,
      createdById: 'u-1',
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      totalTargets: 1,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      respondedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
    store.campaignTargets.push({
      id: 'other-ct',
      campaignId: 'other-camp',
      leadId: 'l-alvo',
      phoneE164: '+5511900000006',
      status: 'pending',
      skipReason: null,
      attempt: 0,
      scheduledFor: null,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const body: CreateCampaignBody = {
      name: 'Campanha de teste',
      templateId: 'tpl-1',
      instanceIds: ['inst-1'],
      audience: { mode: 'ids', leadIds: ['l-ok', 'l-nophone', 'l-fixo', 'l-optout', 'l-dup-a', 'l-dup-b', 'l-recente', 'l-alvo'] },
    };

    const result = await createCampaign(body, 'u-1');

    expect(result.audience).toEqual({
      totalMatched: 8,
      eligible: 2,
      excluded: { noPhone: 1, landline: 1, optedOut: 1, duplicatePhone: 1, recentlyContacted: 1, alreadyTargeted: 1 },
    });
    expect(result.audience.totalMatched).toBe(result.audience.eligible + Object.values(result.audience.excluded).reduce((a, b) => a + b, 0));

    // Só os leads elegíveis ganharam linha de CampaignTarget — materialização
    // real, não só contagem. `l-dup-a` sobrevive ao `duplicatePhone` (é o
    // mais antigo do par); `l-dup-b` foi excluído.
    const targets = store.campaignTargets.filter((t) => t.campaignId === result.id);
    expect(targets.map((t) => t.leadId).sort()).toEqual(['l-dup-a', 'l-ok']);
    expect(targets.every((t) => t.status === 'pending')).toBe(true);
  });

  it('409 EMPTY_AUDIENCE quando nenhum lead sobra', async () => {
    store.leads.push(lead({ id: 'l-1', phoneE164: null }));
    const body: CreateCampaignBody = { name: 'Vazia', templateId: 'tpl-1', instanceIds: ['inst-1'], audience: { mode: 'ids', leadIds: ['l-1'] } };
    await expect(createCampaign(body, 'u-1')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'EMPTY_AUDIENCE' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2) `start` reavalia opt-out numa segunda passagem (ARQUITETURA §4.5.2/§4.5.9)
// ─────────────────────────────────────────────────────────────────────────

describe('startCampaign — segunda passagem de exclusão', () => {
  function seedRunnableCampaign(): void {
    store.leads.push(lead({ id: 'l-a', phoneE164: '+5511900000001' }), lead({ id: 'l-b', phoneE164: '+5511900000002' }));
    store.campaigns.push({
      id: 'camp-1',
      name: 'Campanha',
      templateId: 'tpl-1',
      status: 'draft',
      audienceSnapshot: {},
      renderedTemplateSnapshot: null,
      dailyLimitPerInstance: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
      sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
      jitterMinSeconds: 45,
      jitterMaxSeconds: 180,
      skipRecentlyContactedDays: 30,
      haltReason: null,
      scheduledFor: null,
      createdById: 'u-1',
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      totalTargets: 2,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      respondedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
    store.campaignInstances.push({ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 });
    store.campaignTargets.push(
      { id: 'ct-a', campaignId: 'camp-1', leadId: 'l-a', phoneE164: '+5511900000001', status: 'pending', skipReason: null, attempt: 0, scheduledFor: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ct-b', campaignId: 'camp-1', leadId: 'l-b', phoneE164: '+5511900000002', status: 'pending', skipReason: null, attempt: 0, scheduledFor: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() },
    );
  }

  it('opt-out criado DEPOIS da materialização (mas antes do start) vira "skipped", não é enviado', async () => {
    seedRunnableCampaign();
    // Opt-out surgiu entre o POST e o start — não existia quando a campanha foi criada.
    store.optOuts.push({ phoneE164: '+5511900000002' });

    const result = await startCampaign('camp-1');

    expect(result.status).toBe('running');
    const ctA = store.campaignTargets.find((t) => t.id === 'ct-a');
    const ctB = store.campaignTargets.find((t) => t.id === 'ct-b');
    expect(ctA?.status).toBe('pending');
    expect(ctA?.scheduledFor).not.toBeNull();
    expect(ctB?.status).toBe('skipped');
    expect(ctB?.skipReason).toBe('opted_out_before_start');
    // Contador de campanha reflete a exclusão via `advanceCampaignTargetStatus` real.
    expect(store.campaigns.find((c) => c.id === 'camp-1')?.skippedCount).toBe(1);
  });

  it('409 EMPTY_AUDIENCE (rollback) quando a 2ª passagem exclui TODOS os pendentes', async () => {
    seedRunnableCampaign();
    store.optOuts.push({ phoneE164: '+5511900000001' }, { phoneE164: '+5511900000002' });

    await expect(startCampaign('camp-1')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'EMPTY_AUDIENCE' });
    // Rollback: nada deveria ter avançado para "running".
    expect(store.campaigns.find((c) => c.id === 'camp-1')?.status).toBe('draft');
  });

  it('409 INSTANCE_NOT_CONNECTED quando alguma instância da campanha não está conectada', async () => {
    seedRunnableCampaign();
    store.instances[0]!.status = 'disconnected';
    await expect(startCampaign('camp-1')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'INSTANCE_NOT_CONNECTED' });
  });

  // 🆕 Fase 4.F.4 (ARQUITETURA §6.8.10/A32) — defesa em profundidade: o
  // contrato já recusa 0/6 na ENTRADA (`sendWindowSchema`, ver
  // `campaign.contract.test.ts`), mas uma linha ANTIGA no banco (criada
  // antes da restrição) pode ter `sendWindowDaysOfWeek: [0,6]` — a
  // interseção com o piso seg-sex da env fica VAZIA e a campanha nunca
  // enviaria nada, `running` para sempre, sem explicação na tela.
  it('409 EMPTY_SEND_WINDOW quando a janela efetiva (interseção com o piso) nunca abre', async () => {
    seedRunnableCampaign();
    const campaign = store.campaigns.find((c) => c.id === 'camp-1')!;
    campaign.sendWindowDaysOfWeek = [0, 6]; // linha "antiga" — só fim de semana, que o piso não tem para oferecer
    await expect(startCampaign('camp-1')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'EMPTY_SEND_WINDOW' });
    // Rollback: nada deveria ter avançado para "running".
    expect(store.campaigns.find((c) => c.id === 'camp-1')?.status).toBe('draft');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3) Recusa de edição com campanha rodando (ARQUITETURA §4.5.5, A28)
// ─────────────────────────────────────────────────────────────────────────

describe('patchCampaign — A28 (campanha running não é editável)', () => {
  it('409 CAMPAIGN_NOT_EDITABLE ao tentar editar QUALQUER campo com status="running"', async () => {
    store.campaigns.push({
      id: 'camp-running',
      name: 'Rodando',
      templateId: 'tpl-1',
      status: 'running',
      audienceSnapshot: {},
      renderedTemplateSnapshot: TEMPLATE_OK,
      dailyLimitPerInstance: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
      sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
      jitterMinSeconds: 45,
      jitterMaxSeconds: 180,
      skipRecentlyContactedDays: 30,
      haltReason: null,
      scheduledFor: null,
      createdById: 'u-1',
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      totalTargets: 1,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      respondedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });

    const body: PatchCampaignBody = { name: 'Novo nome' };
    await expect(patchCampaign('camp-running', body)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'CAMPAIGN_NOT_EDITABLE' });

    // Nada mudou — nem o campo que noutro estado seria trivialmente editável.
    expect(store.campaigns.find((c) => c.id === 'camp-running')?.name).toBe('Rodando');
  });

  it('em "paused", recusa campo fora da lista permitida (templateId) mas aceita "name"', async () => {
    store.campaigns.push({
      id: 'camp-paused',
      name: 'Pausada',
      templateId: 'tpl-1',
      status: 'paused',
      audienceSnapshot: {},
      renderedTemplateSnapshot: TEMPLATE_OK,
      dailyLimitPerInstance: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
      sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
      jitterMinSeconds: 45,
      jitterMaxSeconds: 180,
      skipRecentlyContactedDays: 30,
      haltReason: null,
      scheduledFor: null,
      createdById: 'u-1',
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      totalTargets: 0,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      respondedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });

    await expect(patchCampaign('camp-paused', { templateId: 'tpl-1' })).rejects.toMatchObject({ code: 'CONFLICT', reason: 'FIELD_NOT_EDITABLE_IN_STATE' });

    const updated = await patchCampaign('camp-paused', { name: 'Pausada (renomeada)' });
    expect(updated.name).toBe('Pausada (renomeada)');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4) Disparo manual respeita a trava de ritmo (delega ao MESMO portão)
// ─────────────────────────────────────────────────────────────────────────

describe('sendCampaignTargetMessage — disparo manual honra a cadência', () => {
  function seedRunningCampaignWithTarget(): void {
    store.leads.push(lead({ id: 'l-1', phoneE164: '+5511900000009' }));
    store.campaigns.push({
      id: 'camp-run',
      name: 'Rodando',
      templateId: 'tpl-1',
      status: 'running',
      audienceSnapshot: {},
      renderedTemplateSnapshot: TEMPLATE_OK,
      dailyLimitPerInstance: null,
      sendWindowStartHour: 9,
      sendWindowEndHour: 18,
      sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
      jitterMinSeconds: 45,
      jitterMaxSeconds: 180,
      skipRecentlyContactedDays: 30,
      haltReason: null,
      scheduledFor: null,
      createdById: 'u-1',
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
      totalTargets: 1,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      respondedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
    store.campaignInstances.push({ id: 'ci-1', campaignId: 'camp-run', instanceId: 'inst-1', sentCount: 0, failedCount: 0 });
    store.campaignTargets.push({ id: 'ct-1', campaignId: 'camp-run', leadId: 'l-1', phoneE164: '+5511900000009', status: 'pending', skipReason: null, attempt: 0, scheduledFor: new Date(), sentAt: null, createdAt: new Date(), updatedAt: new Date() });
  }

  it('delega para sendLeadMessage restringindo allowedInstanceIds à campanha, com texto vindo do snapshot congelado', async () => {
    seedRunningCampaignWithTarget();
    sendLeadMessageMock.mockResolvedValue({ ok: true });

    await sendCampaignTargetMessage('camp-run', 'ct-1', {}, { id: 'u-1', role: 'operator' });

    expect(sendLeadMessageMock).toHaveBeenCalledTimes(1);
    const [leadId, body, , campaignContext] = sendLeadMessageMock.mock.calls[0]!;
    expect(leadId).toBe('l-1');
    expect(body.templateId).toBeUndefined(); // nunca resolve do MessageTemplate vivo
    expect(typeof body.body).toBe('string');
    expect(campaignContext).toEqual({ targetId: 'ct-1', campaignId: 'camp-run', allowedInstanceIds: ['inst-1'] });
  });

  it('propaga a rejeição de SEND_PACE_LOCKED do guard SEM tocar o status do alvo (nenhum caminho paralelo de avanço)', async () => {
    seedRunningCampaignWithTarget();
    const paceLockedError = Object.assign(new Error('Aguarde o intervalo mínimo entre envios.'), { code: 'CONFLICT', reason: 'SEND_PACE_LOCKED' });
    sendLeadMessageMock.mockRejectedValue(paceLockedError);

    await expect(sendCampaignTargetMessage('camp-run', 'ct-1', {}, { id: 'u-1', role: 'operator' })).rejects.toBe(paceLockedError);

    // `campaigns.ts` NUNCA escreve `campaignTarget.status` — quem avançaria
    // (sucesso/falha/incerto) é `sendLeadMessage`, que aqui está mockado e
    // não tocou nada. O alvo tem que continuar exatamente como estava.
    expect(store.campaignTargets.find((t) => t.id === 'ct-1')?.status).toBe('pending');
  });

  it('409 TARGET_NOT_PENDING quando o alvo já foi processado — nunca chega a chamar sendLeadMessage', async () => {
    seedRunningCampaignWithTarget();
    store.campaignTargets[0]!.status = 'sent';

    await expect(sendCampaignTargetMessage('camp-run', 'ct-1', {}, { id: 'u-1', role: 'operator' })).rejects.toMatchObject({ code: 'CONFLICT', reason: 'TARGET_NOT_PENDING' });
    expect(sendLeadMessageMock).not.toHaveBeenCalled();
  });

  it('409 CAMPAIGN_NOT_RUNNING quando a campanha está pausada — nunca chega a chamar sendLeadMessage', async () => {
    seedRunningCampaignWithTarget();
    store.campaigns[0]!.status = 'paused';

    await expect(sendCampaignTargetMessage('camp-run', 'ct-1', {}, { id: 'u-1', role: 'operator' })).rejects.toMatchObject({ code: 'CONFLICT', reason: 'CAMPAIGN_NOT_RUNNING' });
    expect(sendLeadMessageMock).not.toHaveBeenCalled();
  });
});
