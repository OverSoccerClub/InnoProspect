import { describe, expect, it } from 'vitest';
import { MessagingError, MESSAGING_ERROR_POLICY, applyJitter, backoffForAttempt, sleep } from './errors.js';

describe('MessagingError', () => {
  it('retryable é true só para TRANSIENT_ERROR, TIMEOUT e RATE_LIMITED', () => {
    expect(new MessagingError('TRANSIENT_ERROR', 'x').retryable).toBe(true);
    expect(new MessagingError('TIMEOUT', 'x').retryable).toBe(true);
    expect(new MessagingError('RATE_LIMITED', 'x').retryable).toBe(true);
    expect(new MessagingError('INSTANCE_DISCONNECTED', 'x').retryable).toBe(false);
    expect(new MessagingError('INSTANCE_NOT_FOUND', 'x').retryable).toBe(false);
    expect(new MessagingError('INVALID_NUMBER', 'x').retryable).toBe(false);
    expect(new MessagingError('AUTH_ERROR', 'x').retryable).toBe(false);
    expect(new MessagingError('VALIDATION_ERROR', 'x').retryable).toBe(false);
    expect(new MessagingError('UNKNOWN', 'x').retryable).toBe(false);
  });

  it('carrega code, status e cause', () => {
    const cause = new Error('original');
    const err = new MessagingError('TRANSIENT_ERROR', 'falhou', { cause, status: 503 });
    expect(err.code).toBe('TRANSIENT_ERROR');
    expect(err.status).toBe(503);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('MessagingError');
  });
});

describe('MESSAGING_ERROR_POLICY', () => {
  it('RATE_LIMITED nunca tem retry automático de transporte (0 tentativas), mesmo sendo retryable de negócio', () => {
    expect(MESSAGING_ERROR_POLICY.RATE_LIMITED.maxAttempts).toBe(0);
    expect(new MessagingError('RATE_LIMITED', 'x').retryable).toBe(true);
  });

  it('nenhum código de erro 4xx "permanente" tem retry de transporte', () => {
    for (const code of ['INSTANCE_DISCONNECTED', 'INSTANCE_NOT_FOUND', 'INVALID_NUMBER', 'AUTH_ERROR', 'VALIDATION_ERROR'] as const) {
      expect(MESSAGING_ERROR_POLICY[code].maxAttempts).toBe(0);
    }
  });

  it('TRANSIENT_ERROR e TIMEOUT têm retry de transporte', () => {
    expect(MESSAGING_ERROR_POLICY.TRANSIENT_ERROR.maxAttempts).toBeGreaterThan(0);
    expect(MESSAGING_ERROR_POLICY.TIMEOUT.maxAttempts).toBeGreaterThan(0);
  });
});

describe('applyJitter', () => {
  it('mantém o resultado dentro de ±ratio do valor base', () => {
    for (let i = 0; i < 50; i++) {
      const jittered = applyJitter(1000, 0.2);
      expect(jittered).toBeGreaterThanOrEqual(800);
      expect(jittered).toBeLessThanOrEqual(1200);
    }
  });

  it('não jitteriza valores <= 0', () => {
    expect(applyJitter(0)).toBe(0);
  });
});

describe('backoffForAttempt', () => {
  it('cresce com o número da tentativa, dentro da tabela de TRANSIENT_ERROR', () => {
    const first = backoffForAttempt('TRANSIENT_ERROR', 0);
    const second = backoffForAttempt('TRANSIENT_ERROR', 1);
    expect(first).toBeLessThan(second);
  });

  it('RATE_LIMITED (sem backoff de transporte configurado) devolve 0', () => {
    expect(backoffForAttempt('RATE_LIMITED', 0)).toBe(0);
  });
});

describe('sleep', () => {
  it('resolve imediatamente para ms <= 0', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-10)).resolves.toBeUndefined();
  });
});
