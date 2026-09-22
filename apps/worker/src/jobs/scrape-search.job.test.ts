/**
 * scrape-search.job.test.ts — cobre só a regra de transição do alerta de
 * pausa (`pauseQueueFor`, Onda 2): "pausa que já estava pausada não
 * realerta". O resto de `createScrapeSearchProcessor` (fluxo completo de
 * scrape/dedupe/retry) fica para quando o REVISAO-QA.md §4 prioridade #5
 * entrar (`passWithNoTests` em `vitest.config.ts` ainda documenta isso).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';

vi.mock('../observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const persistQueuePause = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/queue-state.js', () => ({ persistQueuePause }));

const sendAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../observability/alerts.js', () => ({ sendAlert }));

const { pauseQueueFor } = await import('./scrape-search.job.js');

function fakeQueue(initiallyPaused: boolean) {
  let paused = initiallyPaused;
  return {
    isPaused: vi.fn(async () => paused),
    pause: vi.fn(async () => {
      paused = true;
    }),
  } as unknown as Queue;
}

describe('pauseQueueFor (transição de alerta)', () => {
  beforeEach(() => {
    sendAlert.mockClear();
    persistQueuePause.mockClear();
  });

  it('fila estava rodando -> pausa agora: alerta UMA vez', async () => {
    const queue = fakeQueue(false);

    await pauseQueueFor(queue, 60_000, 'RATE_LIMITED', 'rate limited', 'high');

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith({
      kind: 'queue_paused',
      code: 'RATE_LIMITED',
      severity: 'high',
      message: 'rate limited',
      reason: 'scrape_error',
    });
  });

  it('fila JÁ estava pausada: não realerta', async () => {
    const queue = fakeQueue(true);

    await pauseQueueFor(queue, 60_000, 'RATE_LIMITED', 'rate limited de novo', 'high');

    expect(sendAlert).not.toHaveBeenCalled();
    // Mesmo sem alertar, a metadata é regravada (motivo pode ter mudado) —
    // só o alerta é que respeita a transição.
    expect(persistQueuePause).toHaveBeenCalledTimes(1);
  });
});
