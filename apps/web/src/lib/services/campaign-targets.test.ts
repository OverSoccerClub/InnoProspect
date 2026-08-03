/**
 * campaign-targets.test.ts — REVISAO-QA.md §4 prioridade #1: é o coração do
 * "contador de campanha dessincronizando do status" citado no pedido. Bug
 * aqui é SILENCIOSO por design (nenhuma exceção, só um `Int` errado no
 * Postgres) — por isso cada teste assere o CONTADOR da campanha, não só o
 * status do alvo.
 *
 * `advanceCampaignTargetStatus`/`skipPendingCampaignTargetsForPhone`/
 * `haltCampaignsSoleInstanceDisconnected` recebem `tx` como PARÂMETRO — fake
 * object manual (REVISAO-QA.md §3), sem dependência nova.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@inno/db';
import {
  advanceCampaignTargetStatus,
  haltCampaignsSoleInstanceDisconnected,
  skipPendingCampaignTargetsForPhone,
} from './campaign-targets';
import { fakePrismaClient, getFakeDbState, resetFakeDb, type FakeCampaign, type FakeCampaignTarget } from '@/test/fake-db';

const tx = fakePrismaClient as unknown as Prisma.TransactionClient;

function target(overrides: Partial<FakeCampaignTarget> & Pick<FakeCampaignTarget, 'id' | 'campaignId' | 'phoneE164' | 'status'>): FakeCampaignTarget {
  return { leadId: null, skipReason: null, sentAt: null, updatedAt: new Date(), ...overrides };
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
});

describe('advanceCampaignTargetStatus', () => {
  it('avança pending→sent e incrementa só o sentCount da campanha', async () => {
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'pending' })],
      campaigns: [campaign({ id: 'camp-1' })],
    });

    const result = await advanceCampaignTargetStatus(tx, 'ct-1', 'sent', { sentAt: new Date('2026-01-01T10:00:00Z') });

    expect(result?.status).toBe('sent');
    const camp = getFakeDbState().campaigns[0]!;
    expect(camp.sentCount).toBe(1);
    expect(camp.deliveredCount).toBe(0);
  });

  it('pula estágios (sent→responded): incrementa TODOS os contadores intermediários retroativamente, sem contar sent de novo', async () => {
    // O WhatsApp não confirmou leitura, mas o lead respondeu — é o cenário
    // do comentário de produção (linhas 90-100 de campaign-targets.ts).
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'sent' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })], // sent já contado antes deste teste
    });

    await advanceCampaignTargetStatus(tx, 'ct-1', 'responded');

    const camp = getFakeDbState().campaigns[0]!;
    // Regressão-alvo: um off-by-one em `slice(currentIndex, nextIndex+1)` em
    // vez de `slice(currentIndex + 1, nextIndex + 1)` DOBRARIA sentCount aqui.
    expect(camp.sentCount).toBe(1);
    expect(camp.deliveredCount).toBe(1);
    expect(camp.readCount).toBe(1);
    expect(camp.respondedCount).toBe(1);
  });

  it('reaplicar o mesmo status (retry de webhook) não incrementa o contador de novo', async () => {
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'sent' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 })],
    });

    await advanceCampaignTargetStatus(tx, 'ct-1', 'sent');

    expect(getFakeDbState().campaigns[0]!.sentCount).toBe(1); // não virou 2
  });

  it('não permite regressão: mandar um status anterior no funil é ignorado', async () => {
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'read' })],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1, deliveredCount: 1, readCount: 1 })],
    });

    await advanceCampaignTargetStatus(tx, 'ct-1', 'delivered');

    const state = getFakeDbState();
    expect(state.campaignTargets[0]!.status).toBe('read'); // não regrediu
    expect(state.campaigns[0]!.deliveredCount).toBe(1); // não incrementou de novo
  });

  it('alvo em estado terminal (failed) nunca é reaberto por um evento posterior', async () => {
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'failed', skipReason: 'erro de envio' })],
      campaigns: [campaign({ id: 'camp-1', failedCount: 1 })],
    });

    const result = await advanceCampaignTargetStatus(tx, 'ct-1', 'delivered');

    expect(result?.status).toBe('failed'); // devolve o alvo como está, sem reabrir
    const state = getFakeDbState();
    expect(state.campaignTargets[0]!.status).toBe('failed');
    expect(state.campaigns[0]!.deliveredCount).toBe(0); // nunca chegou a incrementar
  });

  it('nextStatus=skipped incrementa skippedCount e grava skipReason, sem tocar nos contadores do funil', async () => {
    resetFakeDb({
      campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'pending' })],
      campaigns: [campaign({ id: 'camp-1' })],
    });

    await advanceCampaignTargetStatus(tx, 'ct-1', 'skipped', { skipReason: 'opted_out' });

    const state = getFakeDbState();
    expect(state.campaignTargets[0]!.status).toBe('skipped');
    expect(state.campaignTargets[0]!.skipReason).toBe('opted_out');
    expect(state.campaigns[0]!.skippedCount).toBe(1);
    expect(state.campaigns[0]!.sentCount).toBe(0);
  });

  it('targetId inexistente retorna null sem lançar e sem tocar nenhuma campanha', async () => {
    resetFakeDb({ campaigns: [campaign({ id: 'camp-1' })] });

    const result = await advanceCampaignTargetStatus(tx, 'ct-inexistente', 'sent');

    expect(result).toBeNull();
    expect(getFakeDbState().campaigns[0]!.sentCount).toBe(0);
  });
});

describe('skipPendingCampaignTargetsForPhone', () => {
  it('marca como skipped só os alvos PENDING daquele telefone e retorna a contagem afetada', async () => {
    resetFakeDb({
      campaignTargets: [
        target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'pending' }),
        target({ id: 'ct-2', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'sent' }), // não-pending, não deve ser afetado
        target({ id: 'ct-3', campaignId: 'camp-2', phoneE164: '+5521900000000', status: 'pending' }), // outro telefone, não deve ser afetado
      ],
      campaigns: [campaign({ id: 'camp-1', sentCount: 1 }), campaign({ id: 'camp-2' })],
    });

    const affected = await skipPendingCampaignTargetsForPhone(tx, '+5511987654321', 'opted_out');

    expect(affected).toBe(1);
    const state = getFakeDbState();
    expect(state.campaignTargets.find((t) => t.id === 'ct-1')?.status).toBe('skipped');
    expect(state.campaignTargets.find((t) => t.id === 'ct-2')?.status).toBe('sent'); // intocado
    expect(state.campaignTargets.find((t) => t.id === 'ct-3')?.status).toBe('pending'); // intocado
    expect(state.campaigns.find((c) => c.id === 'camp-1')?.skippedCount).toBe(1);
    expect(state.campaigns.find((c) => c.id === 'camp-2')?.skippedCount).toBe(0);
  });

  it('telefone sem nenhum alvo pending retorna 0 sem lançar', async () => {
    resetFakeDb({ campaignTargets: [target({ id: 'ct-1', campaignId: 'camp-1', phoneE164: '+5511987654321', status: 'sent' })] });

    const affected = await skipPendingCampaignTargetsForPhone(tx, '+5511987654321', 'opted_out');

    expect(affected).toBe(0);
  });
});

describe('haltCampaignsSoleInstanceDisconnected', () => {
  it('campanha com 1 instância (a que desconectou) é halted', async () => {
    resetFakeDb({ campaigns: [campaign({ id: 'camp-1', status: 'running', instanceIds: ['inst-1'] })] });

    const affected = await haltCampaignsSoleInstanceDisconnected(tx, 'inst-1', 'Instância desconectada.');

    expect(affected).toEqual(['camp-1']);
    const state = getFakeDbState();
    expect(state.campaigns[0]!.status).toBe('halted');
    expect(state.campaigns[0]!.haltReason).toBe('Instância desconectada.');
  });

  it('campanha com 2 instâncias, só 1 desconecta, NÃO é halted', async () => {
    resetFakeDb({ campaigns: [campaign({ id: 'camp-1', status: 'running', instanceIds: ['inst-1', 'inst-2'] })] });

    const affected = await haltCampaignsSoleInstanceDisconnected(tx, 'inst-1', 'Instância desconectada.');

    expect(affected).toEqual([]);
    expect(getFakeDbState().campaigns[0]!.status).toBe('running');
  });

  it('campanha SEM nenhuma instância associada NÃO é halted (guarda contra o every vacuosamente verdadeiro do Prisma, REVISAO-QA §2.6)', async () => {
    resetFakeDb({ campaigns: [campaign({ id: 'camp-1', status: 'running', instanceIds: [] })] });

    const affected = await haltCampaignsSoleInstanceDisconnected(tx, 'inst-1', 'Instância desconectada.');

    // Sem o `some: {}` na query de produção, `every` sobre relação vazia
    // seria vacuosamente verdadeiro e esta campanha SERIA (erradamente)
    // halted. Esta é a linha que protege contra remover `some: {}` num
    // "refactor de limpeza" futuro.
    expect(affected).toEqual([]);
    expect(getFakeDbState().campaigns[0]!.status).toBe('running');
  });

  it('campanha em draft/completed usando só aquela instância NÃO é afetada (só running/scheduled)', async () => {
    resetFakeDb({
      campaigns: [
        campaign({ id: 'camp-draft', status: 'draft', instanceIds: ['inst-1'] }),
        campaign({ id: 'camp-completed', status: 'completed', instanceIds: ['inst-1'] }),
      ],
    });

    const affected = await haltCampaignsSoleInstanceDisconnected(tx, 'inst-1', 'Instância desconectada.');

    expect(affected).toEqual([]);
  });

  it('afeta várias campanhas de uma vez e devolve todos os ids halted', async () => {
    resetFakeDb({
      campaigns: [
        campaign({ id: 'camp-1', status: 'running', instanceIds: ['inst-1'] }),
        campaign({ id: 'camp-2', status: 'scheduled', instanceIds: ['inst-1'] }),
        campaign({ id: 'camp-3', status: 'running', instanceIds: ['inst-2'] }), // outra instância, não afetada
      ],
    });

    const affected = await haltCampaignsSoleInstanceDisconnected(tx, 'inst-1', 'Instância banida.');

    expect(affected.sort()).toEqual(['camp-1', 'camp-2']);
    expect(getFakeDbState().campaigns.find((c) => c.id === 'camp-3')?.status).toBe('running');
  });
});
