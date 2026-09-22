/**
 * scheduler.test.ts — cobre só a regra de transição do alerta de retomada
 * automática (`sweepQueuePause`, Onda 2): "fila for retomada" só alerta
 * quando o sweep de fato resume (não em todo tick, e não quando outro
 * caminho já resumiu antes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

vi.mock('./observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const sendAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('./observability/alerts.js', () => ({ sendAlert }));

let pauseMeta: { code: string; message: string; resumeAt: string | null } | null = null;
const readQueuePauseMeta = vi.fn(async () => pauseMeta);
const clearQueuePauseMeta = vi.fn(async () => {
  pauseMeta = null;
});
const recordHeartbeat = vi.fn();
vi.mock('./lib/queue-state.js', () => ({
  HEARTBEAT_INTERVAL_MS: 15_000,
  PAUSE_SWEEP_INTERVAL_MS: 20_000,
  readQueuePauseMeta,
  clearQueuePauseMeta,
  recordHeartbeat,
}));

const { sweepQueuePause } = await import('./scheduler.js');

function fakeQueue(isPausedNow: boolean) {
  return {
    isPaused: vi.fn(async () => isPausedNow),
    resume: vi.fn(async () => undefined),
  } as unknown as Queue;
}

describe('sweepQueuePause (transição de alerta de retomada)', () => {
  beforeEach(() => {
    sendAlert.mockClear();
    clearQueuePauseMeta.mockClear();
    pauseMeta = null;
  });

  it('pausa temporizada venceu e a fila ainda está pausada: resume e alerta', async () => {
    pauseMeta = { code: 'RATE_LIMITED', message: 'rate limited', resumeAt: new Date(Date.now() - 1_000).toISOString() };
    const queue = fakeQueue(true);

    await sweepQueuePause(queue);

    expect(queue.resume).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'queue_resumed', code: 'RATE_LIMITED' }),
    );
  });

  it('sem pausa registrada: não faz nada, não alerta', async () => {
    pauseMeta = null;
    const queue = fakeQueue(false);

    await sweepQueuePause(queue);

    expect(queue.resume).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('pausa ainda não venceu: não resume, não alerta', async () => {
    pauseMeta = { code: 'RATE_LIMITED', message: 'rate limited', resumeAt: new Date(Date.now() + 60_000).toISOString() };
    const queue = fakeQueue(true);

    await sweepQueuePause(queue);

    expect(queue.resume).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('venceu mas a fila já não estava pausada (retomada manual enquanto isso): só limpa a metadata órfã, não alerta', async () => {
    pauseMeta = { code: 'LAYOUT_CHANGED', message: 'layout mudou', resumeAt: new Date(Date.now() - 1_000).toISOString() };
    const queue = fakeQueue(false);

    await sweepQueuePause(queue);

    expect(queue.resume).not.toHaveBeenCalled();
    expect(clearQueuePauseMeta).toHaveBeenCalledTimes(1);
    expect(sendAlert).not.toHaveBeenCalled();
  });
});
