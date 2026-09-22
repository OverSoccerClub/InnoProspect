import { describe, expect, it } from 'vitest';

import { evaluateSendWindow } from './send-window';

/** Terça-feira, 2026-09-22 (ver ARQUITETURA.md §4.9.6 para os limiares). */
function tue(hour: number, minute = 0): Date {
  return new Date(2026, 8, 22, hour, minute, 0, 0);
}
function sat(hour: number): Date {
  return new Date(2026, 8, 26, hour, 0, 0, 0);
}
function sun(hour: number): Date {
  return new Date(2026, 8, 27, hour, 0, 0, 0);
}

describe('evaluateSendWindow', () => {
  it('permite dentro do comercial (10h de terça)', () => {
    expect(evaluateSendWindow(tue(10)).level).toBe('ok');
  });

  it('permite à tarde depois do almoço (14h de terça)', () => {
    expect(evaluateSendWindow(tue(14)).level).toBe('ok');
  });

  it('bloqueia (mole) na pausa de almoço (12h30 de terça)', () => {
    const verdict = evaluateSendWindow(tue(12, 30));
    expect(verdict.level).toBe('outside_business');
  });

  it('bloqueia (mole) fora do comercial mas dentro do piso (8h30 de terça)', () => {
    expect(evaluateSendWindow(tue(8, 30)).level).toBe('outside_business');
  });

  it('bloqueia (mole) à noite dentro do piso (19h de terça)', () => {
    expect(evaluateSendWindow(tue(19)).level).toBe('outside_business');
  });

  it('bloqueia (duro) fora do piso legal (21h30 de terça)', () => {
    expect(evaluateSendWindow(tue(21, 30)).level).toBe('quiet_hours');
  });

  it('bloqueia (duro) de madrugada (6h de terça)', () => {
    expect(evaluateSendWindow(tue(6)).level).toBe('quiet_hours');
  });

  it('bloqueia (mole) no sábado dentro do piso', () => {
    expect(evaluateSendWindow(sat(11)).level).toBe('outside_business');
  });

  it('bloqueia (duro) no domingo mesmo em horário comercial', () => {
    expect(evaluateSendWindow(sun(11)).level).toBe('quiet_hours');
  });

  it('calcula a próxima abertura quando bloqueado', () => {
    const verdict = evaluateSendWindow(tue(21, 30));
    if (verdict.level === 'ok') throw new Error('esperava bloqueio');
    expect(verdict.nextOpensAt.getTime()).toBeGreaterThan(tue(21, 30).getTime());
    expect(evaluateSendWindow(verdict.nextOpensAt).level).toBe('ok');
  });
});
