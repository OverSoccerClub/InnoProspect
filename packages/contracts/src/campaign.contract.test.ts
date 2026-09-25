/**
 * campaign.contract.test.ts — 🆕 Fase 4.F.4 (ARQUITETURA §6.8.10/A32):
 * `sendWindowSchema.daysOfWeek` recusa 0 (domingo) e 6 (sábado) — antes desta
 * rodada aceitava 0..6, e uma campanha criada com `[0,6]` produzia uma
 * interseção VAZIA contra o piso seg-sex (`resolveCampaignWindow`,
 * `@inno/core`) e nunca enviava, sem explicação nenhuma na tela.
 */
import { describe, expect, it } from 'vitest';
import { sendWindowSchema } from './campaign.contract.js';

describe('sendWindowSchema.daysOfWeek', () => {
  it('aceita dias úteis (1..5)', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] });
    expect(result.success).toBe(true);
  });

  it('aceita um subconjunto de dias úteis', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [2, 4] });
    expect(result.success).toBe(true);
  });

  it('recusa domingo (0)', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [0, 1, 2] });
    expect(result.success).toBe(false);
  });

  it('recusa sábado (6)', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [5, 6] });
    expect(result.success).toBe(false);
  });

  it('recusa [0,6] — o caso real que produzia interseção vazia e campanha que nunca envia', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [0, 6] });
    expect(result.success).toBe(false);
  });

  it('recusa array vazio', () => {
    const result = sendWindowSchema.safeParse({ startHour: 9, endHour: 18, daysOfWeek: [] });
    expect(result.success).toBe(false);
  });
});
