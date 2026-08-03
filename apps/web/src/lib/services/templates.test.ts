/**
 * templates.test.ts — REVISAO-QA.md §4, item "9+" (pendência de menor risco
 * que os 4 prioritários, mas dentro da área liberada pelo Atlas nesta
 * rodada: "ninguém está tocando" `templates.ts`). Cobre a validação de
 * variável/spintax (delegada a `@inno/core`, aqui só a integração) e a
 * "dupla proteção" documentada no cabeçalho de `deleteTemplate` — checagem
 * proativa (`409` antes de tentar apagar) E o catch de `P2003`/`P2014` como
 * backstop de corrida (a próprio comentário do Vega avisa que as duas
 * existem de propósito; sem teste, é fácil "simplificar" uma delas achando
 * redundante).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTemplateBody } from '@inno/contracts';
import type * as InnoDb from '@inno/db';

const prismaMock = vi.hoisted(() => ({
  messageTemplate: {
    count: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  campaign: {
    findFirst: vi.fn(),
  },
}));

// Mantém o `Prisma` namespace REAL (classes puras, sem I/O — precisa dele de
// verdade para `err instanceof Prisma.PrismaClientKnownRequestError`
// funcionar), só troca o `prisma` (client) pelo mock.
vi.mock('@inno/db', async (importOriginal) => {
  const actual = await importOriginal<typeof InnoDb>();
  return { ...actual, prisma: prismaMock };
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});

const { createTemplate, deleteTemplate, getTemplate } = await import('./templates');
const { Prisma } = await import('@inno/db');

function fakeTemplateRow(overrides: Partial<{ id: string; name: string; body: string; isActive: boolean; usageCount: number }> = {}) {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'tpl-1',
    name: 'Template padrão',
    body: 'Olá {{primeiro_nome}}, {opção A|opção B|opção C} para {{cidade}}?',
    variablesUsed: ['primeiro_nome', 'cidade'],
    isActive: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createTemplate', () => {
  it('rejeita variável desconhecida com erro de validação, sem chamar o Prisma', async () => {
    const body: CreateTemplateBody = { name: 'Template ruim', body: 'Olá {{campo_que_nao_existe}}, tudo bem?', isActive: true };

    await expect(createTemplate(body, 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prismaMock.messageTemplate.create).not.toHaveBeenCalled();
  });

  it('rejeita spintax malformado (chave sem fechar) com erro de validação', async () => {
    const body: CreateTemplateBody = { name: 'Template ruim', body: 'Olá {{nome}}, {opção A|opção B tudo bem?', isActive: true };

    await expect(createTemplate(body, 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('template com poucas variações de spintax (<3) é criado COM warning LOW_VARIATION — não é bloqueio', async () => {
    prismaMock.messageTemplate.create.mockResolvedValueOnce(
      fakeTemplateRow({ body: 'Olá {{primeiro_nome}}, {oi|olá} tudo bem?', variablesUsed: ['primeiro_nome'] } as never),
    );
    const body: CreateTemplateBody = { name: 'Baixa variação', body: 'Olá {{primeiro_nome}}, {oi|olá} tudo bem?', isActive: true };

    const result = await createTemplate(body, 'user-1');

    expect(result.warnings?.[0]?.code).toBe('LOW_VARIATION');
  });

  it('template com >=3 variações de spintax é criado SEM warning', async () => {
    prismaMock.messageTemplate.create.mockResolvedValueOnce(fakeTemplateRow());
    const body: CreateTemplateBody = { name: 'Boa variação', body: fakeTemplateRow().body, isActive: true };

    const result = await createTemplate(body, 'user-1');

    expect(result.warnings).toBeUndefined();
  });
});

describe('getTemplate', () => {
  it('devolve 404 quando o template não existe', async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValueOnce(null);

    await expect(getTemplate('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('deleteTemplate — dupla proteção contra "template em uso"', () => {
  it('checagem PROATIVA: devolve 409 e NÃO tenta apagar quando uma campanha referencia o template', async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValueOnce(fakeTemplateRow());
    prismaMock.campaign.findFirst.mockResolvedValueOnce({ id: 'camp-1' });

    await expect(deleteTemplate('tpl-1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prismaMock.messageTemplate.delete).not.toHaveBeenCalled();
  });

  it('BACKSTOP: se a checagem proativa passar mas o delete real estourar P2003 (corrida), ainda vira 409 — não 500', async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValueOnce(fakeTemplateRow());
    prismaMock.campaign.findFirst.mockResolvedValueOnce(null); // checagem proativa não viu nada
    prismaMock.messageTemplate.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
        code: 'P2003',
        clientVersion: '6.19.3',
      }),
    );

    await expect(deleteTemplate('tpl-1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('apaga normalmente quando o template não está em uso', async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValueOnce(fakeTemplateRow());
    prismaMock.campaign.findFirst.mockResolvedValueOnce(null);
    prismaMock.messageTemplate.delete.mockResolvedValueOnce(fakeTemplateRow());

    await expect(deleteTemplate('tpl-1')).resolves.toBeUndefined();
    expect(prismaMock.messageTemplate.delete).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
  });

  it('devolve 404 quando o template a apagar não existe', async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValueOnce(null);

    await expect(deleteTemplate('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
