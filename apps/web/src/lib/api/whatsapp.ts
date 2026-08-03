import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPost } from '@/lib/fetcher';
import {
  mockConnectInstance,
  mockCreateInstance,
  mockDeleteInstance,
  mockDisconnectInstance,
  mockGetInstanceQr,
  mockListInstances,
} from '@/mocks/whatsapp';
import { mockDelay } from '@/mocks/utils';
import type {
  ConnectInstanceResponse,
  CreateInstanceRequest,
  CreateInstanceResponse,
  DisconnectInstanceResponse,
  InstanceListItem,
  InstanceQrResponse,
} from '@/types/whatsapp';

export async function listInstances(): Promise<InstanceListItem[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListInstances();
  }
  const res = await apiGet<{ data: InstanceListItem[] }>('/api/v1/whatsapp/instances');
  return res.data;
}

export async function createInstance(input: CreateInstanceRequest): Promise<CreateInstanceResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockCreateInstance(input);
  }
  return apiPost<CreateInstanceResponse>('/api/v1/whatsapp/instances', input);
}

export async function getInstanceQr(id: string): Promise<InstanceQrResponse> {
  if (USE_MOCKS) {
    await mockDelay(150);
    return mockGetInstanceQr(id);
  }
  return apiGet<InstanceQrResponse>(`/api/v1/whatsapp/instances/${id}/qr`);
}

export async function connectInstance(id: string): Promise<ConnectInstanceResponse> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockConnectInstance(id);
  }
  return apiPost<ConnectInstanceResponse>(`/api/v1/whatsapp/instances/${id}/connect`);
}

export async function disconnectInstance(id: string): Promise<DisconnectInstanceResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockDisconnectInstance(id);
  }
  return apiPost<DisconnectInstanceResponse>(`/api/v1/whatsapp/instances/${id}/disconnect`);
}

export async function deleteInstance(id: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    mockDeleteInstance(id);
    return;
  }
  await apiDelete(`/api/v1/whatsapp/instances/${id}`);
}
