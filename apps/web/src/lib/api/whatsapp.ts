import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPost } from '@/lib/fetcher';
import {
  mockConnectInstance,
  mockCreateInstance,
  mockDeleteInstance,
  mockDisconnectInstance,
  mockGetInstanceQr,
  mockGetInstanceStatus,
  mockListInstances,
  mockReconcileInstances,
} from '@/mocks/whatsapp';
import { mockDelay } from '@/mocks/utils';
import type {
  ConnectInstanceResponse,
  CreateInstanceRequest,
  CreateInstanceResponse,
  DisconnectInstanceResponse,
  InstanceListItem,
  InstanceQrResponse,
  InstanceStatusResponse,
  ReconcileInstancesResult,
} from '@/types/whatsapp';

export async function listInstances(): Promise<InstanceListItem[]> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListInstances();
  }
  const res = await apiGet<{ data: InstanceListItem[] }>('/api/v1/whatsapp/instances');
  return res.data;
}

/**
 * `POST /whatsapp/instances/reconcile` — reconciliação FORÇADA sob pedido
 * explícito do operador ("Verificar agora"), `requireRole: 'admin'`.
 * Devolve o MESMO shape de `listInstances`: quem chamou troca os dados que
 * já tem pelo resultado, em vez de esperar um novo `GET` (ver comentário
 * grande em `apps/web/src/lib/services/whatsapp-instances.ts`).
 *
 * ⚠️ Esta rota NÃO devolve `502` quando a Evolution está fora do ar — ela
 * responde `200` com o último estado conhecido, porque a reconciliação
 * nunca quebra a leitura (mesma postura do `GET` da lista). Quem distingue
 * "confirmei" de "tentei e não consegui" é `unconfirmed`: quantas instâncias
 * desta rodada não puderam ser confirmadas. `0` = todas confirmadas. Ele
 * também expressa o caso PARCIAL (3 de 4), que um código HTTP não
 * conseguiria sem mentir sobre as outras 3. Um `ApiRequestError` daqui
 * significa outra coisa (403 por papel, 500 nosso) — aí sim é falha da
 * chamada, não do upstream.
 */
export async function reconcileInstances(): Promise<ReconcileInstancesResult> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockReconcileInstances();
  }
  const res = await apiPost<{ data: InstanceListItem[]; unconfirmed: number }>('/api/v1/whatsapp/instances/reconcile');
  return { instances: res.data, unconfirmed: res.unconfirmed };
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

/**
 * Leitura pura do estado de conexão — nunca (re)gera QR. Ver
 * `getInstanceQr` abaixo e a nota de bug em
 * `apps/web/src/lib/services/whatsapp-instances.ts#getWhatsAppInstanceQr`
 * (2026-09-23): é ESTA função que deve ser sondada em intervalo curto e
 * fixo (2s), nunca `getInstanceQr`.
 */
export async function getInstanceStatus(id: string): Promise<InstanceStatusResponse> {
  if (USE_MOCKS) {
    await mockDelay(100);
    return mockGetInstanceStatus(id);
  }
  return apiGet<InstanceStatusResponse>(`/api/v1/whatsapp/instances/${id}/status`);
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
