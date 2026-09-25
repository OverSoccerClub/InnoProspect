/**
 * evolution.test.ts — camada fina do worker sobre `@inno/sending`
 * (`resolveInstanceEvolutionClient`, `evolution-resolver.ts`). Não retesta a
 * cifra em si (já cobre `packages/sending/src/evolution-crypto.test.ts`) —
 * só a POLÍTICA DE ERRO do worker: nunca lança por servidor ausente/inativo,
 * e o fallback legado (env) funciona quando `evolutionServerId` é nulo.
 */
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptEvolutionApiKey, type EvolutionCryptoEnv } from '@inno/sending';
import type { WorkerEvolutionResolveDeps } from './evolution.js';
import { resetLegacyEnvEvolutionClientCacheForTest, resolveWorkerEvolutionClient } from './evolution.js';

function envWithMasterKey(): EvolutionCryptoEnv {
  return { EVOLUTION_MASTER_KEY: randomBytes(32).toString('base64') };
}

function fakePrisma(server: unknown): WorkerEvolutionResolveDeps['prisma'] {
  return { evolutionServer: { findUnique: async () => server } } as unknown as WorkerEvolutionResolveDeps['prisma'];
}

describe('resolveWorkerEvolutionClient', () => {
  beforeEach(() => {
    resetLegacyEnvEvolutionClientCacheForTest();
  });

  it('evolutionServerId presente e servidor ativo: resolve o cliente decifrando a credencial', async () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('chave-do-servidor', env);
    const server = {
      baseUrl: 'https://evolution.example.com',
      isActive: true,
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyAuthTag: encrypted.authTag,
      apiKeyKeyVersion: encrypted.keyVersion,
    };

    const result = await resolveWorkerEvolutionClient({ prisma: fakePrisma(server), env }, { evolutionServerId: 'srv-1' });

    expect(result.outcome).toBe('resolved');
  });

  it('evolutionServerId presente mas servidor NÃO existe: outcome server_not_found (nunca lança)', async () => {
    const result = await resolveWorkerEvolutionClient(
      { prisma: fakePrisma(null), env: envWithMasterKey() },
      { evolutionServerId: 'srv-inexistente' },
    );
    expect(result.outcome).toBe('server_not_found');
  });

  it('servidor existe mas está INATIVO: outcome server_inactive', async () => {
    const server = { baseUrl: 'x', isActive: false, apiKeyCiphertext: Buffer.alloc(0), apiKeyIv: Buffer.alloc(12), apiKeyAuthTag: Buffer.alloc(16), apiKeyKeyVersion: 1 };
    const result = await resolveWorkerEvolutionClient({ prisma: fakePrisma(server), env: envWithMasterKey() }, { evolutionServerId: 'srv-1' });
    expect(result.outcome).toBe('server_inactive');
  });

  it('evolutionServerId nulo (instância legada): cai no fallback EVOLUTION_API_URL/EVOLUTION_API_KEY, nunca lança', async () => {
    const env: EvolutionCryptoEnv = { EVOLUTION_API_URL: 'http://localhost:8080', EVOLUTION_API_KEY: 'legacy-key' };
    const result = await resolveWorkerEvolutionClient({ prisma: fakePrisma(null), env }, { evolutionServerId: null });
    expect(result.outcome).toBe('resolved');
  });
});
