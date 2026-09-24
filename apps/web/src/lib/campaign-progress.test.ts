import { describe, expect, it } from 'vitest';

import { computeCampaignProgressSegments, deriveCampaignRates, deriveCampaignStats } from './campaign-progress';
import type { CampaignTargetItem, CampaignTargetStatus } from '@/types/campaign';

function makeTarget(status: CampaignTargetStatus, id = `t_${Math.random()}`): CampaignTargetItem {
  return {
    id,
    leadId: id,
    leadName: 'Empresa Teste',
    phoneE164: '+5511999990000',
    status,
    skipReason: null,
    attempt: status === 'pending' ? 0 : 1,
    scheduledFor: null,
    sentAt: null,
    messagePreview: null,
  };
}

describe('deriveCampaignStats', () => {
  it('conta cada alvo nos contadores de funil que ele já alcançou', () => {
    const targets = [makeTarget('pending'), makeTarget('sent'), makeTarget('delivered'), makeTarget('responded')];
    const stats = deriveCampaignStats(targets);

    expect(stats.total).toBe(4);
    expect(stats.pending).toBe(1);
    // sent, delivered e responded todos JÁ passaram por 'sent'.
    expect(stats.sent).toBe(3);
    // delivered e responded já passaram por 'delivered'.
    expect(stats.delivered).toBe(2);
    expect(stats.responded).toBe(1);
  });

  it('failed e skipped são absorventes — não incrementam sent/delivered', () => {
    const targets = [makeTarget('failed'), makeTarget('skipped')];
    const stats = deriveCampaignStats(targets);
    expect(stats.failed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.sent).toBe(0);
  });

  it('lista vazia não quebra', () => {
    const stats = deriveCampaignStats([]);
    expect(stats.total).toBe(0);
  });
});

describe('deriveCampaignRates', () => {
  it('0 quando nada foi enviado ainda (evita divisão por zero)', () => {
    const stats = deriveCampaignStats([makeTarget('pending')]);
    expect(deriveCampaignRates(stats)).toEqual({ deliveryRate: 0, responseRate: 0 });
  });

  it('calcula deliveryRate e responseRate sobre sentCount', () => {
    // 4 sent no total (via funil): 2 delivered, 1 responded (que também é delivered).
    const targets = [makeTarget('sent'), makeTarget('sent'), makeTarget('delivered'), makeTarget('responded')];
    const stats = deriveCampaignStats(targets);
    const rates = deriveCampaignRates(stats);
    expect(rates.deliveryRate).toBeCloseTo(2 / 4);
    expect(rates.responseRate).toBeCloseTo(1 / 4);
  });
});

describe('computeCampaignProgressSegments', () => {
  it('segmentos somam no máximo 100% e nunca contradizem os stats', () => {
    const targets = [
      makeTarget('pending'),
      makeTarget('sent'),
      makeTarget('delivered'),
      makeTarget('failed'),
      makeTarget('skipped'),
    ];
    const stats = deriveCampaignStats(targets);
    const segments = computeCampaignProgressSegments(stats);
    const sum = segments.succeededPercent + segments.inFlightPercent + segments.failedPercent + segments.skippedPercent + segments.pendingPercent;
    expect(sum).toBeCloseTo(100);
  });

  it('total 0 devolve todos os segmentos em 0, sem NaN', () => {
    const segments = computeCampaignProgressSegments(deriveCampaignStats([]));
    expect(Object.values(segments).every((v) => v === 0)).toBe(true);
  });
});
