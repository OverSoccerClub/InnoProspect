/**
 * evolution-servers.test.ts — CRUD de `EvolutionServer` + teste de conexão
 * (Fase 4.B). Usa a cifra REAL (`@inno/sending`, sem mock —
 * é o comportamento que precisamos comprovar: a credencial NUNCA sai em
 * texto puro de nenhuma resposta) contra o fake db compartilhado
 * (`@/test/fake-db`, mesmo padrão de `users.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { CreateEvolutionServerBody, UpdateEvolutionServerBody } from '@inno/contracts';
import type * as InnoDb from '@inno/db';
import type * as InnoMessaging from '@inno/messaging';
import { getFakeDbState, resetFakeDb, type FakeEvolutionServer } from '@/test/fake-db';

vi.mock('@inno/db', async (importOriginal) => {
  const actual = await importOriginal<typeof InnoDb>();
  const { fakePrismaClient } = await import('@/test/fake-db');
  return { ...actual, prisma: fakePrismaClient };
});
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const sendTextMock = vi.hoisted(() => vi.fn());
const testConnectionMock = vi.hoisted(() => vi.fn());
vi.mock('@inno/messaging', async (importOriginal) => {
  const actual = await importOriginal<typeof InnoMessaging>();
  return {
    ...actual,
    EvolutionClient: vi.fn().mockImplementation(() => ({ sendText: sendTextMock, testConnection: testConnectionMock })),
  };
});

const {
  createEvolutionServer,
  deactivateEvolutionServer,
  getEvolutionServerDetail,
  listEvolutionServers,
  testEvolutionServerConnection,
  updateEvolutionServer,
} = await import('./evolution-servers');

function evolutionServer(overrides: Partial<FakeEvolutionServer> & Pick<FakeEvolutionServer, 'id'>): FakeEvolutionServer {
  const now = new Date('2026-09-23T10:00:00Z');
  return {
    name: 'Servidor 1',
    baseUrl: 'https://evolution1.example.com',
    isActive: true,
    apiKeyCiphertext: Buffer.from(''),
    apiKeyIv: Buffer.from(''),
    apiKeyAuthTag: Buffer.from(''),
    apiKeyKeyVersion: 1,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createBody(overrides: Partial<CreateEvolutionServerBody> = {}): CreateEvolutionServerBody {
  return { name: 'Servidor Novo', baseUrl: 'https://evolution2.example.com', apiKey: 'chave-secreta-abc', ...overrides };
}

beforeEach(() => {
  resetFakeDb();
  process.env.EVOLUTION_MASTER_KEY = randomBytes(32).toString('base64');
  delete process.env.EVOLUTION_MASTER_KEY_VERSION;
  sendTextMock.mockReset();
  testConnectionMock.mockReset();
});

afterEach(() => {
  delete process.env.EVOLUTION_MASTER_KEY;
});

describe('createEvolutionServer', () => {
  it('cifra a apiKey (nunca grava/devolve o texto puro) e normaliza a baseUrl (sem barra final)', async () => {
    const result = await createEvolutionServer(createBody({ baseUrl: 'https://evolution2.example.com/' }), 'user-1');

    expect(result.baseUrl).toBe('https://evolution2.example.com'); // sem barra final
    expect(result.hasApiKey).toBe(true);
    expect(result).not.toHaveProperty('apiKey');

    const stored = getFakeDbState().evolutionServers[0]!;
    expect(stored.apiKeyCiphertext.toString('utf8')).not.toContain('chave-secreta-abc'); // nunca em texto puro
    expect(stored.apiKeyIv).toHaveLength(12);
    expect(stored.apiKeyAuthTag).toHaveLength(16);
  });

  it('409 CONFLICT se já existir um servidor com a MESMA baseUrl (normalizada)', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1', baseUrl: 'https://evolution1.example.com' })] });

    await expect(createEvolutionServer(createBody({ baseUrl: 'https://evolution1.example.com/' }), 'user-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'SERVER_BASE_URL_TAKEN',
    });
  });

  it('instancesCount começa em 0 para um servidor recém-criado', async () => {
    const result = await createEvolutionServer(createBody(), 'user-1');
    expect(result.instancesCount).toBe(0);
  });
});

describe('listEvolutionServers / getEvolutionServerDetail', () => {
  it('listagem NUNCA inclui a credencial — só hasApiKey (booleano)', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1' })] });

    const result = await listEvolutionServers();

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).not.toHaveProperty('apiKey');
    expect(result.data[0]).not.toHaveProperty('apiKeyCiphertext');
    expect(result.data[0]!.hasApiKey).toBe(true);
  });

  it('instancesCount conta apenas WhatsAppInstance apontando para o servidor', async () => {
    resetFakeDb({
      evolutionServers: [evolutionServer({ id: 'srv-1' }), evolutionServer({ id: 'srv-2', baseUrl: 'https://evolution2.example.com' })],
      whatsAppInstances: [
        { id: 'inst-1', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, evolutionServerId: 'srv-1', isActive: true },
        { id: 'inst-2', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, evolutionServerId: 'srv-1', isActive: true },
      ],
    });

    const result = await listEvolutionServers();

    expect(result.data.find((s) => s.id === 'srv-1')?.instancesCount).toBe(2);
    expect(result.data.find((s) => s.id === 'srv-2')?.instancesCount).toBe(0);
  });

  it('getEvolutionServerDetail 404 se o id não existir', async () => {
    await expect(getEvolutionServerDetail('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND', reason: 'SERVER_NOT_FOUND' });
  });
});

describe('updateEvolutionServer', () => {
  it('rotaciona a apiKey quando informada — recifra com a versão ATUAL, nunca devolve o valor', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1' })] });
    const patch: UpdateEvolutionServerBody = { apiKey: 'chave-nova-rotacionada' };

    const result = await updateEvolutionServer('srv-1', patch);

    expect(result).not.toHaveProperty('apiKey');
    const stored = getFakeDbState().evolutionServers.find((s) => s.id === 'srv-1')!;
    expect(stored.apiKeyCiphertext.toString('utf8')).not.toContain('chave-nova-rotacionada');
  });

  it('sem apiKey no patch — credencial permanece intocada', async () => {
    const original = evolutionServer({ id: 'srv-1', apiKeyCiphertext: Buffer.from('original-cipher') });
    resetFakeDb({ evolutionServers: [original] });

    await updateEvolutionServer('srv-1', { name: 'Novo nome' });

    const stored = getFakeDbState().evolutionServers.find((s) => s.id === 'srv-1')!;
    expect(stored.apiKeyCiphertext.toString('utf8')).toBe('original-cipher');
    expect(stored.name).toBe('Novo nome');
  });

  it('409 se a nova baseUrl já pertencer a OUTRO servidor', async () => {
    resetFakeDb({
      evolutionServers: [evolutionServer({ id: 'srv-1' }), evolutionServer({ id: 'srv-2', baseUrl: 'https://evolution2.example.com' })],
    });

    await expect(updateEvolutionServer('srv-1', { baseUrl: 'https://evolution2.example.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
      reason: 'SERVER_BASE_URL_TAKEN',
    });
  });

  it('404 se o id não existir', async () => {
    await expect(updateEvolutionServer('nao-existe', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('deactivateEvolutionServer', () => {
  it('desativa (isActive:false) quando não há instância ATIVA apontando para o servidor', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1' })] });

    await deactivateEvolutionServer('srv-1');

    expect(getFakeDbState().evolutionServers.find((s) => s.id === 'srv-1')?.isActive).toBe(false);
  });

  it('409 SERVER_IN_USE se houver instância ATIVA apontando para o servidor', async () => {
    resetFakeDb({
      evolutionServers: [evolutionServer({ id: 'srv-1' })],
      whatsAppInstances: [
        { id: 'inst-1', status: 'connected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, evolutionServerId: 'srv-1', isActive: true },
      ],
    });

    await expect(deactivateEvolutionServer('srv-1')).rejects.toMatchObject({ code: 'CONFLICT', reason: 'SERVER_IN_USE' });
    expect(getFakeDbState().evolutionServers[0]!.isActive).toBe(true); // não mudou
  });

  it('NÃO bloqueia se a(s) instância(s) apontando para o servidor já estiverem INATIVAS', async () => {
    resetFakeDb({
      evolutionServers: [evolutionServer({ id: 'srv-1' })],
      whatsAppInstances: [
        { id: 'inst-1', status: 'disconnected', isDegraded: false, consecutiveFailures: 0, lastConnectionAt: null, lastErrorAt: null, lastErrorMessage: null, evolutionServerId: 'srv-1', isActive: false },
      ],
    });

    await deactivateEvolutionServer('srv-1');

    expect(getFakeDbState().evolutionServers[0]!.isActive).toBe(false);
  });

  it('idempotente — desativar um servidor JÁ inativo é um no-op silencioso', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1', isActive: false })] });

    await expect(deactivateEvolutionServer('srv-1')).resolves.toBeUndefined();
  });

  it('404 se o id não existir', async () => {
    await expect(deactivateEvolutionServer('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('testEvolutionServerConnection', () => {
  /** As duas primeiras asserções (sucesso/MessagingError) exigem que a decifra funcione DE VERDADE — sem isso `testConnectionMock` nunca chega a ser chamado (a função já teria devolvido CONFIG_ERROR antes). */
  async function seedServerWithRealEncryptedKey(id = 'srv-1'): Promise<void> {
    const { encryptEvolutionApiKey } = await import('@inno/sending');
    const encrypted = encryptEvolutionApiKey('chave-real-do-servidor', process.env);
    resetFakeDb({
      evolutionServers: [
        evolutionServer({ id, apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyAuthTag: encrypted.authTag, apiKeyKeyVersion: encrypted.keyVersion }),
      ],
    });
  }

  it('sucesso — decifra a credencial, chama EvolutionClient.testConnection e devolve ok:true com latência', async () => {
    await seedServerWithRealEncryptedKey();
    testConnectionMock.mockResolvedValue(undefined);

    const result = await testEvolutionServerConnection('srv-1');

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(testConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('falha da Evolution (MessagingError) — devolve ok:false com code/message, NUNCA lança (o teste é o resultado, não um erro de rota)', async () => {
    const { MessagingError } = await import('@inno/messaging');
    await seedServerWithRealEncryptedKey();
    testConnectionMock.mockRejectedValue(new MessagingError('AUTH_ERROR', 'Unauthorized'));

    const result = await testEvolutionServerConnection('srv-1');

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: 'AUTH_ERROR', message: 'Unauthorized' });
  });

  it('erro de configuração (chave-mestre errada) — devolve ok:false/CONFIG_ERROR, NUNCA lança', async () => {
    resetFakeDb({ evolutionServers: [evolutionServer({ id: 'srv-1', apiKeyCiphertext: Buffer.from('lixo'), apiKeyIv: Buffer.alloc(12), apiKeyAuthTag: Buffer.alloc(16) })] });

    const result = await testEvolutionServerConnection('srv-1');

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFIG_ERROR');
    expect(testConnectionMock).not.toHaveBeenCalled(); // nem chegou a tentar a rede
  });

  it('404 se o id não existir', async () => {
    await expect(testEvolutionServerConnection('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
