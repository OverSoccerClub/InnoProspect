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
import { resetFakeDb, type FakeCampaign, type FakeWhatsAppInstance } from '@/test/fake-db';

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

const { getWhatsAppInstanceQr, getWhatsAppInstanceStatus, createWhatsAppInstance, listWhatsAppInstances, reconcileAllWhatsAppInstances } = await import(
  './whatsapp-instances'
);
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
    statusCheckedAt: null,
    evolutionInstanceName: 'inno-1',
    name: 'Instância',
    ...overrides,
  };
}

function campaign(overrides: Partial<FakeCampaign> & Pick<FakeCampaign, 'id'>): FakeCampaign {
  return {
    status: 'running',
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    respondedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    haltReason: null,
    instanceIds: [],
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

describe('listWhatsAppInstances — reconciliação de status (2026-09-24, incidente do dono: "mesmo desconectado, o sistema ainda mostra como conectado")', () => {
  it('Evolution confirma DESCONECTADA uma instância que o banco achava CONECTADA — muda o status E halta as campanhas que dependiam só dela (a correção do incidente)', async () => {
    resetFakeDb({
      whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: null })],
      campaigns: [
        campaign({ id: 'camp-sole', status: 'running', instanceIds: ['i1'] }),
        campaign({ id: 'camp-shared', status: 'running', instanceIds: ['i1', 'i2'] }),
      ],
    });
    getConnectionStateMock.mockResolvedValue('disconnected');

    const res = await listWhatsAppInstances();

    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.status).toBe('disconnected');
    expect(res.data[0]!.statusCheckedAt).not.toBeNull();
    const state = getFakeDbState();
    expect(state.whatsAppInstances[0]!.status).toBe('disconnected');
    expect(state.campaigns.find((c) => c.id === 'camp-sole')?.status).toBe('halted');
    expect(state.campaigns.find((c) => c.id === 'camp-shared')?.status).toBe('running');
    expect(sendAlertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'instance_disconnected', instanceId: 'i1', reason: 'disconnected' }));
  });

  it('Evolution fora do ar (lança) — a lista responde com o ÚLTIMO estado conhecido, e statusCheckedAt NÃO avança', async () => {
    const before = new Date('2026-09-20T10:00:00Z');
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: before })] });
    getConnectionStateMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await listWhatsAppInstances();

    expect(res.data[0]!.status).toBe('connected'); // último estado conhecido, não regride.
    expect(res.data[0]!.statusCheckedAt).toBe(before.toISOString());
    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.statusCheckedAt).toBe(before); // nunca avançou.
  });

  it('instância em qr_pending NÃO é reconciliada — getConnectionState nem é chamado', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending', statusCheckedAt: null })] });

    const res = await listWhatsAppInstances();

    expect(getConnectionStateMock).not.toHaveBeenCalled();
    expect(res.data[0]!.status).toBe('qr_pending');
  });

  it('limite de frescor: duas leituras seguidas, statusCheckedAt ainda fresco, fazem só UMA consulta à Evolution', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: null })] });
    getConnectionStateMock.mockResolvedValue('connected');

    await listWhatsAppInstances(); // 1ª leitura: statusCheckedAt era null (obsoleto) — consulta a Evolution.
    await listWhatsAppInstances(); // 2ª leitura, imediatamente depois: statusCheckedAt fresco — NÃO deveria consultar de novo.

    expect(getConnectionStateMock).toHaveBeenCalledTimes(1);
  });

  it('instância já connected e Evolution confirma connected de novo — sem transição, sem alerta, só statusCheckedAt avança', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: null })] });
    getConnectionStateMock.mockResolvedValue('connected');

    await listWhatsAppInstances();

    expect(sendAlertMock).not.toHaveBeenCalled();
    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.status).toBe('connected');
    expect(saved?.statusCheckedAt).toBeInstanceOf(Date);
  });

  it('timeout duro: se a Evolution nunca responde, a reconciliação desiste sozinha e a lista responde com o estado anterior (não trava)', async () => {
    vi.useFakeTimers();
    try {
      resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: null })] });
      getConnectionStateMock.mockReturnValue(new Promise<never>(() => {})); // nunca resolve nem rejeita.

      const pending = listWhatsAppInstances();
      await vi.runAllTimersAsync();
      const res = await pending;

      expect(res.data[0]!.status).toBe('connected');
      const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
      expect(saved?.statusCheckedAt).toBeNull(); // desistiu — nunca confirmou.
    } finally {
      vi.useRealTimers();
    }
  });

  it('Evolution diz "connecting" (reconectando sozinha) — NÃO é tratado como queda: sem kill switch, sem alerta, só reflete o estado intermediário', async () => {
    resetFakeDb({
      whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: null })],
      campaigns: [campaign({ id: 'camp-sole', status: 'running', instanceIds: ['i1'] })],
    });
    getConnectionStateMock.mockResolvedValue('connecting');

    const res = await listWhatsAppInstances();

    expect(res.data[0]!.status).toBe('connecting');
    expect(sendAlertMock).not.toHaveBeenCalled();
    expect(getFakeDbState().campaigns.find((c) => c.id === 'camp-sole')?.status).toBe('running');
  });
});

