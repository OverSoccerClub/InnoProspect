import { describe, expect, it } from 'vitest';

import { DISPATCH_HEARTBEAT_LAGGING_MS, getDispatchHeartbeatLevel } from './dispatch-heartbeat';

describe('getDispatchHeartbeatLevel', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z');

  it('devolve "dead" quando nunca houve heartbeat (null)', () => {
    expect(getDispatchHeartbeatLevel(null, now)).toBe('dead');
  });

  it('devolve "dead" para uma data que não parseia', () => {
    expect(getDispatchHeartbeatLevel('não é uma data', now)).toBe('dead');
  });

  it('devolve "alive" logo após um tick', () => {
    const lastTickAt = new Date(now - 1_000).toISOString();
    expect(getDispatchHeartbeatLevel(lastTickAt, now)).toBe('alive');
  });

  it('devolve "alive" bem no limiar (1ms antes de estourar)', () => {
    const lastTickAt = new Date(now - (DISPATCH_HEARTBEAT_LAGGING_MS - 1)).toISOString();
    expect(getDispatchHeartbeatLevel(lastTickAt, now)).toBe('alive');
  });

  it('devolve "lagging" exatamente no limiar', () => {
    const lastTickAt = new Date(now - DISPATCH_HEARTBEAT_LAGGING_MS).toISOString();
    expect(getDispatchHeartbeatLevel(lastTickAt, now)).toBe('lagging');
  });

  it('devolve "lagging" bem depois do limiar', () => {
    const lastTickAt = new Date(now - 5 * 60_000).toISOString();
    expect(getDispatchHeartbeatLevel(lastTickAt, now)).toBe('lagging');
  });

  it('devolve "alive" se o timestamp está no futuro (relógio do cliente atrasado)', () => {
    const lastTickAt = new Date(now + 2_000).toISOString();
    expect(getDispatchHeartbeatLevel(lastTickAt, now)).toBe('alive');
  });
});
