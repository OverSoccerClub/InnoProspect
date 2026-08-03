/**
 * optouts.test.ts — REVISAO-QA.md §4 prioridade #3: "a tabela mais
 * importante do sistema em termos de risco" (palavras do próprio Vega no
 * cabeçalho de `optouts.ts`) — zero teste antes desta rodada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPublicOptOutToken } from '@inno/core';
import type { CreateOptOutBody } from '@inno/contracts';
import { getFakeDbState, resetFakeDb, type FakeCampaign, type FakeCampaignTarget, type FakeLead } from '@/test/fake-db';

// `import()` dinâmico DENTRO da factory, de propósito — ver comentário
// equivalente em `webhook.test.ts` (evita "Cannot access '...' before
// initialization" do hoisting do `vi.mock`).
vi.mock('@inno/db', async () => {
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { prisma: fakePrismaClient };
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const { createOptOut, deleteOptOut, publicOptOut } = await import('./optouts');

const SECRET = 'test-optout-secret-nao-usar-em-prod';

function lead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id' | 'phoneE164' | 'status'>): FakeLead {
  return { lastSeenAt: new Date(), ...overrides };
}
function target(overrides: Partial<FakeCampaignTarget> & Pick<FakeCampaignTarget, 'id' | 'campaignId' | 'leadId' | 'phoneE164' | 'status'>): FakeCampaignTarget {
  return { skipReason: null, sentAt: null, updatedAt: new Date(), ...overrides };
}
function campaign(overrides: Partial<FakeCampaign> & Pick<FakeCampaign, 'id'>): FakeCampaign {
  return {
    status: 'running',
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    respondedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    haltReason: null,
    instanceIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
  process.env.OPTOUT_TOKEN_SECRET = SECRET;
});

describe('createOptOut', () => {
  it('cria o opt-out e marca os CampaignTarget PENDING do mesmo telefone como skipped, na MESMA transação', async () => {
    resetFakeDb({
      leads: [lead({ id: 'lead-1', phoneE164: '+5511987654321', status: 'contacted' })],
      campaignTargets: [
        target({ id: 'ct-1', campaignId: 'camp-1', leadId: 'lead-1', phoneE164: '+5511987654321', status: 'pending' }),
        target({ id: 'ct-2', campaignId: 'camp-1', leadId: 'lead-1', phoneE164: '+5511987654321', status: 'sent' }),
      ],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })],
    });
    const body: CreateOptOutBody = { phoneE164: '+5511987654321', source: 'manual', reason: 'pediu por telefone' };

    const result = await createOptOut(body, 'user-1');

    expect(result.affectedTargets).toBe(1); // só o pending
    const state = getFakeDbState();
    expect(state.optOuts).toHaveLength(1);
    expect(state.campaignTargets.find((t) => t.id === 'ct-1')?.status).toBe('skipped');
    expect(state.campaignTargets.find((t) => t.id === 'ct-2')?.status).toBe('sent'); // intocado
    expect(state.campaigns[0]!.skippedCount).toBe(1);
    expect(state.leadActivities).toHaveLength(1);
    expect(state.leadActivities[0]!.type).toBe('opt_out');
  });

  it('devolve 409 se o telefone já estiver na lista de opt-out — e não duplica nem toca CampaignTarget', async () => {
    resetFakeDb({
      optOuts: [{ id: 'existing', phoneE164: '+5511987654321', source: 'manual', leadId: null, reason: null, createdAt: new Date() }],
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', leadId: null, phoneE164: '+5511987654321', status: 'pending' })],
    });

    await expect(createOptOut({ phoneE164: '+5511987654321', source: 'manual' }, 'user-1')).rejects.toMatchObject({ code: 'CONFLICT' });

    const state = getFakeDbState();
    expect(state.optOuts).toHaveLength(1); // não duplicou
    expect(state.campaignTargets[0]!.status).toBe('pending'); // não tocou (rejeitou antes da transação)
  });

  it('funciona sem nenhum Lead correspondente ao telefone (opt-out é por telefone, não depende de Lead)', async () => {
    resetFakeDb();

    const result = await createOptOut({ phoneE164: '+5511900000000', source: 'request' }, 'user-1');

    expect(result.phoneE164).toBe('+5511900000000');
    expect(result.affectedTargets).toBe(0);
    expect(getFakeDbState().leadActivities).toHaveLength(0); // sem lead, sem auditoria na timeline dele
  });
});

describe('deleteOptOut', () => {
  it('exige role=admin — operador comum recebe 403 e o registro NÃO é apagado', async () => {
    resetFakeDb({ optOuts: [{ id: 'opt-1', phoneE164: '+5511987654321', source: 'manual', leadId: null, reason: null, createdAt: new Date() }] });

    await expect(deleteOptOut('opt-1', { id: 'user-1', role: 'operator' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getFakeDbState().optOuts).toHaveLength(1);
  });

  it('admin remove o opt-out e registra auditoria na timeline do lead vinculado', async () => {
    resetFakeDb({ optOuts: [{ id: 'opt-1', phoneE164: '+5511987654321', source: 'manual', leadId: 'lead-1', reason: null, createdAt: new Date() }] });

    await deleteOptOut('opt-1', { id: 'admin-1', role: 'admin' });

    expect(getFakeDbState().optOuts).toHaveLength(0);
    expect(getFakeDbState().leadActivities[0]!.type).toBe('opt_out_removed');
  });

  it('id inexistente devolve 404', async () => {
    resetFakeDb();
    await expect(deleteOptOut('nao-existe', { id: 'admin-1', role: 'admin' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('publicOptOut', () => {
  it('é idempotente: dois cliques no mesmo link SEMPRE devolvem sucesso — nunca 409 (diferente do opt-out manual, de propósito)', async () => {
    resetFakeDb();
    const token = buildPublicOptOutToken('+5511987654321', { secret: SECRET });

    const first = await publicOptOut(token);
    const second = await publicOptOut(token);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(getFakeDbState().optOuts).toHaveLength(1); // não duplicou
  });

  it('token forjado/malformado devolve erro de validação, não uma exceção genérica', async () => {
    await expect(publicOptOut('token-forjado-invalido')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(getFakeDbState().optOuts).toHaveLength(0);
  });

  it('regressão-alvo: o MESMO telefone coletado como dois Lead diferentes aparece descadastrado nos dois, via efeito retroativo por telefone', async () => {
    resetFakeDb({
      leads: [
        lead({ id: 'lead-a', phoneE164: '+5511987654321', status: 'new' }),
        lead({ id: 'lead-b', phoneE164: '+5511987654321', status: 'new' }), // mesmo telefone, Lead diferente (ex.: rede com número central)
      ],
      campaignTargets: [
        target({ id: 'ct-a', campaignId: 'camp-1', leadId: 'lead-a', phoneE164: '+5511987654321', status: 'pending' }),
        target({ id: 'ct-b', campaignId: 'camp-2', leadId: 'lead-b', phoneE164: '+5511987654321', status: 'pending' }),
      ],
      campaigns: [campaign({ id: 'camp-1' }), campaign({ id: 'camp-2' })],
    });
    const token = buildPublicOptOutToken('+5511987654321', { secret: SECRET });

    await publicOptOut(token);

    const state = getFakeDbState();
    // A chave do efeito retroativo é o TELEFONE, não o Lead — os dois alvos
    // pendentes (de campanhas/leads diferentes) precisam ficar skipped.
    expect(state.campaignTargets.find((t) => t.id === 'ct-a')?.status).toBe('skipped');
    expect(state.campaignTargets.find((t) => t.id === 'ct-b')?.status).toBe('skipped');
    expect(state.campaigns.find((c) => c.id === 'camp-1')?.skippedCount).toBe(1);
    expect(state.campaigns.find((c) => c.id === 'camp-2')?.skippedCount).toBe(1);
  });

  it('OPTOUT_TOKEN_SECRET ausente devolve erro genérico ao titular, sem vazar detalhe interno', async () => {
    delete process.env.OPTOUT_TOKEN_SECRET;
    const token = buildPublicOptOutToken('+5511987654321', { secret: SECRET });

    await expect(publicOptOut(token)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
