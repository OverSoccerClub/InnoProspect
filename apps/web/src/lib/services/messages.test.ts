/**
 * messages.test.ts — `POST /api/v1/leads/:id/messages` (ARQUITETURA §4.9).
 * Fake de Prisma local (padrão de `leads.test.ts`: mock dedicado ao que este
 * arquivo realmente chama, não um fake genérico) + `@inno/core` REAL (é o
 * que estamos testando integrado: `evaluateSendGuard`/render/spintax de
 * verdade, não um stand-in). `now` é fixado via `vi.setSystemTime` — sem
 * isso, G5/G6 (piso duro/janela comercial) ficariam reféns do horário real
 * em que `pnpm test` roda.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingError } from '@inno/messaging';
import { DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS } from '@inno/core';
import type { SendLeadMessageBody } from '@inno/contracts';

// Terça-feira, 10:00 em America/Sao_Paulo (13:00 UTC) — dentro do piso duro
// (08-20) E da janela comercial (09-18, fora do almoço).
const NOW = new Date('2026-09-22T13:00:00.000Z');
const TODAY_KEY = new Date('2026-09-22T00:00:00.000Z');

type FakeLead = {
  id: string;
  name: string;
  phoneE164: string | null;
  phoneType: string;
  status: string;
  uf: string;
  category: string | null;
  website: string | null;
  city: { name: string } | null;
};

type FakeInstance = {
  id: string;
  name: string;
  phoneNumber: string | null;
  evolutionInstanceName: string;
  status: string;
  isDegraded: boolean;
  warmupDay: number;
  dailyLimitOverride: number | null;
  consecutiveFailures: number;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  // 🆕 Fase 4.C (ARQUITETURA §4.9.10/§6.8.1) — cadência.
  nextSendAllowedAt: Date | null;
  sendsSinceMicroPause: number;
  consecutiveUncertain: number;
};

type FakeStat = { instanceId: string; date: Date; sentCount: number; failedCount: number };

type FakeMessage = {
  id: string;
  leadId: string;
  instanceId: string;
  direction: string;
  body: string;
  status: string;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

const store = vi.hoisted(() => ({
  nextId: 1,
  leads: [] as FakeLead[],
  instances: [] as FakeInstance[],
  stats: [] as FakeStat[],
  messages: [] as FakeMessage[],
  optOuts: [] as { phoneE164: string; createdAt: Date }[],
  templates: [] as { id: string; body: string; isActive: boolean }[],
  leadActivities: [] as { leadId: string; type: string; payload: unknown; actor: string }[],
}));

function genId(prefix: string): string {
  return `${prefix}-${store.nextId++}`;
}

function resetStore(): void {
  store.nextId = 1;
  store.leads = [];
  store.instances = [];
  store.stats = [];
  store.messages = [];
  store.optOuts = [];
  store.templates = [];
  store.leadActivities = [];
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

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
  // 🆕 Entrega 2 (correção do Órion, monotonicidade de `nextSendAllowedAt`):
  // único uso de `$executeRaw` neste serviço — replica no fake a MESMA
  // semântica da cláusula `WHERE` da UPDATE real ("só avança, NULL conta
  // como -infinito"), para o teste provar a regra sem precisar de Postgres.
  // Se o serviço algum dia fizer `SELECT` seguido de `if` em JS em vez desta
  // UPDATE condicional, este mock deixa de refletir o código de produção —
  // é o motivo de também haver uma asserção de que `$executeRaw` foi
  // chamado (prova de que a comparação passou pelo banco, não por um
  // `Math.max` em JavaScript).
  $executeRaw: vi.fn(async (_strings: unknown, ...values: unknown[]) => {
    const [candidate, instanceId] = values as [Date, string];
    const found = store.instances.find((i) => i.id === instanceId);
    if (!found) return 0;
    if (found.nextSendAllowedAt === null || found.nextSendAllowedAt.getTime() < candidate.getTime()) {
      found.nextSendAllowedAt = candidate;
      return 1;
    }
    return 0;
  }),
  lead: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.leads.find((l) => l.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const lead = store.leads.find((l) => l.id === where.id);
      if (!lead) throw new Error('fake: lead não encontrado');
      Object.assign(lead, data);
      return { ...lead };
    }),
  },
  messageTemplate: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.templates.find((t) => t.id === where.id) ?? null),
  },
  whatsAppInstance: {
    findMany: vi.fn(async () => store.instances.map((i) => ({ ...i }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = store.instances.find((i) => i.id === where.id);
      return found ? { ...found } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const instance = store.instances.find((i) => i.id === where.id);
      if (!instance) throw new Error('fake: instância não encontrada');
      applyIncrementsOrSets(instance as unknown as Record<string, unknown>, data);
      return { ...instance };
    }),
  },
  instanceDailyStat: {
    findMany: vi.fn(async ({ where }: { where: { instanceId: { in: string[] }; date: Date } }) =>
      store.stats.filter((s) => where.instanceId.in.includes(s.instanceId) && s.date.getTime() === where.date.getTime()),
    ),
    findUnique: vi.fn(async ({ where }: { where: { instanceId_date: { instanceId: string; date: Date } } }) => {
      const { instanceId, date } = where.instanceId_date;
      return store.stats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime()) ?? null;
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { instanceId_date: { instanceId: string; date: Date } };
        create: Pick<FakeStat, 'instanceId' | 'date' | 'sentCount'> & Partial<FakeStat>;
        update: Record<string, unknown>;
      }) => {
        const { instanceId, date } = where.instanceId_date;
        const existing = store.stats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime());
        if (existing) {
          applyIncrementsOrSets(existing as unknown as Record<string, unknown>, update);
          return { ...existing };
        }
        const created: FakeStat = { failedCount: 0, ...create };
        store.stats.push(created);
        return { ...created };
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { instanceId_date: { instanceId: string; date: Date } }; data: Record<string, unknown> }) => {
        const { instanceId, date } = where.instanceId_date;
        const stat = store.stats.find((s) => s.instanceId === instanceId && s.date.getTime() === date.getTime());
        if (!stat) throw new Error('fake: instanceDailyStat não encontrado');
        applyIncrementsOrSets(stat as unknown as Record<string, unknown>, data);
        return { ...stat };
      },
    ),
  },
  message: {
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { leadId: string; direction?: string };
        orderBy?: { createdAt: string };
      }) => {
        let rows = store.messages.filter((m) => m.leadId === where.leadId);
        if (where.direction) rows = rows.filter((m) => m.direction === where.direction);
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
    ),
    create: vi.fn(async ({ data }: { data: Partial<FakeMessage> & { leadId: string; instanceId: string; direction: string; body: string } }) => {
      const created: FakeMessage = {
        id: genId('msg'),
        status: 'queued',
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
      if (!message) throw new Error('fake: message não encontrada');
      Object.assign(message, data);
      return { ...message };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.messages.find((m) => m.id === where.id) ?? null),
  },
  optOut: {
    findUnique: vi.fn(async ({ where }: { where: { phoneE164: string } }) => store.optOuts.find((o) => o.phoneE164 === where.phoneE164) ?? null),
  },
  leadActivity: {
    create: vi.fn(async ({ data }: { data: { leadId: string; type: string; payload: unknown; actor: string } }) => {
      store.leadActivities.push(data);
      return { id: genId('activity'), createdAt: new Date(), ...data };
    }),
  },
  // 🆕 Fase 4.F.1 — `haltCampaignsSoleInstanceDisconnected` (kill switch de
  // instância desconectada) mudou de casa para `@inno/sending` e agora é
  // chamada DE DENTRO da sequência protegida (`executeSendAttempt`), nunca
  // mais via `@/lib/services/campaign-targets` (o mock antigo dessa rota,
  // removido abaixo, ficaria sem efeito — o caminho de execução real não
  // passa mais por ali). Nenhum teste desta suíte semeia `store.campaigns`,
  // então `findMany` sempre devolve `[]` — MESMO resultado do mock antigo
  // (`async () => []`), pela mesma razão de sempre: nenhum destes cenários
  // tem uma campanha para parar.
  campaign: {
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
const sendAlertMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/alerts', () => ({ sendAlert: sendAlertMock }));

const sendTextMock = vi.hoisted(() => vi.fn());
// 🆕 Fase 4.B — `sendLeadMessage` resolve o cliente por `getEvolutionClientForInstance`
// (não mais um singleton de env); mock devolve sempre o mesmo fake client independente da instância.
vi.mock('@/lib/evolution', () => ({ getEvolutionClientForInstance: vi.fn(async () => ({ sendText: sendTextMock })) }));

const { sendLeadMessage } = await import('./messages');
const { checkRateLimit } = await import('@/lib/rate-limit');

const ACTOR = { id: 'user-1', role: 'operator' };

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id'>): FakeLead {
  return {
    name: 'Empresa Teste',
    phoneE164: '+5511987654321',
    phoneType: 'mobile',
    status: 'new',
    uf: 'SP',
    category: 'Clínica odontológica',
    website: null,
    city: { name: 'Campinas' },
    ...overrides,
  };
}

function instance(overrides: Partial<FakeInstance> & Pick<FakeInstance, 'id'>): FakeInstance {
  return {
    name: 'Instância 1',
    phoneNumber: '+5511900000000',
    evolutionInstanceName: 'evo-1',
    status: 'connected',
    isDegraded: false,
    warmupDay: 22,
    dailyLimitOverride: null,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
    // 🆕 Fase 4.C — `null`/`0` = "nunca enviou" / "sem gate ainda" (estado de
    // toda instância que já existe hoje em produção, Cronos/migração
    // aditiva) — nunca deve bloquear por default.
    nextSendAllowedAt: null,
    sendsSinceMicroPause: 0,
    consecutiveUncertain: 0,
    ...overrides,
  };
}

function inboundMessage(overrides: Partial<FakeMessage> & Pick<FakeMessage, 'id' | 'leadId' | 'instanceId' | 'createdAt'>): FakeMessage {
  return {
    body: 'oi, quero saber mais',
    status: 'delivered',
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    sentAt: null,
    direction: 'inbound',
    ...overrides,
  };
}

function outboundMessage(overrides: Partial<FakeMessage> & Pick<FakeMessage, 'id' | 'leadId' | 'instanceId' | 'createdAt'>): FakeMessage {
  return {
    body: 'oi',
    status: 'sent',
    providerMessageId: 'prov-x',
    errorCode: null,
    errorMessage: null,
    sentAt: overrides.createdAt,
    direction: 'outbound',
    ...overrides,
  };
}

function body(overrides: Partial<SendLeadMessageBody> = {}): SendLeadMessageBody {
  return {
    body: 'Oi! Aqui é da Innova Prospect. Se não quiser mais receber, responda SAIR.',
    confirmOutsideBusinessWindow: false,
    allowNonMobile: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  vi.setSystemTime(NOW);
  process.env.APP_TIMEZONE = 'America/Sao_Paulo';
  process.env.APP_COMPANY_NAME = 'Innova Prospect';
  delete process.env.DISPATCH_QUIET_HOURS_START;
  delete process.env.DISPATCH_QUIET_HOURS_END;
  delete process.env.DISPATCH_WINDOW_START;
  delete process.env.DISPATCH_WINDOW_END;
  delete process.env.MANUAL_SEND_DUPLICATE_WINDOW_S;
  delete process.env.MANUAL_SEND_RATE_PER_MIN;
  delete process.env.COLD_FOLLOWUP_COOLDOWN_H;
  delete process.env.DISPATCH_JITTER_MIN_S;
  delete process.env.DISPATCH_JITTER_MAX_S;
  delete process.env.DISPATCH_MICRO_PAUSE_EVERY_MIN;
  delete process.env.DISPATCH_MICRO_PAUSE_EVERY_MAX;
  delete process.env.DISPATCH_MICRO_PAUSE_MIN_S;
  delete process.env.DISPATCH_MICRO_PAUSE_MAX_S;
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true });
  sendTextMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendLeadMessage — G11 opt-out bloqueia ANTES de qualquer escrita', () => {
  it('recusa com 409/OPTED_OUT e não cria Message nem altera InstanceDailyStat', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    store.optOuts.push({ phoneE164: '+5511987654321', createdAt: new Date('2026-08-01T00:00:00.000Z') });

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'OPTED_OUT' });

    expect(store.messages).toHaveLength(0);
    expect(store.stats).toHaveLength(0);
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G3 lead sem telefone', () => {
  it('recusa com 409/LEAD_HAS_NO_PHONE antes de resolver instância', async () => {
    store.leads.push(lead({ id: 'lead-1', phoneE164: null }));
    store.instances.push(instance({ id: 'inst-1' }));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'LEAD_HAS_NO_PHONE' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G8 cota diária estourada', () => {
  it('recusa com 409/INSTANCE_NOT_CONNECTED quando a ÚNICA instância elegível (auto-seleção) já bateu o teto — ARQUITETURA §4.9.4 item 3: "nenhuma elegível" fala por status/cota juntos', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', warmupDay: 1 })); // teto do dia 1 = 20
    store.stats.push({ instanceId: 'inst-1', date: TODAY_KEY, sentCount: 20, failedCount: 0 });

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'INSTANCE_NOT_CONNECTED' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('recusa com 409/DAILY_LIMIT_REACHED quando o operador pede uma instanceId ESPECÍFICA que já bateu o teto (G8 dentro do guard, sem o pré-filtro da auto-seleção)', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', warmupDay: 1 }));
    store.stats.push({ instanceId: 'inst-1', date: TODAY_KEY, sentCount: 20, failedCount: 0 });

    await expect(sendLeadMessage('lead-1', body({ instanceId: 'inst-1' }), ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'DAILY_LIMIT_REACHED',
    });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G5 fora do horário permitido', () => {
  it('recusa com 409/QUIET_HOURS fora do piso duro, mesmo com todas as confirmações', async () => {
    vi.setSystemTime(new Date('2026-09-23T01:00:00.000Z')); // 22:00 em SP
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));

    await expect(
      sendLeadMessage('lead-1', body({ confirmOutsideBusinessWindow: true, allowNonMobile: true }), ACTOR),
    ).rejects.toMatchObject({ code: 'CONFLICT', reason: 'QUIET_HOURS' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G7 instância desconectada', () => {
  it('recusa com 409/INSTANCE_NOT_CONNECTED quando a única instância elegível está desconectada', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', status: 'disconnected' }));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'INSTANCE_NOT_CONNECTED' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G9 anti-duplo-clique', () => {
  it('recusa com 409/DUPLICATE_SEND quando já existe outbound há menos de 60s', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    store.messages.push({
      id: 'msg-0',
      leadId: 'lead-1',
      instanceId: 'inst-1',
      direction: 'outbound',
      body: 'oi',
      status: 'sent',
      providerMessageId: 'prov-0',
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(NOW.getTime() - 10_000),
      createdAt: new Date(NOW.getTime() - 10_000),
    });

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'DUPLICATE_SEND' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — sucesso', () => {
  it('grava Message(sent) com providerMessageId, incrementa a cota e avança o Lead para contacted', async () => {
    store.leads.push(lead({ id: 'lead-1', status: 'new' }));
    store.instances.push(instance({ id: 'inst-1' }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-123', remoteJid: '5511987654321@s.whatsapp.net', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body(), ACTOR);

    expect(result.message.status).toBe('sent');
    expect(result.message.providerMessageId).toBe('evo-msg-123');
    expect(result.quota.sentToday).toBe(1);
    expect(result.quota.remaining).toBe(result.quota.dailyLimit - 1);

    expect(sendTextMock).toHaveBeenCalledWith('evo-1', { to: '+5511987654321', text: body().body });
    expect(store.stats.find((s) => s.instanceId === 'inst-1')?.sentCount).toBe(1);
    expect(store.leads.find((l) => l.id === 'lead-1')?.status).toBe('contacted');
    expect(store.leadActivities.some((a) => a.type === 'message_sent')).toBe(true);
  });

  it('lead que já está "validated" avança direto para "contacted" (sem pular a FSM)', async () => {
    store.leads.push(lead({ id: 'lead-1', status: 'validated' }));
    store.instances.push(instance({ id: 'inst-1' }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-1', remoteJid: 'x', rawStatus: null });

    await sendLeadMessage('lead-1', body(), ACTOR);

    expect(store.leads.find((l) => l.id === 'lead-1')?.status).toBe('contacted');
  });

  it('renderiza templateId com spintax determinístico quando spintaxSeed não é informado', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    store.templates.push({ id: 'tpl-1', body: 'Olá {{primeiro_nome}}! Aqui é da {{minha_empresa}}. Responda SAIR para não receber mais.', isActive: true });
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-2', remoteJid: 'x', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body({ body: undefined, templateId: 'tpl-1' }), ACTOR);

    expect(result.renderedFrom?.templateId).toBe('tpl-1');
    expect(result.message.body).toContain('Aqui é da Innova Prospect');
    expect(result.message.body).toContain('Empresa'); // primeiro_nome de "Empresa Teste"
  });
});

describe('sendLeadMessage — falha da Evolution compensa os contadores', () => {
  it('em INSTANCE_DISCONNECTED: Message vira failed, sentCount volta, failedCount sobe, instância desconecta e devolve 409', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    sendTextMock.mockRejectedValue(new MessagingError('INSTANCE_DISCONNECTED', 'instância caiu'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'INSTANCE_NOT_CONNECTED' });

    const stat = store.stats.find((s) => s.instanceId === 'inst-1');
    expect(stat?.sentCount).toBe(0); // 1 (write-ahead) - 1 (compensação) = 0
    expect(stat?.failedCount).toBe(1);
    expect(store.messages[0]?.status).toBe('failed');
    expect(store.instances.find((i) => i.id === 'inst-1')?.status).toBe('disconnected');
    expect(store.leadActivities.some((a) => a.type === 'message_failed')).toBe(true);
    // Alerta de instância caindo (achado do dono, 2026-09-23: isto era
    // silencioso) — mensagem PRÓPRIA, nunca `err.message` cru da Evolution.
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'instance_disconnected', instanceId: 'inst-1', reason: 'disconnected' }),
    );
    const disconnectCall = sendAlertMock.mock.calls.find((c) => (c[0] as { kind: string }).kind === 'instance_disconnected')![0] as { message: string };
    expect(disconnectCall.message).not.toContain('instância caiu'); // não repassa o `err.message` cru
    // Também alerta saúde da Evolution API (código, sem a mensagem crua).
    expect(sendAlertMock).toHaveBeenCalledWith({ kind: 'evolution_api_error', action: 'enviar mensagem', code: 'INSTANCE_DISCONNECTED' });
  });

  it('5 falhas consecutivas degradam a instância (kill switch do §4.9.5/§6.6) — usando RATE_LIMITED, que É uma falha CONFIRMADA (a Evolution rejeitou antes de tentar enviar)', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', consecutiveFailures: 4 }));
    sendTextMock.mockRejectedValue(new MessagingError('RATE_LIMITED', 'limite da Evolution'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', reason: 'EVOLUTION_RATE_LIMITED' });

    expect(store.instances.find((i) => i.id === 'inst-1')?.consecutiveFailures).toBe(5);
    expect(store.instances.find((i) => i.id === 'inst-1')?.isDegraded).toBe(true);
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'instance_degraded', instanceId: 'inst-1', consecutiveFailures: 5, threshold: 5 }),
    );
  });

  it('a 4ª falha consecutiva (ainda abaixo do limite) NÃO alerta instance_degraded', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', consecutiveFailures: 3 }));
    sendTextMock.mockRejectedValue(new MessagingError('RATE_LIMITED', 'limite da Evolution'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    expect(store.instances.find((i) => i.id === 'inst-1')?.consecutiveFailures).toBe(4);
    expect(sendAlertMock).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'instance_degraded' }));
  });

  it('INVALID_NUMBER não incrementa consecutiveFailures (não é falha da instância) nem alerta saúde da Evolution API (o erro é do NÚMERO do lead, mensagem ecoa o telefone)', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', consecutiveFailures: 0 }));
    sendTextMock.mockRejectedValue(new MessagingError('INVALID_NUMBER', 'número sem WhatsApp'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'NUMBER_HAS_NO_WHATSAPP' });

    expect(store.instances.find((i) => i.id === 'inst-1')?.consecutiveFailures).toBe(0);
    expect(sendAlertMock).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'evolution_api_error' }));
  });
});

describe('sendLeadMessage — resultado INCERTO no timeout/erro transitório do envio (achado do Órion, 2026-09-22)', () => {
  it('timeout no envio: devolve 502/EVOLUTION_SEND_UNCERTAIN, NÃO chama sendText uma 2ª vez, NÃO restaura a cota (pode ter saído) e NÃO pune a instância — MAS avança a cadência (Fase 4.C, §6.8.7: "depois de TODO envio")', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', consecutiveFailures: 0, sendsSinceMicroPause: 5, consecutiveUncertain: 1 }));
    sendTextMock.mockRejectedValue(new MessagingError('TIMEOUT', 'Evolution API não respondeu em 15000ms'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', reason: 'EVOLUTION_SEND_UNCERTAIN' });

    expect(sendTextMock).toHaveBeenCalledTimes(1); // nenhuma 2ª chamada — nem retry de transporte, nem retry nosso
    const stat = store.stats.find((s) => s.instanceId === 'inst-1');
    expect(stat?.sentCount).toBe(1); // NÃO decrementado — pode ter sido entregue de verdade
    expect(stat?.failedCount).toBe(0); // não é uma falha confirmada
    const message = store.messages[0];
    expect(message?.status).toBe('failed');
    expect(message?.errorCode).toBe('EVOLUTION_SEND_UNCERTAIN');
    expect(message?.errorMessage).toMatch(/incerto/i);
    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    expect(updatedInstance?.consecutiveFailures).toBe(0);
    expect(updatedInstance?.status).toBe('connected');
    expect(store.leadActivities.some((a) => a.type === 'message_uncertain')).toBe(true);
    // 🆕 Fase 4.C — resultado incerto É o caso mais importante para avançar o
    // gate: a mensagem pode ter saído, então o ritmo avança como se tivesse.
    expect(updatedInstance?.nextSendAllowedAt).not.toBeNull();
    expect(updatedInstance!.nextSendAllowedAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(updatedInstance?.sendsSinceMicroPause).toBe(6); // 5 + 1, modo 'full' (1º contato frio)
    expect(updatedInstance?.consecutiveUncertain).toBe(2); // sobe em incerto (distinto de consecutiveFailures)
    // Incremento ATÔMICO — a chamada ao Prisma usa `{ increment: 1 }`, nunca
    // o valor somado em JavaScript (Cronos: "nunca read-modify-write em JS").
    expect(prismaMock.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sendsSinceMicroPause: { increment: 1 }, consecutiveUncertain: { increment: 1 } }) }),
    );
  });

  it('TRANSIENT_ERROR no envio (5xx/rede) tem o MESMO tratamento incerto que TIMEOUT', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    sendTextMock.mockRejectedValue(new MessagingError('TRANSIENT_ERROR', 'Evolution respondeu 503'));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', reason: 'EVOLUTION_SEND_UNCERTAIN' });

    const stat = store.stats.find((s) => s.instanceId === 'inst-1');
    expect(stat?.sentCount).toBe(1);
    expect(store.instances.find((i) => i.id === 'inst-1')?.consecutiveFailures).toBe(0);
  });
});

describe('sendLeadMessage — Fase 4.C: cadência ligada no envio unitário (ARQUITETURA §4.9.10/§6.8.7)', () => {
  it('envio permitido: instância com nextSendAllowedAt NULO (estado de toda instância já existente) continua enviando normalmente', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt: null }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-1', remoteJid: 'x', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body(), ACTOR);

    expect(result.message.status).toBe('sent');
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it('envio travado: 1º contato frio com nextSendAllowedAt no futuro devolve 409/SEND_PACE_LOCKED com o horário de liberação em details[] — NÃO chama sendText', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    const nextSendAllowedAt = new Date(NOW.getTime() + 60_000); // 60s no futuro
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt }));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'SEND_PACE_LOCKED',
      details: [{ path: 'nextSendAllowedAt', message: nextSendAllowedAt.toISOString() }],
    });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('resposta a conversa aberta BYPASSA o SEND_PACE_LOCKED (overrides.ignorePaceLock, honrado só porque isColdFirstContact é false) — avisa PACE_LOCK_BYPASSED_FOR_REPLY e avança o gate só pelo PISO do jitter, sem tocar sendsSinceMicroPause', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    // Gate atual (10s no futuro) é MENOR que o piso do modo 'floor' (45s) —
    // este envio de fato AVANÇA o gate (não é o cenário de corrida/recuo,
    // ver o teste de monotonicidade abaixo).
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt: new Date(NOW.getTime() + 10_000), sendsSinceMicroPause: 5 }));
    store.messages.push(outboundMessage({ id: 'msg-out', leadId: 'lead-1', instanceId: 'inst-1', createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }));
    store.messages.push(inboundMessage({ id: 'msg-in', leadId: 'lead-1', instanceId: 'inst-1', createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-2', remoteJid: 'x', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body(), ACTOR);

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(result.warnings.some((w) => w.code === 'PACE_LOCK_BYPASSED_FOR_REPLY')).toBe(true);
    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    // Modo 'floor': só o piso do jitter (45s default), determinístico — sem sorteio.
    expect(updatedInstance?.nextSendAllowedAt?.toISOString()).toBe(new Date(NOW.getTime() + 45_000).toISOString());
    expect(updatedInstance?.sendsSinceMicroPause).toBe(5); // NÃO tocado (decisão da Fase 4.B) — nem incrementado, nem zerado
  });

  it('🆕 Entrega 2 (achado do Órion) — nextSendAllowedAt NUNCA RECUA: um gate já mais no futuro (gravado por outro envio concorrente) NÃO é sobrescrito por um valor menor deste envio', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    // Simula a corrida real: outro envio concorrente (ex.: uma micro-pausa
    // que caiu bem nesta instância) já comitou um gate BEM mais no futuro
    // (10min) do que o piso do jitter que ESTE envio (modo 'floor', bypass de
    // resposta) vai calcular (45s). ANTES da correção, o `SET` cego deste
    // envio sobrescrevia o valor maior já gravado — a trava anti-banimento
    // recuava de 10min para 45s, sem erro e sem alarme.
    const farFutureGate = new Date(NOW.getTime() + 10 * 60 * 1000);
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt: farFutureGate, sendsSinceMicroPause: 5 }));
    store.messages.push(outboundMessage({ id: 'msg-out', leadId: 'lead-1', instanceId: 'inst-1', createdAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }));
    store.messages.push(inboundMessage({ id: 'msg-in', leadId: 'lead-1', instanceId: 'inst-1', createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-race', remoteJid: 'x', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body(), ACTOR);

    expect(result.message.status).toBe('sent'); // a correção não bloqueia o envio, só protege a coluna
    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    // O candidato deste envio (NOW + 45s) é MENOR que o gate já gravado
    // (NOW + 10min) — o valor MAIOR persiste, não é sobrescrito.
    expect(updatedInstance?.nextSendAllowedAt?.toISOString()).toBe(farFutureGate.toISOString());
    // Prova de que quem decidiu "não sobrescrever" foi a cláusula WHERE da
    // UPDATE (banco), não um `if` no serviço: `$executeRaw` foi chamado com
    // o candidato menor mesmo assim, e ainda assim o valor maior persistiu.
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
  });

  it('🆕 Entrega 2 (achado do Órion) — nextSendAllowedAt AVANÇA normalmente quando o candidato deste envio é de fato maior que o gate já gravado', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt: null, sendsSinceMicroPause: 5 }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-advance', remoteJid: 'x', rawStatus: null });

    await sendLeadMessage('lead-1', body(), ACTOR);

    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    expect(updatedInstance?.nextSendAllowedAt).not.toBeNull();
    expect(updatedInstance!.nextSendAllowedAt!.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('1º contato frio NÃO bypassa mesmo com o serviço sempre pedindo ignorePaceLock — a trava é do NÚMERO e o guard anula o override para contato frio (ARQUITETURA A24)', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    // Sem nenhuma mensagem anterior → isColdFirstContact = true.
    store.instances.push(instance({ id: 'inst-1', nextSendAllowedAt: new Date(NOW.getTime() + 60_000) }));

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'SEND_PACE_LOCKED' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('G9b — 2º contato frio dentro do cooldown (lead nunca respondeu) devolve 409/LEAD_CONTACT_COOLDOWN com "resetsAt" calculado a partir de lastOutboundAt + COLD_FOLLOWUP_COOLDOWN_H', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    const lastOutboundAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2h atrás — fora da janela de duplo-clique (60s), dentro do cooldown de 24h
    store.messages.push(outboundMessage({ id: 'msg-out', leadId: 'lead-1', instanceId: 'inst-1', createdAt: lastOutboundAt }));
    // Nenhuma mensagem inbound — lead nunca respondeu.

    const expectedResetsAt = new Date(lastOutboundAt.getTime() + DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS);

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'LEAD_CONTACT_COOLDOWN',
      details: [{ path: 'resetsAt', message: expectedResetsAt.toISOString() }],
    });
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it('G9b respeita COLD_FOLLOWUP_COOLDOWN_H da env — cooldown mais curto libera mais rápido', async () => {
    process.env.COLD_FOLLOWUP_COOLDOWN_H = '1'; // 1h, não 24h
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    const lastOutboundAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2h atrás — já passou do cooldown de 1h
    store.messages.push(outboundMessage({ id: 'msg-out', leadId: 'lead-1', instanceId: 'inst-1', createdAt: lastOutboundAt }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-3', remoteJid: 'x', rawStatus: null });

    const result = await sendLeadMessage('lead-1', body(), ACTOR);

    expect(result.message.status).toBe('sent'); // não bloqueou — cooldown de 1h já expirou
  });

  it('sucesso: avança nextSendAllowedAt e incrementa sendsSinceMicroPause de forma ATÔMICA ({ increment: 1 }, nunca lido-e-somado em JS), e zera consecutiveUncertain', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', sendsSinceMicroPause: 5, consecutiveUncertain: 3 }));
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-4', remoteJid: 'x', rawStatus: null });

    await sendLeadMessage('lead-1', body(), ACTOR);

    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    expect(updatedInstance?.nextSendAllowedAt).not.toBeNull();
    expect(updatedInstance!.nextSendAllowedAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(updatedInstance?.sendsSinceMicroPause).toBe(6); // 5 + 1 — abaixo de everyMin(18), nunca dispara micro-pausa
    expect(updatedInstance?.consecutiveUncertain).toBe(0); // zerado por SUCESSO confirmado
    expect(prismaMock.whatsAppInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sendsSinceMicroPause: { increment: 1 } }) }),
    );
  });

  it('micro-pausa: sendsSinceMicroPause já em everyMax (25) SEMPRE dispara (determinístico) — reseta para 0 (SET incondicional) e o gate recebe um jitter de 5–12min, não de 45–180s', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1', sendsSinceMicroPause: 24 })); // 24 + 1 = 25 = everyMax
    sendTextMock.mockResolvedValue({ providerMessageId: 'evo-msg-5', remoteJid: 'x', rawStatus: null });

    await sendLeadMessage('lead-1', body(), ACTOR);

    const updatedInstance = store.instances.find((i) => i.id === 'inst-1');
    expect(updatedInstance?.sendsSinceMicroPause).toBe(0); // zerado, não incrementado
    const deltaMs = updatedInstance!.nextSendAllowedAt!.getTime() - NOW.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(12 * 60 * 1000);
  });
});

describe('sendLeadMessage — teto entre a decisão e o envio (achado do Órion, 2026-09-22)', () => {
  it('write-ahead que demora mais que MAX_DECISION_TO_SEND_MS: NÃO chama sendText, desfaz a reserva por completo e devolve 409/SEND_WINDOW_EXPIRED', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));

    // Simula uma transação de write-ahead lenta: avança o relógio 6s (acima
    // do teto de 5s) DENTRO da própria transação mockada — é exatamente o
    // "banco sob carga" que o Órion pediu para cobrir.
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const result = await fn(prismaMock);
      vi.setSystemTime(new Date(NOW.getTime() + 6_000));
      return result;
    });

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'CONFLICT', reason: 'SEND_WINDOW_EXPIRED' });

    expect(sendTextMock).not.toHaveBeenCalled();
    const stat = store.stats.find((s) => s.instanceId === 'inst-1');
    expect(stat?.sentCount).toBe(0); // reserva desfeita por completo — sabemos que nada foi enviado
    const message = store.messages[0];
    expect(message?.status).toBe('failed');
    expect(message?.errorCode).toBe('SEND_WINDOW_EXPIRED');
    expect(store.leadActivities.some((a) => a.type === 'message_send_expired')).toBe(true);
  });
});

describe('sendLeadMessage — rate limit por usuário (MANUAL_SEND_RATE_PER_MIN)', () => {
  it('recusa com 429/MANUAL_SEND_RATE_LIMIT quando checkRateLimit nega', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterMs: 5_000 });

    await expect(sendLeadMessage('lead-1', body(), ACTOR)).rejects.toMatchObject({ code: 'RATE_LIMITED', reason: 'MANUAL_SEND_RATE_LIMIT' });
    expect(sendTextMock).not.toHaveBeenCalled();
  });
});

describe('sendLeadMessage — G2 payload', () => {
  it('recusa com 422/BODY_OR_TEMPLATE_REQUIRED quando nenhum dos dois é informado', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));

    await expect(sendLeadMessage('lead-1', body({ body: undefined, templateId: undefined }), ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      reason: 'BODY_OR_TEMPLATE_REQUIRED',
    });
  });

  it('recusa com 422/BODY_OR_TEMPLATE_REQUIRED quando os dois são informados', async () => {
    store.leads.push(lead({ id: 'lead-1' }));
    store.instances.push(instance({ id: 'inst-1' }));

    await expect(sendLeadMessage('lead-1', body({ templateId: 'tpl-1' }), ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      reason: 'BODY_OR_TEMPLATE_REQUIRED',
    });
  });
});
