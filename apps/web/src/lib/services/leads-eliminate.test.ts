/**
 * leads-eliminate.test.ts — `POST /api/v1/leads/:id/eliminate` (ARQUITETURA
 * §7.3/§7.4, ação `delete_lead_data`, Fase 5.3). Cobre exatamente o que o
 * escopo pede: `OptOut` sobrevive (criado OU preservado), o `Lead` some, e
 * `404` para id inexistente. A checagem `role=admin` saiu daqui para
 * `requireRole: 'admin'` em `apiRoute` (mesmo mecanismo único de
 * `deleteOptOut`/CRUD de usuários) — este arquivo só testa a lógica de
 * negócio do serviço.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  lead: {
    findUnique: vi.fn(),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
  },
  message: { count: vi.fn(async () => 0) },
  leadActivity: { count: vi.fn(async () => 0) },
  optOut: {
    findUnique: vi.fn(
      async (): Promise<{ id: string; phoneE164: string; source: string; reason: string | null } | null> => null,
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'optout-fake', ...data })),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
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

const { eliminateLeadData } = await import('./leads');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.lead.delete.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  prismaMock.optOut.findUnique.mockResolvedValue(null);
  prismaMock.optOut.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'optout-fake', ...data }));
});

describe('eliminateLeadData', () => {
  it('lead inexistente devolve 404 e NÃO chama delete/transação', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(null);

    await expect(eliminateLeadData('nao-existe', 'admin-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(prismaMock.lead.delete).not.toHaveBeenCalled();
    expect(prismaMock.optOut.create).not.toHaveBeenCalled();
  });

  it('lead COM telefone e SEM OptOut prévio: apaga o lead e CRIA o OptOut (source: request) — mantém a proteção', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce({ id: 'lead-1', phoneE164: '+5511987654321' });
    prismaMock.message.count.mockResolvedValueOnce(3);
    prismaMock.leadActivity.count.mockResolvedValueOnce(2);

    const result = await eliminateLeadData('lead-1', 'admin-1');

    expect(prismaMock.lead.delete).toHaveBeenCalledWith({ where: { id: 'lead-1' } });
    expect(prismaMock.optOut.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneE164: '+5511987654321', source: 'request' }),
    });
    expect(result).toEqual({
      ok: true,
      leadId: 'lead-1',
      deletedMessages: 3,
      deletedActivities: 2,
      optOutId: 'optout-fake',
      optOutCreated: true,
    });
  });

  it('lead COM telefone e OptOut JÁ EXISTENTE (ex.: respondeu "sair" antes): preserva o OptOut, NÃO cria um segundo, NÃO sobrescreve', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce({ id: 'lead-1', phoneE164: '+5511987654321' });
    prismaMock.optOut.findUnique.mockResolvedValueOnce({ id: 'optout-antigo', phoneE164: '+5511987654321', source: 'reply', reason: null });

    const result = await eliminateLeadData('lead-1', 'admin-1');

    expect(prismaMock.optOut.create).not.toHaveBeenCalled();
    expect(result.optOutId).toBe('optout-antigo');
    expect(result.optOutCreated).toBe(false);
  });

  it('lead SEM telefone: apaga o lead, NÃO cria OptOut nenhum (não há chave de negócio possível) — devolve optOutId null', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce({ id: 'lead-2', phoneE164: null });

    const result = await eliminateLeadData('lead-2', 'admin-1');

    expect(prismaMock.optOut.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.optOut.create).not.toHaveBeenCalled();
    expect(result.optOutId).toBeNull();
    expect(result.optOutCreated).toBe(false);
    expect(prismaMock.lead.delete).toHaveBeenCalledWith({ where: { id: 'lead-2' } });
  });
});
