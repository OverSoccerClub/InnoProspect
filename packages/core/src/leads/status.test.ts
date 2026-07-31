import { describe, expect, it } from 'vitest';
import { checkStatusTransition } from './status.js';

describe('checkStatusTransition', () => {
  it('permite a sequência linear do funil (via ator sistema, já que contacted/responded são dele)', () => {
    expect(checkStatusTransition('new', 'validated', 'human')).toEqual({ allowed: true });
    expect(checkStatusTransition('validated', 'contacted', 'system')).toEqual({ allowed: true });
    expect(checkStatusTransition('contacted', 'responded', 'system')).toEqual({ allowed: true });
    expect(checkStatusTransition('responded', 'negotiating', 'human')).toEqual({ allowed: true });
    expect(checkStatusTransition('negotiating', 'won', 'human')).toEqual({ allowed: true });
  });

  it('rejeita pular etapas (new -> won)', () => {
    const result = checkStatusTransition('new', 'won');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("não é possível ir de 'new' para 'won'");
  });

  it('rejeita retroceder no funil', () => {
    const result = checkStatusTransition('negotiating', 'validated');
    expect(result.allowed).toBe(false);
  });

  it('permite ir para discarded de qualquer estado', () => {
    expect(checkStatusTransition('new', 'discarded').allowed).toBe(true);
    expect(checkStatusTransition('negotiating', 'discarded').allowed).toBe(true);
    expect(checkStatusTransition('won', 'discarded').allowed).toBe(true);
  });

  it('rejeita sair de discarded (estado terminal)', () => {
    const result = checkStatusTransition('discarded', 'new');
    expect(result.allowed).toBe(false);
  });

  it('rejeita transição para o mesmo estado', () => {
    const result = checkStatusTransition('validated', 'validated');
    expect(result.allowed).toBe(false);
  });

  it('bloqueia um humano tentando setar "contacted" ou "responded" manualmente', () => {
    const contacted = checkStatusTransition('validated', 'contacted', 'human');
    expect(contacted.allowed).toBe(false);
    if (!contacted.allowed) expect(contacted.reason).toMatch(/sistema/);

    const responded = checkStatusTransition('contacted', 'responded', 'human');
    expect(responded.allowed).toBe(false);
  });
});
