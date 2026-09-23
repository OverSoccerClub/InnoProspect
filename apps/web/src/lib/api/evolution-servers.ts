import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/fetcher';
import {
  mockCreateEvolutionServer,
  mockDeactivateEvolutionServer,
  mockListEvolutionServers,
  mockTestEvolutionServerConnection,
  mockUpdateEvolutionServer,
} from '@/mocks/evolution-servers';
import { mockDelay } from '@/mocks/utils';
import type {
  CreateEvolutionServerRequest,
  CreateEvolutionServerResponse,
  EvolutionServerItem,
  TestEvolutionServerConnectionResponse,
  UpdateEvolutionServerRequest,
  UpdateEvolutionServerResponse,
} from '@/types/evolution-server';

export async function listEvolutionServers(): Promise<EvolutionServerItem[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListEvolutionServers();
  }
  const res = await apiGet<{ data: EvolutionServerItem[] }>('/api/v1/evolution-servers');
  return res.data;
}

export async function createEvolutionServer(input: CreateEvolutionServerRequest): Promise<CreateEvolutionServerResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockCreateEvolutionServer(input);
  }
  return apiPost<CreateEvolutionServerResponse>('/api/v1/evolution-servers', input);
}

export async function updateEvolutionServer(id: string, patch: UpdateEvolutionServerRequest): Promise<UpdateEvolutionServerResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockUpdateEvolutionServer(id, patch);
  }
  return apiPatch<UpdateEvolutionServerResponse>(`/api/v1/evolution-servers/${id}`, patch);
}

/** `DELETE` real DESATIVA (`isActive: false`), nunca apaga a linha — ver `lib/services/evolution-servers.ts`. */
export async function deactivateEvolutionServer(id: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    mockDeactivateEvolutionServer(id);
    return;
  }
  await apiDelete(`/api/v1/evolution-servers/${id}`);
}

/** Reativação é só um `PATCH { isActive: true }` — mesmo endpoint de edição, sem rota dedicada (mesmo padrão de `lib/api/users.ts#reactivateUser`). */
export async function reactivateEvolutionServer(id: string): Promise<UpdateEvolutionServerResponse> {
  return updateEvolutionServer(id, { isActive: true });
}

/** Sempre resolve — `ok:false` é o RESULTADO do teste, nunca um erro de rede/API (ver `evolution-server.contract.ts`). Só rejeita se a chamada à nossa própria API falhar (rede, `404` de um id inexistente). */
export async function testEvolutionServerConnection(id: string): Promise<TestEvolutionServerConnectionResponse> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockTestEvolutionServerConnection(id);
  }
  return apiPost<TestEvolutionServerConnectionResponse>(`/api/v1/evolution-servers/${id}/test-connection`);
}