describe('reconcileAllWhatsAppInstances — reconciliação FORÇADA (POST .../reconcile)', () => {
  it('ignora o limite de frescor: instância recém-confirmada É reconciliada de novo mesmo assim', async () => {
    const justNow = new Date();
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected', statusCheckedAt: justNow })] });
    getConnectionStateMock.mockResolvedValue('connected');

    await reconcileAllWhatsAppInstances();

    expect(getConnectionStateMock).toHaveBeenCalledTimes(1);
  });

  it('cobre instância que NÃO está connected — se a Evolution já confirma conectada, sobe (direção segura, mesma dos outros endpoints)', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending', statusCheckedAt: null })] });
    getConnectionStateMock.mockResolvedValue('connected');

    const res = await reconcileAllWhatsAppInstances();

    expect(res.data[0]!.status).toBe('connected');
  });

  it('instância qr_pending cuja Evolution ainda não confirma conectada — não sobrescreve o status (evita quebrar o modal de QR aberto)', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'qr_pending', statusCheckedAt: null })] });
    getConnectionStateMock.mockResolvedValue('disconnected');

    const res = await reconcileAllWhatsAppInstances();

    expect(res.data[0]!.status).toBe('qr_pending');
    const saved = getFakeDbState().whatsAppInstances.find((i) => i.id === 'i1');
    expect(saved?.statusCheckedAt).toBeInstanceOf(Date); // confirmado, mesmo sem mudar o status.
  });

  // Estes três provam o `unconfirmed`, que é o que autoriza a TELA a dizer
  // "confirmei". A rota devolve `200` mesmo com a Evolution fora do ar (a
  // reconciliação nunca quebra a leitura) — sem este contador, "não deu erro"
  // e "eu confirmei" seriam a mesma resposta, e o botão "Verificar agora"
  // daria um sucesso silencioso com a Evolution inteira inacessível.
  it('todas confirmadas → unconfirmed = 0', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected' }), instance({ id: 'i2', status: 'connected' })] });
    getConnectionStateMock.mockResolvedValue('connected');

    const res = await reconcileAllWhatsAppInstances();

    expect(res.unconfirmed).toBe(0);
  });

  it('Evolution fora do ar para TODAS → unconfirmed conta todas, e a resposta ainda é a lista (nunca erro)', async () => {
    resetFakeDb({ whatsAppInstances: [instance({ id: 'i1', status: 'connected' }), instance({ id: 'i2', status: 'connected' })] });
    getConnectionStateMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await reconcileAllWhatsAppInstances();

    expect(res.unconfirmed).toBe(2);
    expect(res.data).toHaveLength(2);
    expect(res.data.every((i) => i.statusCheckedAt === null)).toBe(true);
  });

  it('sucesso PARCIAL → unconfirmed conta só as que falharam, e as que deram certo ficam frescas', async () => {
    resetFakeDb({
      whatsAppInstances: [
        instance({ id: 'i1', status: 'connected', evolutionInstanceName: 'inno-i1' }),
        instance({ id: 'i2', status: 'connected', evolutionInstanceName: 'inno-i2' }),
      ],
    });
    getConnectionStateMock.mockImplementation(async (nome: string) => {
      if (nome === 'inno-i2') throw new Error('ETIMEDOUT');
      return 'connected';
    });

    const res = await reconcileAllWhatsAppInstances();

    expect(res.unconfirmed).toBe(1);
    expect(res.data.find((i) => i.id === 'i1')!.statusCheckedAt).not.toBeNull();
    expect(res.data.find((i) => i.id === 'i2')!.statusCheckedAt).toBeNull();
  });
});
