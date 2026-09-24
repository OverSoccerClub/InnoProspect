import { describe, expect, it } from 'vitest';

import { computeCampaignEstimate } from './campaign-estimate';

describe('computeCampaignEstimate', () => {
  it('divide elegíveis pela soma da cota diária das instâncias, arredondando para cima', () => {
    const estimate = computeCampaignEstimate(101, [{ dailyLimit: 20 }, { dailyLimit: 30 }]);
    expect(estimate.messagesPerDay).toBe(50);
    expect(estimate.days).toBe(3); // ceil(101/50)
  });

  it('0 elegíveis: 0 dias, sem dividir por zero', () => {
    const estimate = computeCampaignEstimate(0, [{ dailyLimit: 20 }]);
    expect(estimate.days).toBe(0);
  });

  it('nenhuma instância (ou cota zerada): 0 dias, sem dividir por zero', () => {
    const estimate = computeCampaignEstimate(50, []);
    expect(estimate.days).toBe(0);
    expect(estimate.messagesPerDay).toBe(0);
  });

  it('finishesAround pula domingo', () => {
    // 2026-09-19 é um sábado. +1 dia útil deveria pular o domingo 20 e cair na segunda 21.
    const saturday = new Date('2026-09-19T10:00:00.000Z');
    const estimate = computeCampaignEstimate(10, [{ dailyLimit: 10 }], saturday);
    expect(estimate.days).toBe(1);
    expect(new Date(estimate.finishesAround).getUTCDay()).toBe(1); // segunda-feira
  });
});
