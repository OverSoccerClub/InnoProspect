import { describe, expect, it } from 'vitest';
import { ScrapeError, applyJitter, backoffForAttempt, randomDelay, SCRAPE_ERROR_POLICY } from './errors.js';

describe('ScrapeError', () => {
  it('retryable reflete SCRAPE_ERROR_POLICY.maxAttempts', () => {
    expect(new ScrapeError('NAVIGATION_TIMEOUT', 'x').retryable).toBe(true);
    expect(new ScrapeError('LAYOUT_CHANGED', 'x').retryable).toBe(false);
    expect(new ScrapeError('EMPTY_RESULTS', 'x').retryable).toBe(false);
  });

  it('carrega code e cause', () => {
    const cause = new Error('original');
    const err = new ScrapeError('BROWSER_CRASH', 'falhou', { cause });
    expect(err.code).toBe('BROWSER_CRASH');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('ScrapeError');
  });
});

describe('SCRAPE_ERROR_POLICY', () => {
  it('LAYOUT_CHANGED tem 0 tentativas e severidade critical (fatal, ARQUITETURA §5.6)', () => {
    expect(SCRAPE_ERROR_POLICY.LAYOUT_CHANGED.maxAttempts).toBe(0);
    expect(SCRAPE_ERROR_POLICY.LAYOUT_CHANGED.alarmSeverity).toBe('critical');
  });

  it('CAPTCHA_DETECTED pausa a fila e alarma high', () => {
    expect(SCRAPE_ERROR_POLICY.CAPTCHA_DETECTED.pauseQueueMs).toBeGreaterThan(0);
    expect(SCRAPE_ERROR_POLICY.CAPTCHA_DETECTED.alarmSeverity).toBe('high');
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

describe('randomDelay', () => {
  it('fica sempre dentro de [min, max]', () => {
    for (let i = 0; i < 50; i++) {
      const delay = randomDelay(8_000, 25_000);
      expect(delay).toBeGreaterThanOrEqual(8_000);
      expect(delay).toBeLessThanOrEqual(25_000);
    }
  });
});

describe('backoffForAttempt', () => {
  it('cresce com o número da tentativa, dentro da tabela de NAVIGATION_TIMEOUT', () => {
    const first = backoffForAttempt('NAVIGATION_TIMEOUT', 0);
    const second = backoffForAttempt('NAVIGATION_TIMEOUT', 1);
    const third = backoffForAttempt('NAVIGATION_TIMEOUT', 2);
    // Jitter é ±20%, então comparamos as faixas em vez de valores exatos.
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it('LAYOUT_CHANGED (sem backoff configurado) devolve 0', () => {
    expect(backoffForAttempt('LAYOUT_CHANGED', 0)).toBe(0);
  });
});
