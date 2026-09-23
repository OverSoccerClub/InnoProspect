import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/fetcher';
import { mockCreateUser, mockDeactivateUser, mockListUsers, mockUpdateUser } from '@/mocks/users';
import { mockDelay } from '@/mocks/utils';
import type { Paginated } from '@/types/common';
import type { CreateUserRequest, CreateUserResponse, UpdateUserRequest, UpdateUserResponse, UserItem, UserRole } from '@/types/user';

export type ListUsersParams = {
  cursor?: string;
  limit?: number;
  role?: UserRole;
  isActive?: boolean;
  q?: string;
};

export async function listUsers(params: ListUsersParams = {}): Promise<Paginated<UserItem>> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListUsers(params);
  }
  return apiGet<Paginated<UserItem>>('/api/v1/users', params);
}

export async function createUser(input: CreateUserRequest): Promise<CreateUserResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockCreateUser(input);
  }
  return apiPost<CreateUserResponse>('/api/v1/users', input);
}

/**
 * `currentUserId` só é usado no ramo mock (o servidor pega o ator da própria
 * sessão via cookie — nunca vai no corpo da requisição real). Sempre passar
 * o id do usuário logado aqui para o aviso de autoexclusão/autorrebaixamento
 * funcionar igual em mock e em produção.
 */
export async function updateUser(id: string, patch: UpdateUserRequest, currentUserId: string): Promise<UpdateUserResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockUpdateUser(id, patch, currentUserId);
  }
  return apiPatch<UpdateUserResponse>(`/api/v1/users/${id}`, patch);
}

/** `DELETE` real é soft-delete (`isActive: false`), idempotente — nunca exclui a linha. Ver `lib/services/users.ts`. */
export async function deactivateUser(id: string, currentUserId: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    mockDeactivateUser(id, currentUserId);
    return;
  }
  await apiDelete(`/api/v1/users/${id}`);
}

/** Reativação é só um `PATCH { isActive: true }` — mesmo endpoint de edição, sem rota dedicada. */
export async function reactivateUser(id: string, currentUserId: string): Promise<UpdateUserResponse> {
  return updateUser(id, { isActive: true }, currentUserId);
}
