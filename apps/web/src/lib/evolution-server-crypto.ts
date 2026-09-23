/**
 * lib/evolution-server-crypto.ts — cifra em repouso da credencial de
 * `EvolutionServer.apiKeyCiphertext/apiKeyIv/apiKeyAuthTag/apiKeyKeyVersion`
 * (Fase 4.B, ARQUITETURA §9.1). Formato das colunas é do Cronos
 * (`packages/db/prisma/schema.prisma`, comentário completo no model
 * `EvolutionServer`); a implementação da cifra é deste arquivo.
 *
 * AES-256-GCM, IV de 12 bytes (96 bits, recomendação NIST para GCM), auth
 * tag de 16 bytes. A CHAVE-MESTRE nunca entra no banco — vem de variável de
 * ambiente (`EVOLUTION_MASTER_KEY`), lida só aqui. Este módulo é o ÚNICO
 * lugar do projeto que conhece a chave-mestre — nenhuma rota/serviço lê
 * `EVOLUTION_MASTER_KEY*` diretamente, todas passam por
 * `encryptEvolutionApiKey`/`decryptEvolutionApiKey`.
 *
 * ROTAÇÃO DA CHAVE-MESTRE (ainda não exercitada — nenhuma rotação aconteceu
 * até hoje): `apiKeyKeyVersion` grava QUAL versão cifrou aquela linha.
 * `resolveMasterKey(version)` procura, na ORDEM `EVOLUTION_MASTER_KEY_V
 * {version}` primeiro e `EVOLUTION_MASTER_KEY` (bare) depois — a ordem
 * importa: o alias versionado tem PRIORIDADE sobre o nome bare, porque no
 * dia da rotação `EVOLUTION_MASTER_KEY` passa a apontar para a chave NOVA
 * (o alias explícito é o único jeito de a versão ANTIGA continuar
 * resolvível depois disso). Fora de uma rotação, `EVOLUTION_MASTER_KEY_V1`
 * simplesmente não existe no ambiente e a busca cai no nome bare — é por
 * isso que nenhum deploy precisa saber que "versão" existe até o dia em que
 * rotacionar. Runbook de rotação (quando o dia chegar):
 *   1. Defina `EVOLUTION_MASTER_KEY_V<N-1>` = valor ATUAL de
 *      `EVOLUTION_MASTER_KEY` (preserva a chave antiga sob o nome versionado).
 *   2. Gere uma chave nova e defina `EVOLUTION_MASTER_KEY` = chave nova,
 *      `EVOLUTION_MASTER_KEY_VERSION` = `<N>`.
 *   3. Redeploy. Linhas antigas (`apiKeyKeyVersion = N-1`) continuam
 *      decifrando pela env versionada; toda ESCRITA NOVA (criar servidor,
 *      rotacionar chave de um servidor existente) já cifra com a versão `N`.
 *   4. Rotina operacional (fora do escopo desta entrega, mesma família do
 *      script de bootstrap): ler cada servidor com `apiKeyKeyVersion < N`,
 *      decifrar com a versão antiga e recifrar com a `N`, para eventualmente
 *      poder remover a env antiga do ambiente.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32; // AES-256

/** Erro de CONFIGURAÇÃO (chave-mestre ausente/malformada) ou de INTEGRIDADE (auth tag não valida) — nunca vaza detalhe do ciphertext/chave na mensagem. */
export class EvolutionCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvolutionCryptoError';
  }
}

/**
 * Nomes de env aceitos para a versão dada, em ORDEM de preferência. A
 * versão 1 aceita a forma "sem sufixo" (`EVOLUTION_MASTER_KEY`, o caso
 * comum — nenhum deploy precisa saber que existe "versão" até o dia em que
 * rotacionar) E a forma versionada (`EVOLUTION_MASTER_KEY_V1`) — é esta 2ª
 * forma que sustenta a ROTAÇÃO: no dia em que `EVOLUTION_MASTER_KEY` (o
 * nome bare) passar a apontar para a chave NOVA (versão 2), a chave ANTIGA
 * (versão 1) só continua resolvível se puder ser lida por um nome DIFERENTE
 * do que virou a chave nova — daí o alias `EVOLUTION_MASTER_KEY_V1`. Sem
 * este alias, `resolveEvolutionMasterKey(1, ...)` ficaria permanentemente
 * amarrado ao nome bare, e no instante em que esse nome trocasse de valor
 * (rotação), TODA linha antiga (`apiKeyKeyVersion=1`) ficaria irrecuperável.
 */
