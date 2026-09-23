import type { CreateUserRequest, CreateUserResponse, UpdateUserRequest, UpdateUserResponse, UserItem, UserRole } from '@/types/user';
import { mockConflict, mockForbidden, mockNotFound } from './utils';

let seq = 10;
let users: UserItem[] | null = null;

const DAY_MS = 86_400_000;

/**
 * `usr_1` (Ana Souza, admin) existe pra poder testar as duas proteções de
 * autoexclusão sem precisar decodificar um JWT de sessão real — minte o
 * cookie de teste com `uid: 'usr_1'` (ver
 * `.claude/agent-memory/lyra/convention_test_session_cookie.md`) e a tela
 * mostra os controles de Ana desabilitados como se ela estivesse logada.
 * Fora isso, esta lista espelha as MESMAS regras de
 * `lib/services/users.ts` (Vega) — nunca a barreira real, só o fixture que
 * exercita loading/erro/vazio sem precisar do endpoint real no ar.
 */
function buildUsers(): UserItem[] {
  const now = Date.now();
  return [
    {
      id: 'usr_1',
      email: 'ana.souza@innoprospect.com',
      name: 'Ana Souza',
      role: 'admin',
      isActive: true,
      createdAt: new Date(now - 120 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 3 * DAY_MS).toISOString(),
    },
    {
      id: 'usr_2',
      email: 'carla.nunes@innoprospect.com',
      name: 'Carla Nunes',
      role: 'admin',
      isActive: true,
      createdAt: new Date(now - 95 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 10 * DAY_MS).toISOString(),
    },
    {
      id: 'usr_3',
      email: 'bruno.lima@innoprospect.com',
      name: 'Bruno Lima',
      role: 'operator',
      isActive: true,
      createdAt: new Date(now - 60 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 60 * DAY_MS).toISOString(),
    },
    {
      id: 'usr_4',
      email: 'diego.ramos@innoprospect.com',
      name: 'Diego Ramos',
      role: 'operator',
      isActive: false,
      createdAt: new Date(now - 40 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 2 * DAY_MS).toISOString(),
    },
    {
      id: 'usr_5',
      email: 'elisa.prado@innoprospect.com',
      name: 'Elisa Prado',
      role: 'operator',
      isActive: true,
      createdAt: new Date(now - 12 * DAY_MS).toISOString(),
      updatedAt: new Date(now - 12 * DAY_MS).toISOString(),
    },
  ];
}

function getUsers(): UserItem[] {
  if (!users) users = buildUsers();
  return users;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function encodeCursor(index: number): string {
  return btoa(String(index));
}
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    return Number(atob(cursor)) || 0;
  } catch {
    return 0;
  }
}

function countActiveAdmins(all: UserItem[]): number {
  return all.filter((u) => u.role === 'admin' && u.isActive).length;
}

function replaceUser(all: UserItem[], updated: UserItem): void {
  const index = all.findIndex((u) => u.id === updated.id);
  if (index !== -1) all[index] = updated;
}

export type MockListUsersParams = {
  cursor?: string;
  limit?: number;
  role?: UserRole;
  isActive?: boolean;
  q?: string;
};

export function mockListUsers(params: MockListUsersParams) {
  let filtered = getUsers();
  if (params.role) filtered = filtered.filter((u) => u.role === params.role);
  if (params.isActive !== undefined) filtered = filtered.filter((u) => u.isActive === params.isActive);
  if (params.q) {
    const q = params.q.trim().toLowerCase();
    filtered = filtered.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }
  const sorted = [...filtered].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const limit = Math.min(100, params.limit ?? 25);
  const start = decodeCursor(params.cursor);
  // `.map((u) => ({ ...u }))` — nunca devolver o objeto vivo do array
  // interno: ver bug documentado (mock GET com referência viva duplica dado
  // no React quando um PATCH posterior muta o mesmo objeto por baixo).
  const page = sorted.slice(start, start + limit).map((u) => ({ ...u }));
  const nextIndex = start + limit;

  return {
    data: page,
    page: {
      cursor: params.cursor ?? null,
      nextCursor: nextIndex < sorted.length ? encodeCursor(nextIndex) : null,
      limit,
      total: sorted.length,
    },
  };
}

export function mockCreateUser(input: CreateUserRequest): CreateUserResponse {
  const all = getUsers();
  const email = normalizeEmail(input.email);
  if (all.some((u) => u.email === email)) {
    mockConflict('EMAIL_TAKEN', `Já existe um usuário com o e-mail ${email}.`);
  }
  const now = new Date().toISOString();
  const item: UserItem = {
    id: `usr_${seq++}`,
    email,
    name: input.name,
    role: input.role ?? 'operator',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(item);
  return { ...item };
}

/**
 * `actorId` = usuário logado (o servidor pega isto da sessão; aqui entra
 * como parâmetro porque o mock não tem cookie de verdade). Espelha as duas
 * proteções obrigatórias de `lib/services/users.ts#updateUser` — autoexclusão/
 * autorrebaixamento e "nunca zero admin ativo".
 */
export function mockUpdateUser(id: string, patch: UpdateUserRequest, actorId: string): UpdateUserResponse {
  const all = getUsers();
  const existing = all.find((u) => u.id === id);
  if (!existing) mockNotFound('Usuário não encontrado.');

  const isSelf = actorId === id;
  const demotingSelf = isSelf && existing.role === 'admin' && patch.role !== undefined && patch.role !== 'admin';
  const deactivatingSelf = isSelf && patch.isActive === false;
  if (demotingSelf) mockForbidden('Você não pode remover seu próprio acesso de administrador.');
  if (deactivatingSelf) mockForbidden('Você não pode desativar sua própria conta.');

  let email = existing.email;
  if (patch.email !== undefined) {
    email = normalizeEmail(patch.email);
    if (email !== existing.email && all.some((u) => u.email === email)) {
      mockConflict('EMAIL_TAKEN', `Já existe um usuário com o e-mail ${email}.`);
    }
  }

  const leavingAdminRole = patch.role !== undefined && patch.role !== 'admin' && existing.role === 'admin';
  const beingDeactivated = patch.isActive === false && existing.isActive;
  const mayReduceAdmins = existing.role === 'admin' && existing.isActive && (leavingAdminRole || beingDeactivated);
  if (mayReduceAdmins && countActiveAdmins(all) <= 1) {
    mockConflict('LAST_ADMIN', 'Não é possível remover o último administrador ativo do sistema.');
  }

  const updated: UserItem = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    email,
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    updatedAt: new Date().toISOString(),
  };
  // Substitui o objeto pela referência — nunca muta `existing` em lugar
  // (mesma razão do comentário de `mockListUsers`: um GET anterior pode ter
  // devolvido esse mesmo objeto, e mutar em lugar mudaria dado já entregue).
  replaceUser(all, updated);
  return { ...updated };
}

/** Espelha `lib/services/users.ts#deactivateUser`: idempotente, nunca remove a linha, recusa autoexclusão e último admin ativo. */
export function mockDeactivateUser(id: string, actorId: string): void {
  const all = getUsers();
  const existing = all.find((u) => u.id === id);
  if (!existing) mockNotFound('Usuário não encontrado.');

  if (actorId === id) mockForbidden('Você não pode desativar sua própria conta.');
  if (!existing.isActive) return; // já estava inativo — no-op, mesmo espírito do DELETE real.

  if (existing.role === 'admin' && countActiveAdmins(all) <= 1) {
    mockConflict('LAST_ADMIN', 'Não é possível desativar o último administrador ativo do sistema.');
  }

  replaceUser(all, { ...existing, isActive: false, updatedAt: new Date().toISOString() });
}
