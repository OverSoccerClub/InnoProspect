/**
 * leads-bulk.test.ts — `POST /api/v1/leads/bulk` (ARQUITETURA §4.3, revisado
 * 2026-09-22). Cobre exatamente os pontos exigidos no escopo:
 *   1. `expectedCount` divergente recusa a chamada (409 CONFLICT) — proteção
 *      contra "mudei 4.000 leads sem querer".
 *   2. Transição de status inválida é IGNORADA (vira `skipped`), sem
 *      derrubar o resto do lote.
 *   3. `LeadActivity` é registrada por lead de fato alterado — nenhuma para
 *      quem foi ignorado ou não mudou de fato (`NO_CHANGE`).
 *
 * `checkStatusTransition` (de `@inno/core`) NÃO é mockada — é a mesma regra
 * usada por `PATCH /leads/:id`, e o objetivo aqui é provar que o bulk a
 * respeita de verdade, não que ela foi chamada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkLeadsBody } from '@inno/contracts';

const prismaMock = vi.hoisted(() => ({
  lead: {
    findMany: vi.fn(),
    update: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
  },
  leadActivity: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'activity-fake', ...data })),
  },
  $transaction: vi.fn(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
    throw new Error('este mock só cobre a forma "array" de $transaction, usada por bulkUpdateLeads');
  }),
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const { bulkUpdateLeads } = await import('./leads');

/**
 * Monta um corpo de `bulkUpdateLeads` SEM passar por `bulkLeadsBodySchema` —
 * `idSchema` exige cuid2 de verdade, e o que este teste precisa provar é a
 * lógica de negócio de `bulkUpdateLeads`, não a validação Zod do formato do
 * id (isso é responsabilidade do contrato/schema, coberto por typecheck).
 */
function bulkBody(overrides: Partial<BulkLeadsBody> = {}): BulkLeadsBody {
  return {
    action: 'set_status',
    leadIds: ['lead-1'],
    value: { status: 'won' },
    ...overrides,
  } as BulkLeadsBody;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulkUpdateLeads — transição inválida não derruba o lote', () => {
  it('aplica o lead com transição válida e IGNORA o de transição inválida, sem lançar', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      { id: 'lead-ok', status: 'negotiating', tags: [] },
      { id: 'lead-bad', status: 'new', tags: [] }, // 'new' → 'won' não é adjacente no funil
    ]);

    const result = await bulkUpdateLeads(
      bulkBody({ leadIds: ['lead-ok', 'lead-bad'], value: { status: 'won' } }),
      'user-1',
    );

    expect(result.updatedIds).toEqual(['lead-ok']);
    expect(result.skipped).toEqual([
      {
        id: 'lead-bad',
        reason: 'INVALID_STATUS_TRANSITION',
        message: expect.stringContaining("não é possível ir de 'new' para 'won'"),
      },
    ]);
    expect(result.summary).toEqual({ requested: 2, updated: 1, skipped: 1 });
  });

  it('lead inexistente entra em skipped com NOT_FOUND — o resto do lote segue', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-ok', status: 'negotiating', tags: [] }]);

    const result = await bulkUpdateLeads(
      bulkBody({ leadIds: ['lead-ok', 'lead-ausente'], value: { status: 'won' } }),
      'user-1',
    );

    expect(result.updatedIds).toEqual(['lead-ok']);
    expect(result.skipped).toEqual([{ id: 'lead-ausente', reason: 'NOT_FOUND', message: 'Lead não encontrado.' }]);
  });

  it('setar o MESMO status que o lead já tem vira NO_CHANGE, não INVALID_STATUS_TRANSITION', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-x', status: 'won', tags: [] }]);

    const result = await bulkUpdateLeads(bulkBody({ leadIds: ['lead-x'], value: { status: 'won' } }), 'user-1');

    expect(result.skipped).toEqual([{ id: 'lead-x', reason: 'NO_CHANGE', message: "o lead já está em 'won'" }]);
  });
});

describe('bulkUpdateLeads — LeadActivity por lead de fato alterado', () => {
  it('registra UMA activity para o lead alterado, NENHUMA para o ignorado', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      { id: 'lead-ok', status: 'negotiating', tags: [] },
      { id: 'lead-bad', status: 'new', tags: [] },
    ]);

    await bulkUpdateLeads(bulkBody({ leadIds: ['lead-ok', 'lead-bad'], value: { status: 'won' } }), 'user-42');

    expect(prismaMock.leadActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.leadActivity.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-ok',
        type: 'status_changed',
        payload: { from: 'negotiating', to: 'won' },
        actor: 'user',
        actorUserId: 'user-42',
      },
    });
  });

  it('add_tags: NO_CHANGE quando o lead já tinha todas as tags — sem activity', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-tag', status: 'new', tags: ['vip'] }]);

    const result = await bulkUpdateLeads(
      bulkBody({ action: 'add_tags', leadIds: ['lead-tag'], value: { tags: ['vip'] } }),
      'user-1',
    );

    expect(result.updatedIds).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'lead-tag', reason: 'NO_CHANGE', message: 'o lead já tinha todas as tags informadas' },
    ]);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it('remove_tags: aplica e registra a activity com as tags removidas no payload', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-tag2', status: 'new', tags: ['vip', 'quente'] }]);

    const result = await bulkUpdateLeads(
      bulkBody({ action: 'remove_tags', leadIds: ['lead-tag2'], value: { tags: ['quente'] } }),
      'user-1',
    );

    expect(result.updatedIds).toEqual(['lead-tag2']);
    expect(prismaMock.lead.update).toHaveBeenCalledWith({ where: { id: 'lead-tag2' }, data: { tags: ['vip'] } });
    expect(prismaMock.leadActivity.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-tag2',
        type: 'tags_removed',
        payload: { tags: ['quente'] },
        actor: 'user',
        actorUserId: 'user-1',
      },
    });
  });
});

describe('bulkUpdateLeads — expectedCount protege contra o filtro que mudou entre a tela e o clique', () => {
  it('recusa com 409 CONFLICT/EXPECTED_COUNT_MISMATCH quando a contagem atual difere do expectedCount', async () => {
    // O filtro resolve para 3 leads AGORA, mas a tela mandou expectedCount=2
    // (viu uma contagem menor ao montar a chamada).
    prismaMock.lead.findMany.mockResolvedValueOnce([{ id: 'lead-a' }, { id: 'lead-b' }, { id: 'lead-c' }]);

    await expect(
      bulkUpdateLeads(
        bulkBody({ leadIds: undefined, filter: { status: ['new'] } as never, expectedCount: 2 }),
        'user-1',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', reason: 'EXPECTED_COUNT_MISMATCH' });

    // A recusa acontece ANTES de buscar o estado dos leads para alterar —
    // nada é lido/alterado quando a contagem não bate.
    expect(prismaMock.lead.update).not.toHaveBeenCalled();
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it('segue normalmente quando a contagem resolvida bate com expectedCount', async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: 'lead-a' }, { id: 'lead-b' }]) // resolução do filtro (só ids)
      .mockResolvedValueOnce([
        { id: 'lead-a', status: 'new', tags: [] },
        { id: 'lead-b', status: 'new', tags: [] },
      ]); // estado atual pra validar a transição

    const result = await bulkUpdateLeads(
      bulkBody({
        leadIds: undefined,
        filter: { status: ['new'] } as never,
        expectedCount: 2,
        value: { status: 'validated' },
      }),
      'user-1',
    );

    expect(result.updatedIds.sort()).toEqual(['lead-a', 'lead-b']);
    expect(result.summary).toEqual({ requested: 2, updated: 2, skipped: 0 });
  });
});
