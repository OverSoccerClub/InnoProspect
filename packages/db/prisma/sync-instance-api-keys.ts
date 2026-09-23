/**
 * packages/db/prisma/sync-instance-api-keys.ts — comando operacional que
 * preenche `WhatsAppInstance.instanceApiKey*` para instância(s) JÁ PAREADAS
 * (nasceram ANTES da correção de 2026-09-23, ou a captura em `POST
 * /instance/create` falhou naquela hora) — SEM ISSO, essas instâncias só
 * aceitam o webhook pela chave GLOBAL do `EvolutionServer`; se a Evolution
 * assinar o webhook com a chave DA INSTÂNCIA, todo evento de retorno
 * continua recusado em silêncio (o mesmo incidente que motivou esta
 * correção, ver `.claude/agent-memory/vega/bug_webhook_apikey_instance_vs_global.md`).
 *
 * 🆕 2026-09-23 (2ª rodada): reescrito aqui, autossuficiente, porque a
 * primeira versão vivia em `apps/web/scripts/` — caminho que NÃO existe na
 * imagem de produção do `web` (o Dockerfile copia só o bundle `.next/
 * standalone` do Next, nunca `apps/web/src`/`apps/web/scripts`) e que
 * importava `@inno/messaging` (símlink não copiado — só `packages/db` foi
 * trazido para a imagem). Mesma família de restrição de
 * `evolution-servers.ts` (ver cabeçalho dele) e do backfill do worker
 * (`DEPLOY.md §7.2`), agora documentada para o `web` em `DEPLOY.md §7.2.1`.
 *
 * ⚠️ A CIFRA/DECIFRA AQUI É UMA CÓPIA DELIBERADA (AES-256-GCM, IV 12 bytes,
 * auth tag 16 bytes, chave-mestre de `EVOLUTION_MASTER_KEY`/
 * `EVOLUTION_MASTER_KEY_VERSION`) da implementação canônica em
 * `apps/web/src/lib/evolution-server-crypto.ts` — NÃO um import cruzado
 * (mesmo motivo de `evolution-servers.ts`: `packages/db` não pode depender
 * de `apps/web`). **Se o FORMATO da cifra mudar num lado, mude no outro** —
 * senão este script grava (ou lê) algo que a aplicação não consegue
 * decifrar, e o sintoma é de novo "webhook recusado em silêncio", por outro
 * motivo.
 *
 * ⚠️ SEGURO PARA INSTÂNCIA JÁ CONECTADA — este script SÓ LÊ (`GET
 * /instance/fetchInstances`), NUNCA chama `connect`/`create`. Não reinicia
 * pareamento, não gera QR novo, não desconecta nada (mesma distinção
 * crítica documentada em `bug_qr_poll_invalidava_codigo.md`: "leitura pura"
 * vs. "verbo que reinicia estado").
 *
 * USO (dentro do container `web`, working dir `/app`, mesmo padrão de
 * `evolution-servers.ts`/`admin.ts`/`seed.ts` — DEPLOY.md §7.4):
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/sync-instance-api-keys.ts
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/sync-instance-api-keys.ts <evolutionInstanceName>
 *
 * Idempotente: pode rodar quantas vezes quiser — sempre RECIFRA com o valor
 * mais recente que a Evolution devolver (se já houver uma credencial
 * gravada aqui, ela é sobrescrita, nunca duplicada).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { prisma } from '../src/client.js';

// ── Cifra (cópia deliberada — ver cabeçalho) ────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

/** Mesma regra de `apps/web/src/lib/evolution-server-crypto.ts#masterKeyEnvVarNames` — versão 1 aceita o nome bare E o alias versionado (sustenta rotação, ver comentário lá). */
function masterKeyEnvVarNames(version: number): string[] {
  return version === 1 ? ['EVOLUTION_MASTER_KEY_V1', 'EVOLUTION_MASTER_KEY'] : [`EVOLUTION_MASTER_KEY_V${version}`];
}

