import { describe, expect, it } from 'vitest';
import { deriveInstanceHealth } from './health.js';

describe('deriveInstanceHealth', () => {
  it('banned sempre vira blocked, mesmo se isDegraded for false', () => {
    expect(deriveInstanceHealth({ status: 'banned', isDegraded: false, warmupDay: 30 })).toBe('blocked');
  });

  it('isDegraded tem prioridade sobre o cálculo de warmup', () => {
    expect(deriveInstanceHealth({ status: 'connected', isDegraded: true, warmupDay: 30 })).toBe('degraded');
  });

  it('connected + aquecida (dia >= 22) vira ok', () => {
    expect(deriveInstanceHealth({ status: 'connected', isDegraded: false, warmupDay: 22 })).toBe('ok');
  });

  it('connected + ainda esquentando vira warming', () => {
    expect(deriveInstanceHealth({ status: 'connected', isDegraded: false, warmupDay: 5 })).toBe('warming');
  });

  it('não conectada e não banida vira warming', () => {
    expect(deriveInstanceHealth({ status: 'disconnected', isDegraded: false, warmupDay: 1 })).toBe('warming');
    expect(deriveInstanceHealth({ status: 'qr_pending', isDegraded: false, warmupDay: 1 })).toBe('warming');
    expect(deriveInstanceHealth({ status: 'connecting', isDegraded: false, warmupDay: 1 })).toBe('warming');
  });
});
