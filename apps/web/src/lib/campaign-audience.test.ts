import { describe, expect, it } from 'vitest';

import { computeCampaignAudience } from './campaign-audience';
import type { LeadListItem } from '@/types/lead';

function makeLead(overrides: Partial<LeadListItem> = {}): LeadListItem {
  return {
    id: overrides.id ?? `lead_${Math.random()}`,
    name: 'Empresa Teste',
    phoneE164: '+5511999990000',
    phoneType: 'mobile',
    address: null,
    city: 'São Paulo',
    uf: 'SP',
    website: null,
    category: 'Restaurante',
    rating: null,
    reviewCount: null,
    status: 'new',
    tags: [],
    isOptedOut: false,
    lastContactedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    searchJobId: 'search_demo',
    searchNiche: 'restaurante',
    offNiche: false,
    ...overrides,
  } as LeadListItem;
}

describe('computeCampaignAudience', () => {
  it('todos elegíveis: totalMatched === eligible e nenhuma exclusão', () => {
    const leads = [makeLead({ id: 'a' }), makeLead({ id: 'b', phoneE164: '+5511999990001' })];
    const { summary, eligibleLeads } = computeCampaignAudience({ leads });

    expect(summary.totalMatched).toBe(2);
    expect(summary.eligible).toBe(2);
    expect(summary.excluded).toEqual({
      optedOut: 0,
      landline: 0,
      noPhone: 0,
      recentlyContacted: 0,
      duplicatePhone: 0,
      alreadyTargeted: 0,
    });
    expect(eligibleLeads).toHaveLength(2);
  });

  it('exclui sem telefone', () => {
    const { summary } = computeCampaignAudience({ leads: [makeLead({ phoneE164: null })] });
    expect(summary.eligible).toBe(0);
    expect(summary.excluded.noPhone).toBe(1);
  });

  it('exclui telefone fixo', () => {
    const { summary } = computeCampaignAudience({ leads: [makeLead({ phoneType: 'landline' })] });
    expect(summary.excluded.landline).toBe(1);
  });

  it('exclui já descadastrado', () => {
    const { summary } = computeCampaignAudience({ leads: [makeLead({ isOptedOut: true })] });
    expect(summary.excluded.optedOut).toBe(1);
  });

  it('exclui telefone duplicado, mantendo o primeiro (mais antigo) da lista', () => {
    const leads = [
      makeLead({ id: 'first', phoneE164: '+5511999990000' }),
      makeLead({ id: 'second', phoneE164: '+5511999990000' }),
    ];
    const { summary, eligibleLeads } = computeCampaignAudience({ leads });
    expect(summary.excluded.duplicatePhone).toBe(1);
    expect(summary.eligible).toBe(1);
    expect(eligibleLeads[0]?.id).toBe('first');
  });

  it('exclui contatado dentro da janela de skipRecentlyContactedDays', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    const lead = makeLead({ lastContactedAt: new Date('2026-09-20T12:00:00.000Z').toISOString() });
    const { summary } = computeCampaignAudience({ leads: [lead], skipRecentlyContactedDays: 30, now });
    expect(summary.excluded.recentlyContacted).toBe(1);
  });

  it('NÃO exclui contato fora da janela (mais antigo que skipRecentlyContactedDays)', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    const lead = makeLead({ lastContactedAt: new Date('2026-08-01T12:00:00.000Z').toISOString() });
    const { summary } = computeCampaignAudience({ leads: [lead], skipRecentlyContactedDays: 30, now });
    expect(summary.excluded.recentlyContacted).toBe(0);
    expect(summary.eligible).toBe(1);
  });

  it('cada lead conta em UM motivo só — o primeiro que casa (opt-out por fixo E descadastrado conta só em landline)', () => {
    const lead = makeLead({ phoneType: 'landline', isOptedOut: true });
    const { summary } = computeCampaignAudience({ leads: [lead] });
    expect(summary.excluded.landline).toBe(1);
    expect(summary.excluded.optedOut).toBe(0);
  });

  it('invariante: totalMatched === eligible + soma(excluded.*)', () => {
    const leads = [
      makeLead({ id: '1' }),
      makeLead({ id: '2', phoneE164: null }),
      makeLead({ id: '3', phoneType: 'landline' }),
      makeLead({ id: '4', isOptedOut: true }),
      makeLead({ id: '5', phoneE164: '+5511999990009' }),
      makeLead({ id: '6', phoneE164: '+5511999990009' }),
    ];
    const { summary } = computeCampaignAudience({ leads });
    const excludedSum = Object.values(summary.excluded).reduce((a, b) => a + b, 0);
    expect(summary.eligible + excludedSum).toBe(summary.totalMatched);
  });

  it('alreadyTargeted fica sempre 0 neste preview client-side (limitação documentada — depende de outras campanhas no Postgres)', () => {
    const { summary } = computeCampaignAudience({ leads: [makeLead()] });
    expect(summary.excluded.alreadyTargeted).toBe(0);
  });

  it('lista vazia: eligible 0, nenhuma exclusão, sem erro', () => {
    const { summary, eligibleLeads } = computeCampaignAudience({ leads: [] });
    expect(summary.totalMatched).toBe(0);
    expect(summary.eligible).toBe(0);
    expect(eligibleLeads).toHaveLength(0);
  });
});
