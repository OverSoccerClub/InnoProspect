/**
 * evolution-server-crypto.test.ts — cifra em repouso da credencial de
 * `EvolutionServer` (Fase 4.B). Testa a implementação REAL de
 * `node:crypto` (sem mock — é criptografia de verdade, não faz sentido
 * fingir) contra as garantias exigidas pelo schema Prisma: AES-256-GCM, IV
 * de 12 bytes, auth tag de 16 bytes, nunca devolve texto parcial se a auth
 * tag não validar.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentEvolutionMasterKeyVersion,
  decryptEvolutionApiKey,
  encryptEvolutionApiKey,
  EvolutionCryptoError,
  resolveEvolutionMasterKey,
  type EncryptedEvolutionApiKey,
} from './evolution-server-crypto';

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
  beforeEach(() => {
    process.env.EVOLUTION_MASTER_KEY = randomMasterKeyBase64();
    delete process.env.EVOLUTION_MASTER_KEY_VERSION;
  });
  afterEach(() => {
    delete process.env.EVOLUTION_MASTER_KEY;
    delete process.env.EVOLUTION_MASTER_KEY_VERSION;
  });

  it('cifra e decifra de volta para o MESMO texto puro', () => {
    const encrypted = encryptEvolutionApiKey('minha-chave-super-secreta-da-evolution');
    const decrypted = decryptEvolutionApiKey(toRow(encrypted));
    expect(decrypted).toBe('minha-chave-super-secreta-da-evolution');
  });

  it('IV tem 12 bytes e auth tag tem 16 bytes (formato exigido pelo schema Prisma)', () => {
    const encrypted = encryptEvolutionApiKey('qualquer-chave');
    expect(encrypted.iv).toHaveLength(12);
    expect(encrypted.authTag).toHaveLength(16);
  });

  it('duas cifragens da MESMA chave produzem IV e ciphertext DIFERENTES (nunca reaproveita IV)', () => {
    const a = encryptEvolutionApiKey('mesma-chave');
    const b = encryptEvolutionApiKey('mesma-chave');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('grava keyVersion = currentEvolutionMasterKeyVersion() (default 1)', () => {
    const encrypted = encryptEvolutionApiKey('chave');
    expect(encrypted.keyVersion).toBe(1);
    expect(currentEvolutionMasterKeyVersion()).toBe(1);
  });

  it('lança EvolutionCryptoError para apiKey vazia — nunca cifra string vazia', () => {
    expect(() => encryptEvolutionApiKey('')).toThrow(EvolutionCryptoError);
    expect(() => encryptEvolutionApiKey('   ')).toThrow(EvolutionCryptoError);
  });

  it('adulterar o ciphertext faz a decifra FALHAR (auth tag do GCM detecta) — nunca devolve texto parcial', () => {
    const encrypted = encryptEvolutionApiKey('chave-original');
    const row = toRow(encrypted);
    const tampered = { ...row, apiKeyCiphertext: Buffer.concat([row.apiKeyCiphertext.subarray(0, -1), Buffer.from([row.apiKeyCiphertext.at(-1)! ^ 0xff])]) };
    expect(() => decryptEvolutionApiKey(tampered)).toThrow(EvolutionCryptoError);
  });

  it('adulterar a auth tag faz a decifra FALHAR', () => {
    const encrypted = encryptEvolutionApiKey('chave-original');
    const row = toRow(encrypted);
    const tampered = { ...row, apiKeyAuthTag: Buffer.from(row.apiKeyAuthTag).fill(0) };
    expect(() => decryptEvolutionApiKey(tampered)).toThrow(EvolutionCryptoError);
  });

  it('decifrar com a chave-mestre ERRADA falha (não decifra "quase certo")', () => {
    const encrypted = encryptEvolutionApiKey('chave-original');
    process.env.EVOLUTION_MASTER_KEY = randomMasterKeyBase64(); // troca a chave DEPOIS de cifrar
    expect(() => decryptEvolutionApiKey(toRow(encrypted))).toThrow(EvolutionCryptoError);
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
    process.env.EVOLUTION_MASTER_KEY = keyV1; // versão "atual" quando a linha foi cifrada
    const encryptedWithV1 = encryptEvolutionApiKey('chave-antiga');

    // Rotação: EVOLUTION_MASTER_KEY passa a ser a v2, e a v1 antiga fica preservada sob o nome versionado.
    process.env.EVOLUTION_MASTER_KEY = keyV2;
    process.env.EVOLUTION_MASTER_KEY_VERSION = '2';
    process.env.EVOLUTION_MASTER_KEY_V1 = keyV1;

    expect(decryptEvolutionApiKey(toRow(encryptedWithV1))).toBe('chave-antiga'); // ainda decifra com a v1, mesmo com a "atual" já sendo v2
    delete process.env.EVOLUTION_MASTER_KEY_V1;
    delete process.env.EVOLUTION_MASTER_KEY_VERSION;
  });
});
