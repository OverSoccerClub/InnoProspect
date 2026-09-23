/**
 * whatsapp-instances.test.ts — cobre a separação entre `getWhatsAppInstanceQr`
 * (SEMPRE chama `connect`, que reinicia o pareamento e emite QR novo) e
 * `getWhatsAppInstanceStatus` (leitura PURA, `getConnectionState`, NUNCA
 * chama `connect`) — a correção do bug real de produção descrito em
 * `getWhatsAppInstanceQr` (2026-09-23): a tela sondava `.../qr` a cada 2s e
 * invalidava o QR antes de dar tempo de escanear.
 *
 * Fake de Prisma compartilhado (`@/test/fake-db`, mesmo padrão de
 * `webhook.test.ts`/`evolution-servers.test.ts`) + `@/lib/evolution` mockado
 * (não é o que este arquivo testa — quem resolve o `EvolutionClient` certo
 * por instância/servidor já está coberto em `evolution.ts`, se algum dia
 * ganhar teste próprio).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetFakeDb, type FakeWhatsAppInstance } from '@/test/fake-db';

vi.mock('@inno/db', async () => {
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { prisma: fakePrismaClient };
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});
const sendAlertMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/alerts', () => ({ sendAlert: sendAlertMock }));

const connectMock = vi.hoisted(() => vi.fn());
const getConnectionStateMock = vi.hoisted(() => vi.fn());
const requireActiveEvolutionServerMock = vi.hoisted(() => vi.fn());
const getEvolutionClientForServerMock = vi.hoisted(() => vi.fn());
const generateEvolutionInstanceNameMock = vi.hoisted(() => vi.fn(() => 'inno-xyz'));
const generateInstanceKeyMock = vi.hoisted(() => vi.fn(() => 'instance-key-abc'));
const buildWebhookUrlMock = vi.hoisted(() => vi.fn((key: string) => `https://app.example.com/api/webhooks/evolution/${key}`));
vi.mock('@/lib/evolution', () => ({
  getEvolutionClientForInstance: vi.fn(async () => ({ connect: connectMock, getConnectionState: getConnectionStateMock })),
  requireActiveEvolutionServer: requireActiveEvolutionServerMock,
  getEvolutionClientForServer: getEvolutionClientForServerMock,
  generateEvolutionInstanceName: generateEvolutionInstanceNameMock,
  generateInstanceKey: generateInstanceKeyMock,
  buildWebhookUrl: buildWebhookUrlMock,
}));

const { getWhatsAppInstanceQr, getWhatsAppInstanceStatus, createWhatsAppInstance } = await import('./whatsapp-instances');
const { decryptEvolutionApiKey } = await import('@/lib/evolution-server-crypto');
const { getFakeDbState } = await import('@/test/fake-db');

function instance(overrides: Partial<FakeWhatsAppInstance> & Pick<FakeWhatsAppInstance, 'id'>): FakeWhatsAppInstance {
  return {
    status: 'qr_pending',
    isDegraded: false,
    consecutiveFailures: 0,
    lastConnectionAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    evolutionInstanceName: 'inno-1',
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
  connectMock.mockReset();
  getConnectionStateMock.mockReset();
  requireActiveEvolutionServerMock.mockReset();
  getEvolutionClientForServerMock.mockReset();
  sendAlertMock.mockReset();
});

describe('getWhatsAppInstanceStatus — leitura pura, nunca regenera o QR', () => {
  it('chama getConnectionState e NUNCA connect', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending' })] });
    getConnectionStateMock.mockResolvedValue('connecting');

    const res = await getWhatsAppInstanceStatus('i1');

    expect(getConnectionStateMock).toHaveBeenCalledWith('inno-1');
    expect(connectMock).not.toHaveBeenCalled();
    // Evolution só distingue 3 estados — fora de `connected`, devolve o que já estava no banco (mais nuance: `qr_pending`).
    expect(res).toEqual({ status: 'qr_pending' });
  });

  it('na transição para connected, persiste no banco e devolve status connected', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending' })] });
    getConnectionStateMock.mockResolvedValue('connected');

    const res = await getWhatsAppInstanceStatus('i1');

    expect(res).toEqual({ status: 'connected' });
    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.status).toBe('connected');
    expect(saved?.lastConnectionAt).toBeInstanceOf(Date);
    expect(connectMock).not.toHaveBeenCalled(); // a transição foi detectada SEM chamar connect.
  });

  it('se a Evolution devolver disconnected, NÃO sobrescreve o banco (isso é responsabilidade do webhook connection.update)', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending' })] });
    getConnectionStateMock.mockResolvedValue('disconnected');

    const res = await getWhatsAppInstanceStatus('i1');

    expect(res).toEqual({ status: 'qr_pending' });
    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.status).toBe('qr_pending'); // não regrediu — só o webhook faz esse kill switch.
  });

  it('já connected no banco: não re-escreve lastConnectionAt a cada sondagem', async () => {
    const original = new Date('2026-09-20T10:00:00Z');
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', lastConnectionAt: original })] });
    getConnectionStateMock.mockResolvedValue('connected');

    await getWhatsAppInstanceStatus('i1');

    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.lastConnectionAt).toBe(original); // nenhum update disparado — já estava connected.
  });
});

describe('getWhatsAppInstanceQr — regressão: continua chamando connect (comportamento inalterado)', () => {
  it('chama connect (não getConnectionState) e devolve o QR', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending' })] });
    connectMock.mockResolvedValue({ state: 'connecting', qr: { base64: 'abc123', pairingCode: null } });

    const res = await getWhatsAppInstanceQr('i1');

    expect(connectMock).toHaveBeenCalledWith('inno-1');
    expect(getConnectionStateMock).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'qr_pending', qrCodeBase64: 'abc123', expiresInSeconds: 60 });
  });
});

describe('createWhatsAppInstance — 🆕 correção do webhook mudo (2026-09-23): captura a credencial PRÓPRIA da instância', () => {
  const MASTER_KEY = randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env.EVOLUTION_MASTER_KEY = MASTER_KEY;
    requireActiveEvolutionServerMock.mockResolvedValue({ id: 'srv-1', baseUrl: 'https://evo.example.com' });
  });

  afterEach(() => {
    delete process.env.EVOLUTION_MASTER_KEY;
  });

  it('quando a Evolution devolve apiKey própria no create — cifra e grava nas colunas instanceApiKey*, decifra de volta igual ao valor original', async () => {
    const createInstanceMock = vi.fn().mockResolvedValue({
      instanceName: 'inno-xyz',
      instanceId: 'evo-1',
      state: 'disconnected',
      qr: { base64: 'abc', pairingCode: null },
      apiKey: 'chave-da-instancia-123',
    });
    const setWebhookMock = vi.fn().mockResolvedValue(undefined);
    getEvolutionClientForServerMock.mockReturnValue({ createInstance: createInstanceMock, setWebhook: setWebhookMock });

    await createWhatsAppInstance({ name: 'Vendas SP', evolutionServerId: 'srv-1', startWarmup: true }, 'user-1');

    expect(setWebhookMock).toHaveBeenCalledWith('inno-xyz', { url: 'https://app.example.com/api/webhooks/evolution/instance-key-abc' });
    const saved = getFakeDbState().whatsAppInstances[0] as unknown as {
      instanceApiKeyCiphertext: Uint8Array;
      instanceApiKeyIv: Uint8Array;
      instanceApiKeyAuthTag: Uint8Array;
      instanceApiKeyKeyVersion: number;
    };
    expect(saved.instanceApiKeyCiphertext).toBeDefined();
    expect(
      decryptEvolutionApiKey({
        apiKeyCiphertext: saved.instanceApiKeyCiphertext,
        apiKeyIv: saved.instanceApiKeyIv,
        apiKeyAuthTag: saved.instanceApiKeyAuthTag,
        apiKeyKeyVersion: saved.instanceApiKeyKeyVersion,
      }),
    ).toBe('chave-da-instancia-123');
  });

  it('quando a Evolution NÃO devolve apiKey própria (apiKey: null) — cria a instância normalmente, sem colunas de credencial própria (cai no fallback do servidor)', async () => {
    const createInstanceMock = vi.fn().mockResolvedValue({
      instanceName: 'inno-xyz',
      instanceId: 'evo-1',
      state: 'disconnected',
      qr: { base64: 'abc', pairingCode: null },
      apiKey: null,
    });
    const setWebhookMock = vi.fn().mockResolvedValue(undefined);
    getEvolutionClientForServerMock.mockReturnValue({ createInstance: createInstanceMock, setWebhook: setWebhookMock });

    const result = await createWhatsAppInstance({ name: 'Vendas SP', evolutionServerId: 'srv-1', startWarmup: true }, 'user-1');

    expect(result.status).toBe('qr_pending');
    const saved = getFakeDbState().whatsAppInstances[0] as unknown as { instanceApiKeyCiphertext?: Uint8Array };
    expect(saved.instanceApiKeyCiphertext).toBeUndefined();
  });
});
