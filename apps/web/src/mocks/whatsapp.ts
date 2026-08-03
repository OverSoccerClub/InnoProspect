import { ApiRequestError } from '@/lib/fetcher';
import type {
  ConnectInstanceResponse,
  CreateInstanceRequest,
  CreateInstanceResponse,
  DisconnectInstanceResponse,
  InstanceListItem,
  InstanceQrResponse,
} from '@/types/whatsapp';
import { mockNotFound } from './utils';

type MockInstance = InstanceListItem & {
  qrIssuedAtMs: number | null;
  qrPollCount: number;
};

let seq = 10;
let instances: MockInstance[] | null = null;

function buildInstances(): MockInstance[] {
  const now = Date.now();
  return [
    {
      id: 'wa_1',
      name: 'Comercial — linha 1',
      phoneNumber: '+5511987650001',
      status: 'connected',
      health: 'ok',
      warmup: { day: 25, dailyLimit: 300, isWarm: true },
      today: { sent: 118, failed: 2, responded: 9, remaining: 182 },
      lastConnectionAt: new Date(now - 3_600_000).toISOString(),
      lastErrorAt: null,
      lastError: null,
      activeCampaigns: 1,
      qrIssuedAtMs: null,
      qrPollCount: 0,
    },
    {
      id: 'wa_2',
      name: 'Comercial — linha 2 (aquecendo)',
      phoneNumber: '+5511987650002',
      status: 'connected',
      health: 'warming',
      warmup: { day: 6, dailyLimit: 70, isWarm: false },
      today: { sent: 41, failed: 0, responded: 5, remaining: 29 },
      lastConnectionAt: new Date(now - 7_200_000).toISOString(),
      lastErrorAt: null,
      lastError: null,
      activeCampaigns: 1,
      qrIssuedAtMs: null,
      qrPollCount: 0,
    },
    {
      id: 'wa_3',
      name: 'Backup — desconectado',
      phoneNumber: '+5511987650003',
      status: 'disconnected',
      health: 'degraded',
      warmup: { day: 3, dailyLimit: 40, isWarm: false },
      today: { sent: 0, failed: 0, responded: 0, remaining: 0 },
      lastConnectionAt: new Date(now - 2 * 86_400_000).toISOString(),
      lastErrorAt: new Date(now - 86_400_000).toISOString(),
      lastError: 'Conexão perdida (state: close). Tentando reconectar automaticamente.',
      activeCampaigns: 0,
      qrIssuedAtMs: null,
      qrPollCount: 0,
    },
  ];
}

function getInstances(): MockInstance[] {
  if (!instances) instances = buildInstances();
  return instances;
}

export function mockListInstances(): InstanceListItem[] {
  return getInstances().map((instance) => ({
    id: instance.id,
    name: instance.name,
    phoneNumber: instance.phoneNumber,
    status: instance.status,
    health: instance.health,
    warmup: instance.warmup,
    today: instance.today,
    lastConnectionAt: instance.lastConnectionAt,
    lastErrorAt: instance.lastErrorAt,
    lastError: instance.lastError,
    activeCampaigns: instance.activeCampaigns,
  }));
}

function findInstance(id: string): MockInstance {
  const instance = getInstances().find((i) => i.id === id);
  if (!instance) mockNotFound(`Instância "${id}" não encontrada.`);
  return instance;
}

export function mockCreateInstance(input: CreateInstanceRequest): CreateInstanceResponse {
  const id = `wa_${seq++}`;
  const evolutionInstanceName = `inno-${id}`;
  const instance: MockInstance = {
    id,
    name: input.name.trim(),
    phoneNumber: null,
    status: 'qr_pending',
    health: 'ok',
    warmup: { day: 1, dailyLimit: 20, isWarm: false },
    today: { sent: 0, failed: 0, responded: 0, remaining: 20 },
    lastConnectionAt: null,
    lastErrorAt: null,
    lastError: null,
    activeCampaigns: 0,
    qrIssuedAtMs: Date.now(),
    qrPollCount: 0,
  };
  getInstances().unshift(instance);
  return { id, name: instance.name, status: 'qr_pending', evolutionInstanceName };
}

/**
 * Simula o ciclo do QR real: expira a cada ~20s e o endpoint devolve um novo
 * automaticamente (ARQUITETURA.md §4.6). Depois de algumas leituras, "escaneia"
 * sozinho para não travar quem está testando localmente sem o Evolution API de verdade.
 */
export function mockGetInstanceQr(id: string): InstanceQrResponse {
  const instance = findInstance(id);

  if (instance.status === 'connected') {
    return { status: 'connected', qrCodeBase64: null };
  }

  instance.status = 'qr_pending';
  instance.qrPollCount += 1;

  if (instance.qrPollCount >= 5) {
    instance.status = 'connected';
    instance.phoneNumber = instance.phoneNumber ?? `+55119${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
    instance.lastConnectionAt = new Date().toISOString();
    instance.qrIssuedAtMs = null;
    return { status: 'connected', qrCodeBase64: null };
  }

  const elapsedMs = instance.qrIssuedAtMs ? Date.now() - instance.qrIssuedAtMs : Infinity;
  if (!instance.qrIssuedAtMs || elapsedMs > 20_000) {
    instance.qrIssuedAtMs = Date.now();
  }
  const remainingMs = 20_000 - (Date.now() - instance.qrIssuedAtMs);

  // PNG 1x1 transparente — só para ter uma imagem válida renderizável no <img>.
  const PLACEHOLDER_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  return {
    status: 'qr_pending',
    qrCodeBase64: PLACEHOLDER_PNG,
    expiresInSeconds: Math.max(1, Math.round(remainingMs / 1000)),
  };
}

export function mockConnectInstance(id: string): ConnectInstanceResponse {
  const instance = findInstance(id);
  instance.status = 'qr_pending';
  instance.qrIssuedAtMs = Date.now();
  instance.qrPollCount = 0;
  return { ok: true, status: 'qr_pending' };
}

export function mockDisconnectInstance(id: string): DisconnectInstanceResponse {
  const instance = findInstance(id);
  const pausedCampaigns = instance.activeCampaigns > 0 ? [`Campanha usando ${instance.name}`] : [];
  instance.status = 'disconnected';
  instance.activeCampaigns = 0;
  return { ok: true, status: 'disconnected', pausedCampaigns };
}

export function mockDeleteInstance(id: string): void {
  const all = getInstances();
  const index = all.findIndex((i) => i.id === id);
  if (index === -1) mockNotFound(`Instância "${id}" não encontrada.`);
  const instance = all[index]!;
  if (instance.activeCampaigns > 0) {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'Há uma campanha em andamento usando só esta instância. Pause ou remova a campanha antes de excluir.',
      requestId: 'mock',
    });
  }
  all.splice(index, 1);
}
