import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPost } from '@/lib/fetcher';
import { mockCreateOptOut, mockDeleteOptOut, mockListOptOuts } from '@/mocks/optouts';
import { mockDelay } from '@/mocks/utils';
import type { Paginated } from '@/types/common';
import type { CreateOptOutRequest, CreateOptOutResponse, OptOutItem } from '@/types/optout';

export type ListOptOutsParams = { cursor?: string; limit?: number };

export async function listOptOuts(params: ListOptOutsParams = {}): Promise<Paginated<OptOutItem>> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListOptOuts(params);
  }
  return apiGet<Paginated<OptOutItem>>('/api/v1/optouts', params);
}

export async function createOptOut(input: CreateOptOutRequest): Promise<CreateOptOutResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockCreateOptOut(input);
  }
  return apiPost<CreateOptOutResponse>('/api/v1/optouts', input);
}

/** Exige `role=admin` no backend (ARQUITETURA.md §4.7) — em caso de 403, a UI mostra a mensagem do servidor. */
export async function deleteOptOut(id: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    mockDeleteOptOut(id);
    return;
  }
  await apiDelete(`/api/v1/optouts/${id}`);
}