function currentMasterKeyVersion(): number {
  const raw = Number.parseInt(process.env.EVOLUTION_MASTER_KEY_VERSION ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function resolveMasterKey(version: number): Buffer {
  const names = masterKeyEnvVarNames(version);
  const found = names.map((name) => ({ name, raw: process.env[name] })).find((entry) => entry.raw !== undefined && entry.raw.length > 0);
  if (!found) {
    throw new Error(`Chave-mestre da Evolution API não configurada (nenhuma das variáveis "${names.join('", "')}" está definida). Gere com: openssl rand -base64 32`);
  }
  const key = Buffer.from(found.raw!, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`Variável "${found.name}" precisa decodificar para exatamente ${KEY_LENGTH_BYTES} bytes (AES-256) — recebido ${key.length}.`);
  }
  return key;
}

type EncryptedApiKey = { ciphertext: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; authTag: Uint8Array<ArrayBuffer>; keyVersion: number };

/** `Uint8Array<ArrayBuffer>`, não `Buffer` — mesmo motivo de `evolution-servers.ts#encryptApiKey`: o campo `Bytes` do Prisma Client exige especificamente essa forma (exclui `SharedArrayBuffer`, que `Buffer` inclui na união de tipos) — só desencontro de TIPOS, nunca de dado real. */
function encryptApiKey(apiKey: string): EncryptedApiKey {
  const keyVersion = currentMasterKeyVersion();
  const masterKey = resolveMasterKey(keyVersion);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: new Uint8Array(ciphertext), iv: new Uint8Array(iv), authTag: new Uint8Array(authTag), keyVersion };
}

