import { describe, expect, it } from 'vitest';
import { monthsAgo } from './months-ago.js';

describe('monthsAgo', () => {
  it('subtrai meses corridos em UTC', () => {
    expect(monthsAgo(new Date('2026-09-26T12:00:00.000Z'), 24).toISOString()).toBe('2024-09-26T12:00:00.000Z');
    expect(monthsAgo(new Date('2026-09-26T12:00:00.000Z'), 12).toISOString()).toBe('2025-09-26T12:00:00.000Z');
  });

  it('0 meses devolve o mesmo instante (identidade)', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    expect(monthsAgo(now, 0).getTime()).toBe(now.getTime());
  });

  it('nunca muta o Date recebido', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    monthsAgo(now, 24);
    expect(now.toISOString()).toBe('2026-09-26T12:00:00.000Z');
  });

  it('dia inexistente no mês de destino ROLA para o mês seguinte (comportamento nativo do JS Date, não trava no último dia) — verificado, não assumido', () => {
    // 31/mar/2026 - 1 mês: fevereiro/2026 (não-bissexto) tem 28 dias.
    expect(monthsAgo(new Date('2026-03-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-03-03T00:00:00.000Z');
    // 31/mar/2028 - 1 mês: fevereiro/2028 É bissexto (29 dias) — 1 dia de excedente em vez de 2.
    expect(monthsAgo(new Date('2028-03-31T00:00:00.000Z'), 1).toISOString()).toBe('2028-03-02T00:00:00.000Z');
  });
});
