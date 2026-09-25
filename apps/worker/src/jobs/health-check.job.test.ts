/**
 * health-check.job.test.ts — a fatia MÍNIMA do health-check que entra na
 * Fase 4 (ARQUITETURA §6.6/§6.9): ping na Evolution (3x → halt em todas as
 * campanhas `running`) e taxa de falha > 30% em 50 envios → instância
 * `degraded` + warmup congelado. As heurísticas de shadow-ban por taxa de
 * RESPOSTA (Fase 5/6) NÃO têm teste aqui de propósito — não existem no código.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type * as SendingModule from '@inno/sending';
import type { FakeMessage } from '../test/fake-dispatch-db.js';

vi.mock('../observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const testConnectionMock = vi.fn();
vi.mock('@inno/sending', async (importOriginal) => {
  const actual = await importOriginal<typeof SendingModule>();
  return {
    ...actual,
    buildEvolutionClientFromServer: vi.fn(() => ({ testConnection: testConnectionMock })),
    buildLegacyEnvEvolutionClient: vi.fn(() => ({ testConnection: testConnectionMock })),
  };
});

const { runHealthCheck } = await import('./health-check.job.js');
const { fakePrismaClient, resetFakeDispatchDb, getFakeDispatchDbState } = await import('../test/fake-dispatch-db.js');

const NOW = new Date('2026-09-25T10:00:00.000Z');

function fakeQueueWithRedisState() {
  const kv = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    incr: vi.fn(async (key: string) => {
      const next = (Number.parseInt(kv.get(key) ?? '0', 10) || 0) + 1;
      kv.set(key, String(next));
      return next;
    }),
    del: vi.fn(async (key: string) => {
      kv.delete(key);
    }),
  };
  return { client: Promise.resolve(client) as unknown as Queue['client'], kv } as unknown as Queue & { kv: Map<string, string> };
}

function baseInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    name: 'Instância 1',
    status: 'connected',
    isDegraded: false,
    consecutiveFailures: 0,
    consecutiveUncertain: 0,
    warmupDay: 10,
    dailyLimitOverride: null,
    nextSendAllowedAt: null,
    sendsSinceMicroPause: 0,
    evolutionServerId: 'srv-1',
    lastErrorAt: null,
    lastErrorMessage: null,
    isActive: true,
    warmupFrozenAt: null,
    ...overrides,
  };
}

function baseServer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    baseUrl: 'https://evolution.example.com',
    isActive: true,
    apiKeyCiphertext: Buffer.from('c'),
    apiKeyIv: Buffer.from('i'),
    apiKeyAuthTag: Buffer.from('a'),
    apiKeyKeyVersion: 1,
    ...overrides,
  };
}

function makeDeps(maintenanceQueue: Queue) {
  return {
    prisma: fakePrismaClient as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    notify: vi.fn(),
    maintenanceQueue,
    now: () => NOW,
  };
}

beforeEach(() => {
  delete process.env.DISPATCH_HEALTH_CHECK_PING_HALT_AT;
  delete process.env.DISPATCH_HEALTH_CHECK_FAILURE_RATE_SAMPLE;
  delete process.env.DISPATCH_HEALTH_CHECK_FAILURE_RATE_THRESHOLD;
  resetFakeDispatchDb();
  testConnectionMock.mockReset();
});

describe('runHealthCheck — passo 1 (ping na Evolution)', () => {
  it('3 falhas de ping CONSECUTIVAS (todos os servidores) → halta todas as campanhas running + alerta', async () => {
    resetFakeDispatchDb({
      evolutionServers: [baseServer()],
      campaigns: [
        { id: 'camp-1', status: 'running', startedAt: NOW, finishedAt: null, haltReason: null, renderedTemplateSnapshot: null, sendWindowStartHour: 9, sendWindowEndHour: 18, sendWindowDaysOfWeek: [1, 2, 3, 4, 5], jitterMinSeconds: 45, jitterMaxSeconds: 180, dailyLimitPerInstance: null, totalTargets: 1, sentCount: 0, deliveredCount: 0, readCount: 0, respondedCount: 0, failedCount: 0, skippedCount: 0 },
      ],
    });
    testConnectionMock.mockRejectedValue(new Error('fora do ar'));

    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps); // 1ª falha
    await runHealthCheck(deps); // 2ª falha
    expect(getFakeDispatchDbState().campaigns[0]!.status).toBe('running'); // ainda não haltou

    await runHealthCheck(deps); // 3ª falha → halt

    expect(getFakeDispatchDbState().campaigns[0]!.status).toBe('halted');
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dispatch_evolution_down_all_halted', haltedCampaignCount: 1, consecutivePingFailures: 3 }),
    );
  });

  it('ping recupera antes de completar 3 falhas → contador reseta, não halta', async () => {
    resetFakeDispatchDb({
      evolutionServers: [baseServer()],
      campaigns: [
        { id: 'camp-1', status: 'running', startedAt: NOW, finishedAt: null, haltReason: null, renderedTemplateSnapshot: null, sendWindowStartHour: 9, sendWindowEndHour: 18, sendWindowDaysOfWeek: [1, 2, 3, 4, 5], jitterMinSeconds: 45, jitterMaxSeconds: 180, dailyLimitPerInstance: null, totalTargets: 1, sentCount: 0, deliveredCount: 0, readCount: 0, respondedCount: 0, failedCount: 0, skippedCount: 0 },
      ],
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    testConnectionMock.mockRejectedValueOnce(new Error('fora do ar'));
    await runHealthCheck(deps); // 1ª falha
    testConnectionMock.mockResolvedValueOnce(undefined);
    await runHealthCheck(deps); // recupera — reseta

    testConnectionMock.mockRejectedValueOnce(new Error('fora do ar'));
    testConnectionMock.mockRejectedValueOnce(new Error('fora do ar'));
    await runHealthCheck(deps); // 1ª de novo (não é a 3ª acumulada)
    await runHealthCheck(deps); // 2ª de novo

    expect(getFakeDispatchDbState().campaigns[0]!.status).toBe('running');
    expect(deps.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'dispatch_evolution_down_all_halted' }));
  });

  it('sem nenhum EvolutionServer/instância legada configurada → não conta como falha (nada a pingar)', async () => {
    resetFakeDispatchDb({});
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);
    await runHealthCheck(deps);
    await runHealthCheck(deps);

    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe('runHealthCheck — passo 2 (taxa de falha por instância)', () => {
  function messagesWithFailureRate(instanceId: string, total: number, failedCount: number): FakeMessage[] {
    const messages: FakeMessage[] = [];
    for (let i = 0; i < total; i++) {
      messages.push({
        id: `msg-${i}`,
        leadId: 'lead-1',
        instanceId,
        direction: 'outbound',
        body: 'x',
        status: i < failedCount ? 'failed' : 'sent',
        campaignTargetId: null,
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        sentAt: NOW,
        createdAt: new Date(NOW.getTime() - i * 1000),
      });
    }
    return messages;
  }

  it('taxa de falha > 30% em 50 envios → isDegraded + warmupFrozenAt, alerta', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance()],
      messages: messagesWithFailureRate('inst-1', 50, 20), // 40% de falha
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);

    const instance = getFakeDispatchDbState().whatsAppInstances[0]!;
    expect(instance.isDegraded).toBe(true);
    expect(instance.warmupFrozenAt).toEqual(NOW);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dispatch_instance_failure_rate_degraded', instanceId: 'inst-1' }),
    );
  });

  it('amostra insuficiente (< 50 envios resolvidos) → não decide nada', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance()],
      messages: messagesWithFailureRate('inst-1', 49, 49), // 100% de falha, mas amostra pequena
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.isDegraded).toBe(false);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('já congelada (warmupFrozenAt setado) e a taxa continua alta → não re-alerta (dedupe)', async () => {
    const frozenAt = new Date('2026-09-24T00:00:00.000Z');
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ isDegraded: true, warmupFrozenAt: frozenAt })],
      messages: messagesWithFailureRate('inst-1', 50, 20),
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupFrozenAt).toEqual(frozenAt); // não sobrescreveu
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('taxa volta ao normal → descongela (warmupFrozenAt: null), mas NÃO força isDegraded de volta a false', async () => {
    const frozenAt = new Date('2026-09-24T00:00:00.000Z');
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ isDegraded: true, warmupFrozenAt: frozenAt })],
      messages: messagesWithFailureRate('inst-1', 50, 5), // 10% de falha, abaixo do piso
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);

    const instance = getFakeDispatchDbState().whatsAppInstances[0]!;
    expect(instance.warmupFrozenAt).toBeNull();
    expect(instance.isDegraded).toBe(true); // decisão deliberada — ver comentário no job.
  });

  it('instância banida não é avaliada', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ status: 'banned' })],
      messages: messagesWithFailureRate('inst-1', 50, 50),
    });
    const queue = fakeQueueWithRedisState();
    const deps = makeDeps(queue);

    await runHealthCheck(deps);

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.isDegraded).toBe(false);
  });
});
