/**
 * Ferramenta operacional de bootstrap do multi-servidor Evolution API
 * (Fase 4.B, ARQUITETURA §4.6/§4.8/§9.1). Mesma família de `admin.ts`/
 * `seed.ts` — roda via `tsx`, no container do `web` (que TEM `tsx` — o
 * container do `worker` não tem, ver `DEPLOY.md` §7.2: "todo script novo
 * precisa ser entrada do tsup OU rodar onde `tsx` existe").
 *
 * POR QUE EXISTE (sequência completa, ver cabeçalho da migração
 * `20260923140000_evolution_servers` para o detalhe): até esta rodada,
 * `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` eram as ÚNICAS credenciais
 * Evolution do sistema (variável de ambiente). Depois desta migração,
 * `EvolutionServer` (linha de banco, credencial cifrada) é a fonte da
 * verdade — mas toda `WhatsAppInstance` já existente em produção nasceu
 * ANTES de `EvolutionServer` existir, então `evolutionServerId` está NULO
 * nelas. Este script:
 *   1. Lê `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` do ambiente (as MESMAS que
 *      `apps/web` já usa hoje).
 *   2. Cria (ou reaproveita, se já existir — IDEMPOTENTE) o primeiro
 *      `EvolutionServer`, com a API key CIFRADA em repouso.
 *   3. Liga toda `WhatsAppInstance` com `evolutionServerId IS NULL` a esse
 *      servidor (uma `UPDATE` só, tabela pequena — sem risco de lock longo).
 *
 * USO (dentro do container `web`, working dir `/app`, mesmo padrão de
 * `admin.ts`/`seed.ts` — `DEPLOY.md` §7):
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/evolution-servers.ts bootstrap
 *   node node_modules/tsx/dist/cli.mjs packages/db/prisma/evolution-servers.ts check
 *
 * ⚠️ A CIFRA AQUI É UMA CÓPIA DELIBERADA (AES-256-GCM, IV 12 bytes, auth tag
 * 16 bytes, chave-mestre de `EVOLUTION_MASTER_KEY`/`EVOLUTION_MASTER_KEY_VERSION`)
 * da implementação canônica em `apps/web/src/lib/evolution-server-crypto.ts`
 * — NÃO um import cruzado. `packages/db` é consumido por `apps/web` E
 * `apps/worker`; importar de `apps/web` de dentro de `packages/db` inverteria
 * a direção de dependência do monorepo (regra 5 de `convention-api-routes-
 * fase1`: apps não compartilham código entre si, só via `packages/*`). Se o
 * FORMATO da cifra mudar num lado, mudar no outro — mesmo espírito de
 * `packages/messaging`/`apps/worker` duplicando o nome/prioridade da fila
 * BullMQ.
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { prisma } from '../src/client.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
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

/**
 * `Uint8Array<ArrayBuffer>`, não `Buffer` — mesmo motivo de
 * `apps/web/src/lib/services/evolution-servers.ts#toPrismaBytes`: o campo
 * `Bytes` do Prisma Client exige especificamente `Uint8Array<ArrayBuffer>`
 * (exclui `SharedArrayBuffer`, que `Buffer` inclui na união de tipos) — só
 * desencontro de TIPOS, `randomBytes`/`cipher.*` nunca alocam sobre
 * `SharedArrayBuffer` em tempo de execução.
 */
function encryptApiKey(apiKey: string): { ciphertext: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; authTag: Uint8Array<ArrayBuffer>; keyVersion: number } {
  const keyVersion = currentMasterKeyVersion();
  const masterKey = resolveMasterKey(keyVersion);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: new Uint8Array(ciphertext), iv: new Uint8Array(iv), authTag: new Uint8Array(authTag), keyVersion };
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Dono lógico do servidor criado pelo bootstrap — o admin mais antigo (mesmo critério usado para qualquer operação administrativa sem um ator humano na sessão, ex.: `system`/`retention.job` futuros). */
async function findAnyAdminOrThrow(): Promise<{ id: string; email: string }> {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true } });
  if (!admin) {
    throw new Error('Nenhum usuário admin encontrado — rode o seed (`prisma/seed.ts`) antes do bootstrap do Evolution.');
  }
  return admin;
}

async function bootstrap(): Promise<void> {
  const rawBaseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!rawBaseUrl) throw new Error('EVOLUTION_API_URL não configurada — nada para migrar.');
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada — nada para migrar.');
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  let server = await prisma.evolutionServer.findUnique({ where: { baseUrl } });
  if (server) {
    console.log(`\n○ Servidor "${server.name}" (${baseUrl}) já cadastrado (id=${server.id}) — reaproveitando, sem recriar.`);
  } else {
    const admin = await findAnyAdminOrThrow();
    const encrypted = encryptApiKey(apiKey);
    server = await prisma.evolutionServer.create({
      data: {
        name: 'Servidor Evolution (bootstrap)',
        baseUrl,
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        apiKeyKeyVersion: encrypted.keyVersion,
        createdById: admin.id,
      },
    });
    console.log(`\n✔ Servidor "${server.name}" (${baseUrl}) criado (id=${server.id}), credencial cifrada com a versão ${encrypted.keyVersion} da chave-mestre.`);
    console.log(`  Dono lógico: ${admin.email} (mais antigo admin ativo/inativo encontrado).`);
  }

  const { count } = await prisma.whatsAppInstance.updateMany({
    where: { evolutionServerId: null },
    data: { evolutionServerId: server.id },
  });
  console.log(`✔ ${count} instância(s) de WhatsApp com evolutionServerId nulo foram ligadas a este servidor.`);

  await runCheck();
}

async function runCheck(): Promise<void> {
  const remaining = await prisma.whatsAppInstance.count({ where: { evolutionServerId: null } });
  const servers = await prisma.evolutionServer.count();
  console.log(`\n— Conferência —`);
  console.log(`  Servidores Evolution cadastrados: ${servers}`);
  console.log(`  Instâncias de WhatsApp SEM servidor (evolutionServerId IS NULL): ${remaining}`);
  if (remaining === 0) {
    console.log('  ✔ Nenhuma instância legada restante — seguro considerar o fallback de env removível (ver PARA O PRÓXIMO no handoff do Vega).');
  } else {
    console.log('  ⚠ Ainda existem instâncias legadas dependendo de EVOLUTION_API_URL/EVOLUTION_API_KEY (fallback em lib/evolution.ts).');
  }
  console.log('');
}

async function main(): Promise<void> {
  const [, , comando] = process.argv;
  switch (comando) {
    case 'bootstrap':
      return bootstrap();
    case 'check':
      return runCheck();
    default:
      console.log('\nComandos: bootstrap | check\n');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