function masterKeyEnvVarNames(version: number): string[] {
  return version === 1 ? ['EVOLUTION_MASTER_KEY_V1', 'EVOLUTION_MASTER_KEY'] : [`EVOLUTION_MASTER_KEY_V${version}`];
}

/**
 * Decodifica a chave-mestre da(s) env aceita(s) para `version` (ver
 * `masterKeyEnvVarNames`) — base64, `openssl rand -base64 32` — e valida o
 * tamanho (32 bytes, AES-256). Lança `EvolutionCryptoError` se NENHUMA das
 * envs aceitas estiver presente, ou se o tamanho não bater — nunca segue
 * adiante com uma chave curta/errada silenciosamente.
 */
export function resolveEvolutionMasterKey(version: number, env: Record<string, string | undefined> = process.env): Buffer {
  const names = masterKeyEnvVarNames(version);
  const found = names.map((name) => ({ name, raw: env[name] })).find((entry) => entry.raw !== undefined && entry.raw.length > 0);
  if (!found) {
    throw new EvolutionCryptoError(
      `Chave-mestre da Evolution API não configurada (nenhuma das variáveis "${names.join('", "')}" está definida). Gere com: openssl rand -base64 32`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(found.raw!, 'base64');
  } catch {
    throw new EvolutionCryptoError(`Variável "${found.name}" não é base64 válido.`);
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new EvolutionCryptoError(
      `Variável "${found.name}" precisa decodificar para exatamente ${KEY_LENGTH_BYTES} bytes (AES-256) — recebido ${key.length}.`,
    );
  }
  return key;
}

/** Versão da chave-mestre usada para NOVAS cifragens (`EVOLUTION_MASTER_KEY_VERSION`, default `1`) — grava em `EvolutionServer.apiKeyKeyVersion`. */
export function currentEvolutionMasterKeyVersion(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.EVOLUTION_MASTER_KEY_VERSION ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export type EncryptedEvolutionApiKey = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

/** Cifra `apiKey` em texto puro com a versão ATUAL da chave-mestre. Um IV novo (aleatório, 12 bytes) a cada chamada — nunca reaproveitar IV com a mesma chave (quebra a confidencialidade do GCM). */
export function encryptEvolutionApiKey(apiKey: string, env: Record<string, string | undefined> = process.env): EncryptedEvolutionApiKey {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new EvolutionCryptoError('apiKey não pode ser vazia.');
  }
  const keyVersion = currentEvolutionMasterKeyVersion(env);
  const masterKey = resolveEvolutionMasterKey(keyVersion, env);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag, keyVersion };
}

/**
 * Decifra uma linha de `EvolutionServer` de volta para a `apiKey` em texto
 * puro. Usa a versão da chave-mestre GRAVADA NA LINHA (`keyVersion`), não a
 * atual — é o que sustenta a rotação (ver runbook no topo do arquivo).
 * Lança `EvolutionCryptoError` se a auth tag não validar (dado adulterado
 * ou chave errada) — GCM é AEAD, nunca devolve texto parcial/incerto.
 */
export function decryptEvolutionApiKey(
  row: { apiKeyCiphertext: Uint8Array; apiKeyIv: Uint8Array; apiKeyAuthTag: Uint8Array; apiKeyKeyVersion: number },
  env: Record<string, string | undefined> = process.env,
): string {
  const iv = Buffer.from(row.apiKeyIv);
  const authTag = Buffer.from(row.apiKeyAuthTag);
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new EvolutionCryptoError(`IV com tamanho inesperado (esperado ${IV_LENGTH_BYTES} bytes, recebido ${iv.length}).`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new EvolutionCryptoError(`Auth tag com tamanho inesperado (esperado ${AUTH_TAG_LENGTH_BYTES} bytes, recebido ${authTag.length}).`);
  }
  const masterKey = resolveEvolutionMasterKey(row.apiKeyKeyVersion, env);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.apiKeyCiphertext)), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // `decipher.final()` lança se a auth tag não validar (GCM) — nunca
    // devolver texto parcial. Mensagem genérica: não vaza se o problema foi
    // chave errada ou dado adulterado (mesmo distinguível só por quem tem
    // acesso ao banco E ao ambiente).
    throw new EvolutionCryptoError('Falha ao decifrar a credencial do servidor Evolution (chave-mestre incorreta ou dado corrompido).');
  }
}
