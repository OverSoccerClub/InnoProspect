/**
 * evolution-crypto.test.ts — cifra em repouso da credencial de
 * `EvolutionServer` (Fase 4.B, movido de `apps/web` na Fase 4.F.4 — ver
 * cabeçalho de `evolution-crypto.ts`). Testa a implementação REAL de
 * `node:crypto` (sem mock — é criptografia de verdade, não faz sentido
 * fingir) contra as garantias exigidas pelo schema Prisma: AES-256-GCM, IV
 * de 12 bytes, auth tag de 16 bytes, nunca devolve texto parcial se a auth
 * tag não validar.
 *
 * `env` agora é parâmetro OBRIGATÓRIO em toda chamada (sem default
 * `process.env`, ver cabeçalho do módulo) — cada teste monta o dicionário e
 * passa explicitamente, em vez de mutar `process.env` global.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  currentEvolutionMasterKeyVersion,
  decryptEvolutionApiKey,
  encryptEvolutionApiKey,
  EvolutionCryptoError,
  resolveEvolutionMasterKey,
  type EncryptedEvolutionApiKey,
  type EvolutionCryptoEnv,
} from './evolution-crypto.js';

function randomMasterKeyBase64(): string {
  return randomBytes(32).toString('base64');
}

/** `decryptEvolutionApiKey` recebe o formato de LINHA do Prisma (`apiKeyCiphertext`/`apiKeyIv`/`apiKeyAuthTag`/`apiKeyKeyVersion`) — `encryptEvolutionApiKey` devolve o formato "de saída" (`ciphertext`/`iv`/`authTag`/`keyVersion`). Este helper faz a ponte, só nos testes. */
function toRow(encrypted: EncryptedEvolutionApiKey) {
  return {
    apiKeyCiphertext: encrypted.ciphertext,
    apiKeyIv: encrypted.iv,
    apiKeyAuthTag: encrypted.authTag,
    apiKeyKeyVersion: encrypted.keyVersion,
  };
}

describe('encryptEvolutionApiKey / decryptEvolutionApiKey — ida e volta', () => {
  function envWithMasterKey(overrides: EvolutionCryptoEnv = {}): EvolutionCryptoEnv {
    return { EVOLUTION_MASTER_KEY: randomMasterKeyBase64(), ...overrides };
  }

  it('cifra e decifra de volta para o MESMO texto puro', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('minha-chave-super-secreta-da-evolution', env);
    const decrypted = decryptEvolutionApiKey(toRow(encrypted), env);
    expect(decrypted).toBe('minha-chave-super-secreta-da-evolution');
  });

  it('IV tem 12 bytes e auth tag tem 16 bytes (formato exigido pelo schema Prisma)', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('qualquer-chave', env);
    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.authTag).toHaveLength(16);
  });

  it('duas cifragens da MESMA chave produzem IV e ciphertext DIFERENTES (nunca reaproveita IV)', () => {
    const env = envWithMasterKey();
    const a = encryptEvolutionApiKey('mesma-chave', env);
    const b = encryptEvolutionApiKey('mesma-chave', env);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('grava keyVersion = currentEvolutionMasterKeyVersion() (default 1)', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('chave', env);
    expect(encrypted.keyVersion).toBe(1);
    expect(currentEvolutionMasterKeyVersion(env)).toBe(1);
  });

  it('lança EvolutionCryptoError para apiKey vazia — nunca cifra string vazia', () => {
    const env = envWithMasterKey();
    expect(() => encryptEvolutionApiKey('', env)).toThrow(EvolutionCryptoError);
    expect(() => encryptEvolutionApiKey('   ', env)).toThrow(EvolutionCryptoError);
  });

  it('adulterar o ciphertext faz a decifra FALHAR (auth tag do GCM detecta) — nunca devolve texto parcial', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('chave-original', env);
    const row = toRow(encrypted);
    const tampered = { ...row, apiKeyCiphertext: Buffer.concat([row.apiKeyCiphertext.subarray(0, -1), Buffer.from([row.apiKeyCiphertext.at(-1)! ^ 0xff])]) };
    expect(() => decryptEvolutionApiKey(tampered, env)).toThrow(EvolutionCryptoError);
  });

  it('adulterar a auth tag faz a decifra FALHAR', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('chave-original', env);
    const row = toRow(encrypted);
    const tampered = { ...row, apiKeyAuthTag: Buffer.from(row.apiKeyAuthTag).fill(0) };
    expect(() => decryptEvolutionApiKey(tampered, env)).toThrow(EvolutionCryptoError);
  });

  it('decifrar com a chave-mestre ERRADA falha (não decifra "quase certo")', () => {
    const env = envWithMasterKey();
    const encrypted = encryptEvolutionApiKey('chave-original', env);
    const envDepoisDaTroca = { EVOLUTION_MASTER_KEY: randomMasterKeyBase64() }; // troca a chave DEPOIS de cifrar
    expect(() => decryptEvolutionApiKey(toRow(encrypted), envDepoisDaTroca)).toThrow(EvolutionCryptoError);
  });
});

describe('resolveEvolutionMasterKey — configuração', () => {
  it('lança EvolutionCryptoError se EVOLUTION_MASTER_KEY estiver ausente', () => {
    expect(() => resolveEvolutionMasterKey(1, {})).toThrow(EvolutionCryptoError);
  });

  it('lança EvolutionCryptoError se a chave decodificada NÃO tiver 32 bytes (AES-256)', () => {
    expect(() => resolveEvolutionMasterKey(1, { EVOLUTION_MASTER_KEY: Buffer.from('curta-demais').toString('base64') })).toThrow(
      EvolutionCryptoError,
    );
  });

  it('versão != 1 procura EVOLUTION_MASTER_KEY_V{version} — suporte a rotação futura', () => {
    const keyV2 = randomMasterKeyBase64();
    const resolved = resolveEvolutionMasterKey(2, { EVOLUTION_MASTER_KEY_V2: keyV2 });
    expect(resolved.toString('base64')).toBe(keyV2);
  });

  it('decryptEvolutionApiKey usa a versão GRAVADA NA LINHA, não a versão atual — sustenta rotação sem recifrar tudo de uma vez', () => {
    const keyV1 = randomMasterKeyBase64();
    const keyV2 = randomMasterKeyBase64();
    const encryptedWithV1 = encryptEvolutionApiKey('chave-antiga', { EVOLUTION_MASTER_KEY: keyV1 }); // versão "atual" quando a linha foi cifrada

    // Rotação: EVOLUTION_MASTER_KEY passa a ser a v2, e a v1 antiga fica preservada sob o nome versionado.
    const envDepoisDaRotacao: EvolutionCryptoEnv = {
      EVOLUTION_MASTER_KEY: keyV2,
      EVOLUTION_MASTER_KEY_VERSION: '2',
      EVOLUTION_MASTER_KEY_V1: keyV1,
    };

    expect(decryptEvolutionApiKey(toRow(encryptedWithV1), envDepoisDaRotacao)).toBe('chave-antiga'); // ainda decifra com a v1, mesmo com a "atual" já sendo v2
  });
});
