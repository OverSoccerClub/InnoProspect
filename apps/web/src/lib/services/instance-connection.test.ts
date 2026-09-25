/**
 * instance-connection.test.ts — `applyInstanceConnectionTransition`
 * (ARQUITETURA §4.6/§6.6, reconciliação 2026-09-24) e, 🆕 Fase 4.F.5
 * (ARQUITETURA §6.2/§6.9), o recuo de 30% do warmup ao reconectar
 * (`regressWarmupDay`, ligado nesta rodada — código sem chamador desde a
 * Fase 3). O aceite real (§8.0 regra 3) é a tela mostrar `warmupDay` menor
 * depois de uma reconexão — este teste prova o CAMINHO que sustenta essa
 * tela: o valor É escrito no banco na transição certa, e NUNCA na
 * reconfirmação `connected → connected` (ver comentário no cabeçalho do
 * arquivo sob teste para o motivo).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inno/db', async () => {
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { prisma: fakePrismaClient };
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
const sendAlertMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/alerts', () => ({ sendAlert: sendAlertMock }));

const { applyInstanceConnectionTransition } = await import('./instance-connection');
const { getFakeDbState, resetFakeDb } = await import('@/test/fake-db');

beforeEach(() => {
  resetFakeDb();
  sendAlertMock.mockClear();
});

describe('applyInstanceConnectionTransition — recuo de warmup ao reconectar (Fase 4.F.5)', () => {
  it('disconnected → connected: regride warmupDay em 30% (arredondado para baixo)', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'disconnected', isDegraded: true, consecutiveFailures: 3, lastConnectionAt: null, lastErrorAt: new Date(), lastErrorMessage: 'queda', warmupDay: 10 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'disconnected',
      nextStatus: 'connected',
    });

    // Math.max(1, Math.floor(10 * 0.7)) = 7
    expect(result.warmupRegression).toEqual({ fromDay: 10, toDay: 7 });
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(7);
  });

  it('banned → connected: regride do mesmo jeito (a ARQUITETURA trata os dois como "queda")', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'banned', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: new Date(), lastErrorMessage: 'banida', warmupDay: 22 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'banned',
      nextStatus: 'connected',
    });

    // Math.max(1, Math.floor(22 * 0.7)) = 15
    expect(result.warmupRegression).toEqual({ fromDay: 22, toDay: 15 });
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(15);
  });

  it('nunca recua abaixo do dia 1', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'disconnected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, warmupDay: 1 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'disconnected',
      nextStatus: 'connected',
    });

    expect(result.warmupRegression).toEqual({ fromDay: 1, toDay: 1 });
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(1);
  });

  it('connected → connected (reconfirmação, ex.: reconciliação automática) NÃO regride — este é o caso que o briefing avisa não poder disparar a cada tela', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: new Date(), lastErrorAt: null, lastErrorMessage: null, warmupDay: 10 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'connected',
      nextStatus: 'connected',
    });

    expect(result.warmupRegression).toBeNull();
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(10);
  });

  it('connected → disconnected (queda) NÃO regride — o recuo é só na direção QUEDA→conectada', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: new Date(), lastErrorAt: null, lastErrorMessage: null, warmupDay: 10 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'connected',
      nextStatus: 'disconnected',
    });

    expect(result.warmupRegression).toBeNull();
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(10);
  });

  it('disconnected → connecting (Evolution reconectando sozinha) NÃO regride — connecting não é "voltou"', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'disconnected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, warmupDay: 10 },
      ],
    });

    const result = await applyInstanceConnectionTransition({
      instanceId: 'inst-1',
      instanceName: 'Vendas SP',
      previousStatus: 'disconnected',
      nextStatus: 'connecting',
    });

    expect(result.warmupRegression).toBeNull();
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(10);
  });

  it('duas reconexões reais em sequência regridem DUAS VEZES (comportamento correto — não é bug de oscilação)', async () => {
    resetFakeDb({
      whatsAppInstances: [
        { id: 'inst-1', name: 'Vendas SP', status: 'disconnected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, warmupDay: 20 },
      ],
    });

    await applyInstanceConnectionTransition({ instanceId: 'inst-1', instanceName: 'Vendas SP', previousStatus: 'disconnected', nextStatus: 'connected' });
    // Math.floor(20*0.7) = 14. Cai de novo:
    await applyInstanceConnectionTransition({ instanceId: 'inst-1', instanceName: 'Vendas SP', previousStatus: 'connected', nextStatus: 'disconnected' });
    // E volta de novo — segunda queda real, segundo recuo:
    const second = await applyInstanceConnectionTransition({ instanceId: 'inst-1', instanceName: 'Vendas SP', previousStatus: 'disconnected', nextStatus: 'connected' });

    // Math.floor(14*0.7) = 9
    expect(second.warmupRegression).toEqual({ fromDay: 14, toDay: 9 });
    expect(getFakeDbState().whatsAppInstances[0]!.warmupDay).toBe(9);
  });
});
