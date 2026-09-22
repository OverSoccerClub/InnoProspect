/**
 * rate-limit.test.ts — primeiro teste deste arquivo (existia sem cobertura
 * desde a Fase 1). Cobre `checkRateLimit` (janela fixa, incrementa) e as
 * duas primitivas novas da Onda 2 (`peekRateLimit`/`resetRateLimit`, achado
 * do Atlas: `lib/auth.ts` precisa contar só FALHAS de login, não sucessos).
 * `vi.useFakeTimers()` porque a janela é `Date.now()` — ver
 * [[bug-vitest-fake-timers-retry-backoff]] na memória.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, peekRateLimit, resetRateLimit } from './rate-limit';

const WINDOW_MS = 60_000;

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('permite até `max` chamadas na janela e bloqueia a seguinte', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit(key, WINDOW_MS, 3)).toEqual({ allowed: true });
    }
    const blocked = checkRateLimit(key, WINDOW_MS, 3);
    expect(blocked.allowed).toBe(false);
  });

  it('libera de novo depois que a janela expira', () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i += 1) checkRateLimit(key, WINDOW_MS, 3);
    expect(checkRateLimit(key, WINDOW_MS, 3).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-09-22T10:01:01Z'));
    expect(checkRateLimit(key, WINDOW_MS, 3)).toEqual({ allowed: true });
  });
});

describe('peekRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('chave nunca vista: sempre allowed, e NÃO cria bucket (não consome cota)', () => {
    const key = `test:${Math.random()}`;
    expect(peekRateLimit(key, 1)).toEqual({ allowed: true });
    expect(peekRateLimit(key, 1)).toEqual({ allowed: true });
    // Prova de que não criou bucket: uma chamada real ainda tem a cota inteira.
    expect(checkRateLimit(key, WINDOW_MS, 1)).toEqual({ allowed: true });
  });

  it('reflete o estado gravado por checkRateLimit, sem incrementar por conta própria', () => {
    const key = `test:${Math.random()}`;
    checkRateLimit(key, WINDOW_MS, 2); // count = 1

    expect(peekRateLimit(key, 2)).toEqual({ allowed: true });
    expect(peekRateLimit(key, 2)).toEqual({ allowed: true }); // chamar várias vezes não muda nada
    expect(peekRateLimit(key, 2)).toEqual({ allowed: true });

    checkRateLimit(key, WINDOW_MS, 2); // count = 2 (no limite)
    const blocked = peekRateLimit(key, 2);
    expect(blocked.allowed).toBe(false);
  });

  it('bucket expirado é tratado como livre (allowed), sem precisar de checkRateLimit primeiro', () => {
    const key = `test:${Math.random()}`;
    checkRateLimit(key, WINDOW_MS, 1);
    expect(peekRateLimit(key, 1).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-09-22T10:01:01Z'));
    expect(peekRateLimit(key, 1)).toEqual({ allowed: true });
  });
});

describe('resetRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('zera a cota da chave — próxima chamada volta a ter a janela cheia', () => {
    const key = `test:${Math.random()}`;
    checkRateLimit(key, WINDOW_MS, 1);
    expect(peekRateLimit(key, 1).allowed).toBe(false);

    resetRateLimit(key);

    expect(peekRateLimit(key, 1)).toEqual({ allowed: true });
    expect(checkRateLimit(key, WINDOW_MS, 1)).toEqual({ allowed: true });
  });

  it('resetar uma chave não afeta outras chaves (isolamento por chave)', () => {
    const keyA = `test:a:${Math.random()}`;
    const keyB = `test:b:${Math.random()}`;
    checkRateLimit(keyA, WINDOW_MS, 1);
    checkRateLimit(keyB, WINDOW_MS, 1);

    resetRateLimit(keyA);

    expect(peekRateLimit(keyA, 1).allowed).toBe(true);
    expect(peekRateLimit(keyB, 1).allowed).toBe(false);
  });

  it('resetar uma chave que nunca existiu não lança', () => {
    expect(() => resetRateLimit(`test:nunca-existiu:${Math.random()}`)).not.toThrow();
  });
});
