/**
 * users.test.ts — CRUD de usuários (Onda 4). Cobre a lógica de NEGÓCIO do
 * serviço (auto-proteção, "nunca zero admin", normalização de e-mail,
 * idempotência do soft-delete). A checagem `requireRole: 'admin'` em si
 * (403 operador / 200 admin, por rota) é responsabilidade de `apiRoute`
 * (`lib/api-handler.ts`) e está coberta em `apps/web/src/lib/api-handler.test.ts`
 * — não duplicada aqui.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateUserBody, UpdateUserBody } from '@inno/contracts';
import type * as InnoDb from '@inno/db';
import { getFakeDbState, resetFakeDb, type FakeUser } from '@/test/fake-db';

// Mantém o `Prisma` namespace REAL (precisa dele de verdade para
// `err instanceof Prisma.PrismaClientKnownRequestError` funcionar na corrida
// de `createUser`, mesmo padrão de `templates.test.ts`) — só troca o
// `prisma` (client) pelo fake em memória.
vi.mock('@inno/db', async (importOriginal) => {
  const actual = await importOriginal<typeof InnoDb>();
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { ...actual, prisma: fakePrismaClient };
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
// Mesmo motivo de `auth.test.ts`: não precisamos do custo real do bcrypt
// (cost 12 é lento de propósito) para testar a REGRA de negócio — só
// verificamos que `hash`/`compare` são chamados com os argumentos certos.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (password: string, cost: number) => `hashed(${cost}):${password}`),
  },
}));

const { createUser, deactivateUser, getUser, listUsers, updateUser } = await import('./users');
const bcrypt = (await import('bcryptjs')).default;

function user(overrides: Partial<FakeUser> & Pick<FakeUser, 'id' | 'email' | 'role' | 'isActive'>): FakeUser {
  const now = new Date('2026-09-23T10:00:00Z');
  return { name: 'Usuário', passwordHash: 'hash-antigo', createdAt: now, updatedAt: now, ...overrides };
}

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
});

describe('createUser', () => {
  it('cria com e-mail normalizado (trim + lowercase) e hash bcrypt custo 12', async () => {
    const body: CreateUserBody = { email: '  Novo@InnoProspect.local ', password: 'senha-forte-123', name: 'Novo', role: 'operator' };

    const result = await createUser(body);

    expect(result.email).toBe('novo@innoprospect.local');
    expect(result.role).toBe('operator');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(bcrypt.hash).toHaveBeenCalledWith('senha-forte-123', 12);
    expect(getFakeDbState().users[0]!.passwordHash).toBe('hashed(12):senha-forte-123');
  });

  it('devolve 409 se o e-mail já existe (case-insensitive, por normalização)', async () => {
    resetFakeDb({ users: [user({ id: 'u1', email: 'existe@innoprospect.local', role: 'operator', isActive: true })] });

    await expect(
      createUser({ email: 'EXISTE@innoprospect.local', password: 'senha-forte-123', name: 'Duplicado', role: 'operator' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(getFakeDbState().users).toHaveLength(1);
  });
});

describe('listUsers', () => {
  it('filtra por role/isActive e busca por nome/e-mail (q)', async () => {
    resetFakeDb({
      users: [
        user({ id: 'u1', email: 'admin@x.local', role: 'admin', isActive: true, name: 'Admin Principal' }),
        user({ id: 'u2', email: 'op1@x.local', role: 'operator', isActive: true, name: 'Operador Um' }),
        user({ id: 'u3', email: 'op2@x.local', role: 'operator', isActive: false, name: 'Operador Dois' }),
      ],
    });

    const onlyAdmins = await listUsers({ role: 'admin', limit: 25 });
    expect(onlyAdmins.data.map((u) => u.id)).toEqual(['u1']);

    const onlyActiveOperators = await listUsers({ role: 'operator', isActive: true, limit: 25 });
    expect(onlyActiveOperators.data.map((u) => u.id)).toEqual(['u2']);

    const byName = await listUsers({ q: 'dois', limit: 25 });
    expect(byName.data.map((u) => u.id)).toEqual(['u3']);
  });
});

describe('getUser', () => {
  it('404 se não existe', async () => {
    await expect(getUser('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('updateUser — autoproteção e "nunca zero admin"', () => {
  it('bloqueia o admin rebaixar A SI MESMO', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    const patch: UpdateUserBody = { role: 'operator' };
    await expect(updateUser('admin-1', patch, { id: 'admin-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getFakeDbState().users[0]!.role).toBe('admin'); // intocado
  });

  it('bloqueia o admin desativar A SI MESMO', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    await expect(updateUser('admin-1', { isActive: false }, { id: 'admin-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getFakeDbState().users[0]!.isActive).toBe(true);
  });

  it('bloqueia rebaixar o ÚLTIMO admin ativo (mesmo sendo outro ator)', async () => {
    resetFakeDb({
      users: [
        user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true }),
        user({ id: 'admin-2', email: 'b@x.local', role: 'admin', isActive: false }), // inativo — não conta
      ],
    });

    await expect(updateUser('admin-1', { role: 'operator' }, { id: 'other-admin' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(getFakeDbState().users.find((u) => u.id === 'admin-1')!.role).toBe('admin');
  });

  it('permite rebaixar um admin quando existe OUTRO admin ativo', async () => {
    resetFakeDb({
      users: [
        user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true }),
        user({ id: 'admin-2', email: 'b@x.local', role: 'admin', isActive: true }),
      ],
    });

    const result = await updateUser('admin-1', { role: 'operator' }, { id: 'admin-2' });
    expect(result.role).toBe('operator');
  });

  it('bloqueia desativar o ÚLTIMO admin ativo', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    await expect(updateUser('admin-1', { isActive: false }, { id: 'nao-e-o-proprio' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('edição de campos que não tocam role/isActive (nome, senha, e-mail) não passa pela trava de admin', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    const result = await updateUser('admin-1', { name: 'Novo Nome', password: 'outra-senha-123' }, { id: 'admin-1' });
    expect(result.name).toBe('Novo Nome');
    expect(getFakeDbState().users[0]!.passwordHash).toBe('hashed(12):outra-senha-123');
  });

  it('404 se o usuário não existe', async () => {
    await expect(updateUser('nao-existe', { name: 'X' }, { id: 'admin-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('409 ao trocar e-mail para um já usado por outro usuário', async () => {
    resetFakeDb({
      users: [
        user({ id: 'u1', email: 'um@x.local', role: 'operator', isActive: true }),
        user({ id: 'u2', email: 'dois@x.local', role: 'operator', isActive: true }),
      ],
    });

    await expect(updateUser('u1', { email: 'dois@x.local' }, { id: 'admin-1' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('deactivateUser', () => {
  it('bloqueia desativar A SI MESMO', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    await expect(deactivateUser('admin-1', { id: 'admin-1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bloqueia desativar o ÚLTIMO admin ativo', async () => {
    resetFakeDb({ users: [user({ id: 'admin-1', email: 'a@x.local', role: 'admin', isActive: true })] });

    await expect(deactivateUser('admin-1', { id: 'outro' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('desativa um operador normalmente', async () => {
    resetFakeDb({ users: [user({ id: 'op-1', email: 'op@x.local', role: 'operator', isActive: true })] });

    await deactivateUser('op-1', { id: 'admin-1' });

    expect(getFakeDbState().users[0]!.isActive).toBe(false);
  });

  it('é idempotente: desativar duas vezes o mesmo usuário não é erro', async () => {
    resetFakeDb({ users: [user({ id: 'op-1', email: 'op@x.local', role: 'operator', isActive: false })] });

    await expect(deactivateUser('op-1', { id: 'admin-1' })).resolves.toBeUndefined();
  });

  it('404 se o usuário não existe', async () => {
    await expect(deactivateUser('nao-existe', { id: 'admin-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
