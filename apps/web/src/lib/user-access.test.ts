import { describe, expect, it } from 'vitest';

import { canChangeRole, canDeactivate, countActiveAdmins, isSelf } from './user-access';
import type { UserItem } from '@/types/user';

function user(overrides: Partial<UserItem>): UserItem {
  return {
    id: 'usr_x',
    email: 'x@innoprospect.com',
    name: 'Usuário X',
    role: 'operator',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isSelf', () => {
  it('reconhece o próprio usuário pelo id', () => {
    expect(isSelf(user({ id: 'usr_1' }), 'usr_1')).toBe(true);
    expect(isSelf(user({ id: 'usr_1' }), 'usr_2')).toBe(false);
  });
});

describe('countActiveAdmins', () => {
  it('conta só admin ativo — ignora admin inativo e operador ativo', () => {
    const users = [
      user({ id: '1', role: 'admin', isActive: true }),
      user({ id: '2', role: 'admin', isActive: false }),
      user({ id: '3', role: 'operator', isActive: true }),
    ];
    expect(countActiveAdmins(users)).toBe(1);
  });
});

describe('canChangeRole', () => {
  const admin = user({ id: 'usr_1', role: 'admin', isActive: true });

  it('permite trocar de operador pra admin sempre (nunca reduz admin)', () => {
    const operator = user({ id: 'usr_2', role: 'operator' });
    const result = canChangeRole(operator, 'admin', { currentUserId: 'usr_2', loadedUsers: [operator], listComplete: true });
    expect(result.disabled).toBe(false);
  });

  it('recusa rebaixar a si mesmo', () => {
    const result = canChangeRole(admin, 'operator', { currentUserId: 'usr_1', loadedUsers: [admin], listComplete: true });
    expect(result).toEqual({ disabled: true, reason: 'Você não pode remover seu próprio acesso de administrador.' });
  });

  it('recusa rebaixar o último admin ativo, mesmo não sendo o próprio ator', () => {
    const other = user({ id: 'usr_2', role: 'operator', isActive: true });
    const result = canChangeRole(admin, 'operator', { currentUserId: 'usr_9', loadedUsers: [admin, other], listComplete: true });
    expect(result.disabled).toBe(true);
  });

  it('permite rebaixar um admin quando existe outro admin ativo', () => {
    const secondAdmin = user({ id: 'usr_2', role: 'admin', isActive: true });
    const result = canChangeRole(admin, 'operator', {
      currentUserId: 'usr_9',
      loadedUsers: [admin, secondAdmin],
      listComplete: true,
    });
    expect(result.disabled).toBe(false);
  });

  it('não desabilita por "último admin" quando a lista carregada está incompleta (paginada)', () => {
    const result = canChangeRole(admin, 'operator', { currentUserId: 'usr_9', loadedUsers: [admin], listComplete: false });
    expect(result.disabled).toBe(false);
  });

  it('admin inativo não conta como "o último admin ativo" — rebaixar o único admin ATIVO restante ainda é bloqueado', () => {
    const inactiveAdmin = user({ id: 'usr_2', role: 'admin', isActive: false });
    const result = canChangeRole(admin, 'operator', {
      currentUserId: 'usr_9',
      loadedUsers: [admin, inactiveAdmin],
      listComplete: true,
    });
    expect(result.disabled).toBe(true);
  });
});

describe('canDeactivate', () => {
  const admin = user({ id: 'usr_1', role: 'admin', isActive: true });

  it('recusa desativar a si mesmo, mesmo havendo outros admins', () => {
    const secondAdmin = user({ id: 'usr_2', role: 'admin', isActive: true });
    const result = canDeactivate(admin, { currentUserId: 'usr_1', loadedUsers: [admin, secondAdmin], listComplete: true });
    expect(result).toEqual({ disabled: true, reason: 'Você não pode desativar sua própria conta.' });
  });

  it('recusa desativar o último admin ativo', () => {
    const operator = user({ id: 'usr_2', role: 'operator' });
    const result = canDeactivate(admin, { currentUserId: 'usr_9', loadedUsers: [admin, operator], listComplete: true });
    expect(result.disabled).toBe(true);
  });

  it('permite desativar um operador livremente', () => {
    const operator = user({ id: 'usr_2', role: 'operator' });
    const result = canDeactivate(operator, { currentUserId: 'usr_9', loadedUsers: [admin, operator], listComplete: true });
    expect(result.disabled).toBe(false);
  });

  it('permite desativar um admin quando existe outro admin ativo', () => {
    const secondAdmin = user({ id: 'usr_2', role: 'admin', isActive: true });
    const result = canDeactivate(admin, { currentUserId: 'usr_9', loadedUsers: [admin, secondAdmin], listComplete: true });
    expect(result.disabled).toBe(false);
  });
});
