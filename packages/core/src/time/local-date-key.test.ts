import { describe, expect, it } from 'vitest';
import { localDateKey, localDateKeyString } from './local-date-key';

const TZ = 'America/Sao_Paulo';

describe('localDateKeyString', () => {
  it('devolve "YYYY-MM-DD" do dia civil em São Paulo, mesmo perto da virada UTC', () => {
    // 2026-09-22T02:30Z = 2026-09-21 23:30 em São Paulo (UTC-3) — ainda o dia 21.
    expect(localDateKeyString(new Date('2026-09-22T02:30:00.000Z'), TZ)).toBe('2026-09-21');
  });

  it('já virou o dia em São Paulo antes de virar em UTC (03:00Z = 00:00 local)', () => {
    expect(localDateKeyString(new Date('2026-09-22T03:00:00.000Z'), TZ)).toBe('2026-09-22');
  });

  it('respeita outro fuso (não fixa América/São Paulo no código)', () => {
    // 2026-09-22T01:00Z ainda é 2026-09-21 em UTC-3 (São Paulo), mas já é
    // 2026-09-22 em UTC+0 (Londres, aproximando sem DST para o teste).
    expect(localDateKeyString(new Date('2026-09-22T01:00:00.000Z'), 'UTC')).toBe('2026-09-22');
    expect(localDateKeyString(new Date('2026-09-22T01:00:00.000Z'), TZ)).toBe('2026-09-21');
  });
});

describe('localDateKey', () => {
  it('é meia-noite UTC do dia civil — mesma granularidade de InstanceDailyStat.date (@db.Date)', () => {
    const key = localDateKey(new Date('2026-09-22T02:30:00.000Z'), TZ);
    expect(key.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('dois instantes do mesmo dia civil produzem a MESMA chave (comparável por igualdade de tempo)', () => {
    const morning = localDateKey(new Date('2026-09-22T13:00:00.000Z'), TZ); // 10h local
    const night = localDateKey(new Date('2026-09-23T02:59:00.000Z'), TZ); // 23h59 local do mesmo dia 22
    expect(morning.getTime()).toBe(night.getTime());
  });

  it('vira ao cruzar a meia-noite local', () => {
    const beforeMidnight = localDateKey(new Date('2026-09-23T02:59:00.000Z'), TZ); // 23h59 do dia 22
    const afterMidnight = localDateKey(new Date('2026-09-23T03:00:00.000Z'), TZ); // 00h00 do dia 23
    expect(afterMidnight.getTime()).toBeGreaterThan(beforeMidnight.getTime());
  });
});