/** Decifra uma linha de `EvolutionServer` (credencial GLOBAL do servidor) de volta para texto puro — usada aqui só para autenticar a chamada `GET /instance/fetchInstances`. Lança se a auth tag não validar (GCM/AEAD — nunca devolve texto parcial). */
function decryptApiKey(row: { apiKeyCiphertext: Uint8Array; apiKeyIv: Uint8Array; apiKeyAuthTag: Uint8Array; apiKeyKeyVersion: number }): string {
  const iv = Buffer.from(row.apiKeyIv);
  const authTag = Buffer.from(row.apiKeyAuthTag);
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`IV com tamanho inesperado (esperado ${IV_LENGTH_BYTES} bytes, recebido ${iv.length}).`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Auth tag com tamanho inesperado (esperado ${AUTH_TAG_LENGTH_BYTES} bytes, recebido ${authTag.length}).`);
  }
  const masterKey = resolveMasterKey(row.apiKeyKeyVersion);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.apiKeyCiphertext)), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error('Falha ao decifrar a credencial do servidor Evolution (chave-mestre incorreta ou dado corrompido).');
  }
}

// ── Chamada HTTP + parsing da resposta (cópia deliberada de
//    `packages/messaging/src/client/wire.ts#readInstanceApiKey`/
//    `parseFetchInstancesResponse` — mesmo motivo: este script não pode
//    importar `@inno/messaging`, o symlink não existe na imagem do `web`) ─

type FetchedInstanceInfo = { instanceName: string | null; apiKey: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Mesma convenção de formatos plausíveis de `wire.ts#readInstanceApiKey` — NÃO confirmado contra servidor real (mesma ressalva de sempre em `packages/messaging`). */
function readInstanceApiKey(root: Record<string, unknown>, instance: Record<string, unknown> | null): string | null {
  const hashRaw = root.hash;
  if (typeof hashRaw === 'string' && hashRaw.length > 0) return hashRaw;
  const hashRecord = asRecord(hashRaw);
  return (
    readString(hashRecord?.apikey) ??
    readString(root.token) ??
    readString(root.apikey) ??
    readString(instance?.token) ??
    readString(instance?.apikey) ??
    readString(instance?.hash) ??
    null
  );
}

function parseFetchInstancesResponse(body: unknown): FetchedInstanceInfo[] {
  const root = asRecord(body);
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(root?.instances) ? (root!.instances as unknown[]) : [];
  return list.map((item) => {
    const itemRoot = asRecord(item) ?? {};
    const instance = asRecord(itemRoot.instance);
    const instanceName =
      readString(instance?.instanceName) ?? readString(instance?.name) ?? readString(itemRoot.instanceName) ?? readString(itemRoot.name);
    return { instanceName, apiKey: readInstanceApiKey(itemRoot, instance) };
  });
}

const FETCH_TIMEOUT_MS = 15_000;

/** `GET /instance/fetchInstances` puro — sem retry (script operacional, roda manualmente; falha clara é melhor que retentar sozinho). */
async function fetchInstances(baseUrl: string, apiKey: string): Promise<FetchedInstanceInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/instance/fetchInstances`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      signal: controller.signal,
    });
    const text = await response.text();
    const parsedBody = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`Evolution API respondeu ${response.status} em GET /instance/fetchInstances: ${text.slice(0, 300)}`);
    }
    return parseFetchInstancesResponse(parsedBody);
  } finally {
    clearTimeout(timer);
  }
}

// ── Orquestração ─────────────────────────────────────────────────────────

type EvolutionServerRow = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyCiphertext: Uint8Array;
  apiKeyIv: Uint8Array;
  apiKeyAuthTag: Uint8Array;
  apiKeyKeyVersion: number;
};

async function syncForServer(server: EvolutionServerRow, onlyInstanceName?: string): Promise<{ updated: number; skipped: number }> {
  console.log(`\n○ Servidor "${server.name}" (${server.baseUrl})`);

  const localInstances = await prisma.whatsAppInstance.findMany({
    where: onlyInstanceName
      ? { evolutionServerId: server.id, evolutionInstanceName: onlyInstanceName }
      : { evolutionServerId: server.id },
  });
  if (localInstances.length === 0) {
    console.log('  (nenhuma instância local para este servidor — nada a fazer)');
    return { updated: 0, skipped: 0 };
  }

  const serverApiKey = decryptApiKey(server);
  const remoteInstances = await fetchInstances(server.baseUrl, serverApiKey);
  const byName = new Map(remoteInstances.filter((r) => r.instanceName).map((r) => [r.instanceName as string, r]));

  let updated = 0;
  let skipped = 0;
  for (const local of localInstances) {
    const remote = byName.get(local.evolutionInstanceName);
    if (!remote || !remote.apiKey) {
      console.log(`  ⚠ ${local.name} (${local.evolutionInstanceName}): Evolution não devolveu credencial própria — continua pela chave do servidor.`);
      skipped++;
      continue;
    }

    const encrypted = encryptApiKey(remote.apiKey);
    await prisma.whatsAppInstance.update({
      where: { id: local.id },
      data: {
        instanceApiKeyCiphertext: encrypted.ciphertext,
        instanceApiKeyIv: encrypted.iv,
        instanceApiKeyAuthTag: encrypted.authTag,
        instanceApiKeyKeyVersion: encrypted.keyVersion,
      },
    });
    console.log(`  ✔ ${local.name} (${local.evolutionInstanceName}): credencial própria capturada e cifrada.`);
    updated++;
  }
  return { updated, skipped };
}

async function main(): Promise<void> {
  const onlyInstanceName = process.argv[2]; // filtro opcional: evolutionInstanceName, para rodar contra 1 só.

  const servers = await prisma.evolutionServer.findMany({ where: { isActive: true } });
  if (servers.length === 0) {
    console.log('Nenhum EvolutionServer ativo cadastrado — rode `evolution-servers.ts bootstrap` primeiro.');
    return;
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const server of servers) {
    const { updated, skipped } = await syncForServer(server, onlyInstanceName);
    totalUpdated += updated;
    totalSkipped += skipped;
  }

  console.log(`\n— Resumo —\n  Credenciais capturadas: ${totalUpdated}\n  Sem credencial própria na Evolution (continuam pela chave do servidor): ${totalSkipped}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
