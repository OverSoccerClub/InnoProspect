import { describe, expect, it } from 'vitest';
import { resolveDispatchConfig } from './dispatch-config.js';

describe('resolveDispatchConfig', () => {
  it('defaults quando a env está vazia', () => {
    const config = resolveDispatchConfig({});
    expect(config).toEqual({
      tickIntervalMs: 15_000,
      leaseSeconds: 120,
      maxAttempts: 3,
      uncertainDegradeAt: 3,
      uncertainHaltAt: 5,
      duplicateWindowMs: 60_000,
      coldFollowupCooldownMs: 24 * 60 * 60 * 1000,
    });
  });

  it('lê valores customizados da env', () => {
    const config = resolveDispatchConfig({
      DISPATCH_TICK_INTERVAL_S: '30',
      DISPATCH_LEASE_S: '60',
      DISPATCH_MAX_ATTEMPTS: '5',
      DISPATCH_UNCERTAIN_DEGRADE_AT: '2',
      DISPATCH_UNCERTAIN_HALT_AT: '4',
      MANUAL_SEND_DUPLICATE_WINDOW_S: '30',
      COLD_FOLLOWUP_COOLDOWN_H: '12',
    });
    expect(config).toEqual({
      tickIntervalMs: 30_000,
      leaseSeconds: 60,
      maxAttempts: 5,
      uncertainDegradeAt: 2,
      uncertainHaltAt: 4,
      duplicateWindowMs: 30_000,
      coldFollowupCooldownMs: 12 * 60 * 60 * 1000,
    });
  });

  it('valores inválidos/negativos caem no default (nunca NaN, nunca zero/negativo)', () => {
    const config = resolveDispatchConfig({
      DISPATCH_TICK_INTERVAL_S: 'abc',
      DISPATCH_LEASE_S: '-10',
      DISPATCH_MAX_ATTEMPTS: '0',
    });
    expect(config.tickIntervalMs).toBe(15_000);
    expect(config.leaseSeconds).toBe(120);
    expect(config.maxAttempts).toBe(3);
  });
});
