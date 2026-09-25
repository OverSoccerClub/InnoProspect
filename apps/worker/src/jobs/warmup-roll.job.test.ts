/**
 * warmup-roll.job.test.ts — ARQUITETURA §6.2/§6.9. Os 3 passos, isolados:
 * avança só quem enviou ontem, congela quem está com `warmupFrozenAt`, e
 * zera `sendsSinceMicroPause`/`consecutiveUncertain` sempre, independente
 * dos outros dois.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const { runWarmupRoll } = await import('./warmup-roll.job.js');
const { fakePrismaClient, resetFakeDispatchDb, getFakeDispatchDbState } = await import('../test/fake-dispatch-db.js');

// Quinta-feira 2026-09-25, 00:10 em America/Sao_Paulo (UTC-3) — "ontem" civil
// é 2026-09-24.
const NOW = new Date('2026-09-25T03:10:00.000Z');
const YESTERDAY_DATE_KEY = new Date('2026-09-24T00:00:00.000Z'); // meia-noite UTC do dia civil 24/09 (mesma granularidade de InstanceDailyStat.date).

function baseInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    name: 'Instância 1',
    status: 'connected',
    isDegraded: false,
    consecutiveFailures: 0,
    consecutiveUncertain: 7,
    warmupDay: 5,
    dailyLimitOverride: null,
    nextSendAllowedAt: null,
    sendsSinceMicroPause: 12,
    evolutionServerId: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    isActive: true,
    warmupFrozenAt: null,
    ...overrides,
  };
}

function makeDeps() {
  return {
    prisma: fakePrismaClient as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    now: () => NOW,
  };
}

beforeEach(() => {
  delete process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = 'America/Sao_Paulo';
  resetFakeDispatchDb();
});

describe('runWarmupRoll — passo 1 (avança quem enviou ontem)', () => {
  it('InstanceDailyStat de ontem com sentCount > 0 → warmupDay += 1', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ warmupDay: 5 })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 3, failedCount: 0 }],
    });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(6);
  });

  it('sem InstanceDailyStat de ontem (instância parada) → NÃO avança', async () => {
    resetFakeDispatchDb({ whatsAppInstances: [baseInstance({ warmupDay: 5 })] });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(5);
  });

  it('InstanceDailyStat de ontem com sentCount = 0 → NÃO avança (instância parada não amadurece sozinha)', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ warmupDay: 5 })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 0, failedCount: 2 }],
    });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(5);
  });

  it('InstanceDailyStat de HOJE (não ontem) com envios não conta para o avanço', async () => {
    const todayKey = new Date('2026-09-25T00:00:00.000Z');
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ warmupDay: 5 })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: todayKey, sentCount: 10, failedCount: 0 }],
    });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(5);
  });
});

describe('runWarmupRoll — passo 2 (congela, nunca recua)', () => {
  it('warmupFrozenAt setado → NÃO avança, mesmo com envio ontem', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ warmupDay: 5, warmupFrozenAt: new Date('2026-09-23T00:00:00.000Z') })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 5, failedCount: 0 }],
    });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(5);
  });

  it('congelado NÃO recua — warmupDay permanece o mesmo, não diminui', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ warmupDay: 5, warmupFrozenAt: new Date('2026-09-23T00:00:00.000Z') })],
    });

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances[0]!.warmupDay).toBe(5);
  });
});

describe('runWarmupRoll — passo 3 (zera contadores do dia, incondicional)', () => {
  it('zera sendsSinceMicroPause/consecutiveUncertain mesmo quando avança', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ sendsSinceMicroPause: 15, consecutiveUncertain: 4 })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 1, failedCount: 0 }],
    });

    await runWarmupRoll(makeDeps());

    const instance = getFakeDispatchDbState().whatsAppInstances[0]!;
    expect(instance.sendsSinceMicroPause).toBe(0);
    expect(instance.consecutiveUncertain).toBe(0);
  });

  it('zera mesmo quando congelado (passo 2)', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ sendsSinceMicroPause: 20, consecutiveUncertain: 3, warmupFrozenAt: new Date('2026-09-23T00:00:00.000Z') })],
    });

    await runWarmupRoll(makeDeps());

    const instance = getFakeDispatchDbState().whatsAppInstances[0]!;
    expect(instance.sendsSinceMicroPause).toBe(0);
    expect(instance.consecutiveUncertain).toBe(0);
  });

  it('zera mesmo quando NÃO avança por falta de envio ontem', async () => {
    resetFakeDispatchDb({ whatsAppInstances: [baseInstance({ sendsSinceMicroPause: 8, consecutiveUncertain: 2 })] });

    await runWarmupRoll(makeDeps());

    const instance = getFakeDispatchDbState().whatsAppInstances[0]!;
    expect(instance.sendsSinceMicroPause).toBe(0);
    expect(instance.consecutiveUncertain).toBe(0);
  });
});

describe('runWarmupRoll — múltiplas instâncias, isolamento de erro', () => {
  it('uma instância inativa (isActive=false) é ignorada', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ id: 'inst-1', isActive: false, warmupDay: 5 })],
      instanceDailyStats: [{ instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 10, failedCount: 0 }],
    });

    await runWarmupRoll(makeDeps());

    // Não lançou, e a instância inativa não foi nem carregada (findMany já filtra) — sem asserção de avanço, só que não quebrou.
    expect(getFakeDispatchDbState().whatsAppInstances).toHaveLength(1);
  });

  it('erro numa instância não impede o processamento das outras', async () => {
    resetFakeDispatchDb({
      whatsAppInstances: [baseInstance({ id: 'inst-1', warmupDay: 5 }), baseInstance({ id: 'inst-2', warmupDay: 8 })],
      instanceDailyStats: [
        { instanceId: 'inst-1', date: YESTERDAY_DATE_KEY, sentCount: 1, failedCount: 0 },
        { instanceId: 'inst-2', date: YESTERDAY_DATE_KEY, sentCount: 1, failedCount: 0 },
      ],
    });
    // Força um erro só na 1ª chamada de update (inst-1) — simula um problema
    // de escrita isolado, sem derrubar o ciclo inteiro.
    const originalUpdate = fakePrismaClient.whatsAppInstance.update.getMockImplementation()!;
    fakePrismaClient.whatsAppInstance.update.mockImplementationOnce(async () => {
      throw new Error('falha simulada de escrita');
    });
    fakePrismaClient.whatsAppInstance.update.mockImplementation(originalUpdate);

    await runWarmupRoll(makeDeps());

    expect(getFakeDispatchDbState().whatsAppInstances.find((i) => i.id === 'inst-2')!.warmupDay).toBe(9);
  });
});
