import { describe, expect, it } from 'vitest';

import { getStatusFreshnessLevel, STATUS_FRESHNESS_STALE_MS } from './whatsapp-freshness';

describe('getStatusFreshnessLevel', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');

  it('devolve "unknown" quando nunca foi confirmado (null)', () => {
    expect(getStatusFreshnessLevel(null, now)).toBe('unknown');
  });

  it('devolve "unknown" para uma data que não parseia', () => {
    expect(getStatusFreshnessLevel('não é uma data', now)).toBe('unknown');
  });

  it('devolve "fresh" logo após a confirmação', () => {
    const checkedAt = new Date(now - 15_000).toISOString();
    expect(getStatusFreshnessLevel(checkedAt, now)).toBe('fresh');
  });

  it('devolve "fresh" bem no limiar (1ms antes de estourar)', () => {
    const checkedAt = new Date(now - (STATUS_FRESHNESS_STALE_MS - 1)).toISOString();
    expect(getStatusFreshnessLevel(checkedAt, now)).toBe('fresh');
  });

  it('devolve "stale" exatamente no limiar', () => {
    const checkedAt = new Date(now - STATUS_FRESHNESS_STALE_MS).toISOString();
    expect(getStatusFreshnessLevel(checkedAt, now)).toBe('stale');
  });

  it('devolve "stale" bem depois do limiar', () => {
    const checkedAt = new Date(now - 90 * 60_000).toISOString();
    expect(getStatusFreshnessLevel(checkedAt, now)).toBe('stale');
  });
});
