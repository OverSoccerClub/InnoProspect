/**
 * lib/services/evolution-servers.ts — CRUD de `EvolutionServer` (multi-
 * servidor Evolution API, Fase 4.B, ARQUITETURA §4.6/§4.8/§9.1) + teste de
 * conexão. Toda rota é `requireRole: 'admin'` (mesmo mecanismo do CRUD de
 * usuários/instâncias — ver `lib/api-handler.ts#ApiRouteOptions.requireRole`):
 * cadastrar/editar servidor é administrar infraestrutura de disparo
 * compartilhada, não uso rotineiro.
 *
 * ⚠️ A credencial NUNCA é devolvida por nenhuma função aqui — só
 * `hasApiKey` (booleano, sempre `true` hoje porque a coluna é `NOT NULL`).
 * `create`/`update` cifram (`@inno/sending`, movido de `lib/evolution-server-
 * crypto.ts` na Fase 4.F.4 — o worker também precisa da mesma cifra) ANTES de
 * qualquer chamada ao Prisma — o texto puro nunca é persistido nem logado.
 */
import { Prisma, prisma, type EvolutionServer } from '@inno/db';
import { EvolutionClient, MessagingError } from '@inno/messaging';
import { decryptEvolutionApiKey, encryptEvolutionApiKey, EvolutionCryptoError, toPrismaBytes } from '@inno/sending';
import type {
  CreateEvolutionServerBody,
  CreateEvolutionServerResponse,
  EvolutionServerItem,
  ListEvolutionServersResponse,
  TestEvolutionServerConnectionResponse,
  UpdateEvolutionServerBody,
  UpdateEvolutionServerResponse,
} from '@inno/contracts';
import { conflict, notFound } from '@/lib/api-handler';
import { logger } from '@/lib/logger';

/**
 * Timeout do teste de conexão MANUAL (clique do operador na tela) — bem mais
 * curto que o timeout padrão do cliente (15s, `client/http.ts`). Pedido
 * explícito do dono: "cuide do timeout, não deixe a requisição do operador
 * pendurada".
 */
const TEST_CONNECTION_TIMEOUT_MS = 6_000;

/** Sem barra final — mesma normalização documentada em `EvolutionServer.baseUrl` (schema Prisma): sem isto, "https://x.com" e "https://x.com/" passam como servidores diferentes para o `@unique`. */
function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function toItem(row: EvolutionServer, instancesCount: number): EvolutionServerItem {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    isActive: row.isActive,
    hasApiKey: true, // coluna NOT NULL — todo EvolutionServer sempre tem credencial cadastrada.
    instancesCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function countInstances(serverId: string): Promise<number> {
  return prisma.whatsAppInstance.count({ where: { evolutionServerId: serverId } });
}

async function findServerOrNotFound(id: string): Promise<EvolutionServer> {
  const server = await prisma.evolutionServer.findUnique({ where: { id } });
  if (!server) notFound('Servidor Evolution não encontrado.', 'SERVER_NOT_FOUND');
  return server;
}

function conflictOnDuplicateBaseUrl(err: unknown, baseUrl: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    conflict(`Já existe um servidor cadastrado com a URL ${baseUrl}.`, undefined, 'SERVER_BASE_URL_TAKEN');
  }
  throw err;
}

export async function listEvolutionServers(): Promise<ListEvolutionServersResponse> {
  const servers = await prisma.evolutionServer.findMany({ orderBy: { createdAt: 'asc' } });
  if (servers.length === 0) return { data: [] };

  const counts = await Promise.all(servers.map((s) => countInstances(s.id)));
  return { data: servers.map((s, i) => toItem(s, counts[i] ?? 0)) };
}

/** `GET /api/v1/evolution-servers/:id` — existe pelo mesmo motivo de `whatsapp-instances.ts#getWhatsAppInstanceDetail`: a tela de edição é acessível por link direto. */
export async function getEvolutionServerDetail(id: string): Promise<EvolutionServerItem> {
  const server = await findServerOrNotFound(id);
  return toItem(server, await countInstances(id));
}

export async function createEvolutionServer(body: CreateEvolutionServerBody, createdById: string): Promise<CreateEvolutionServerResponse> {
  const baseUrl = normalizeBaseUrl(body.baseUrl);

  const existing = await prisma.evolutionServer.findUnique({ where: { baseUrl } });
  if (existing) conflict(`Já existe um servidor cadastrado com a URL ${baseUrl}.`, undefined, 'SERVER_BASE_URL_TAKEN');

  const encrypted = encryptEvolutionApiKey(body.apiKey, process.env);

  let created: EvolutionServer;
  try {
    created = await prisma.evolutionServer.create({
      data: {
        name: body.name,
        baseUrl,
        apiKeyCiphertext: toPrismaBytes(encrypted.ciphertext),
        apiKeyIv: toPrismaBytes(encrypted.iv),
        apiKeyAuthTag: toPrismaBytes(encrypted.authTag),
        apiKeyKeyVersion: encrypted.keyVersion,
        createdById,
      },
    });
  } catch (err) {
    // Corrida rara: dois `POST` simultâneos com a mesma `baseUrl` passam pelo
    // `findUnique` acima antes de qualquer um comitar — mesmo padrão de
    // `users.ts#createUser`.
    conflictOnDuplicateBaseUrl(err, baseUrl);
  }

  logger.info('evolution_server.criado', { serverId: created.id, createdById });
  return toItem(created, 0);
}

export async function updateEvolutionServer(id: string, patch: UpdateEvolutionServerBody): Promise<UpdateEvolutionServerResponse> {
  const existing = await findServerOrNotFound(id);

  const baseUrl = patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : undefined;
  if (baseUrl !== undefined && baseUrl !== existing.baseUrl) {
    const taken = await prisma.evolutionServer.findUnique({ where: { baseUrl } });
    if (taken) conflict(`Já existe um servidor cadastrado com a URL ${baseUrl}.`, undefined, 'SERVER_BASE_URL_TAKEN');
  }

  const data: Prisma.EvolutionServerUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  // `apiKey` presente = ROTACIONA a credencial (recifra com a versão ATUAL
  // da chave-mestre); ausente, a credencial gravada permanece intocada.
  const rotatingApiKey = patch.apiKey !== undefined;
  if (rotatingApiKey) {
    const encrypted = encryptEvolutionApiKey(patch.apiKey!, process.env);
    data.apiKeyCiphertext = toPrismaBytes(encrypted.ciphertext);
    data.apiKeyIv = toPrismaBytes(encrypted.iv);
    data.apiKeyAuthTag = toPrismaBytes(encrypted.authTag);
    data.apiKeyKeyVersion = encrypted.keyVersion;
  }

  let updated: EvolutionServer;
  try {
    updated = await prisma.evolutionServer.update({ where: { id }, data });
  } catch (err) {
    conflictOnDuplicateBaseUrl(err, baseUrl ?? existing.baseUrl);
  }

  // Nunca logar o valor da credencial — só o FATO de ter rotacionado.
  logger.info('evolution_server.atualizado', { serverId: id, rotatedApiKey: rotatingApiKey, camposAlterados: Object.keys(data).filter((k) => !k.toLowerCase().startsWith('apikey')) });
  return toItem(updated, await countInstances(id));
}

/**
 * `DELETE /api/v1/evolution-servers/:id` — DESATIVA (`isActive: false`),
 * nunca apaga a linha (mesmo padrão de `User.isActive`/`WhatsAppInstance.
 * isActive` — preserva histórico, e uma exclusão física estouraria o
 * `onDelete: Restrict` de `WhatsAppInstance.evolutionServer` de qualquer
 * jeito, para qualquer servidor com QUALQUER instância — ativa ou não —
 * ainda apontando para ele). Idempotente: chamar duas vezes num servidor já
 * inativo é um no-op (`204` as duas vezes).
 *
 * BLOQUEIA se houver instância ATIVA apontando para este servidor —
 * desativar por baixo de uma instância em uso pararia o envio dela sem
 * aviso nenhum na tela; o operador precisa mover/desativar as instâncias
 * primeiro. Instâncias já INATIVAS não bloqueiam (histórico morto).
 */
export async function deactivateEvolutionServer(id: string): Promise<void> {
  const existing = await findServerOrNotFound(id);
  if (!existing.isActive) return; // já estava inativo — nada a fazer.

  const activeInstances = await prisma.whatsAppInstance.count({ where: { evolutionServerId: id, isActive: true } });
  if (activeInstances > 0) {
    conflict(
      `Este servidor tem ${activeInstances} instância(s) de WhatsApp ativa(s) apontando para ele. Mova ou desative as instâncias antes de desativar o servidor.`,
      undefined,
      'SERVER_IN_USE',
    );
  }

  await prisma.evolutionServer.update({ where: { id }, data: { isActive: false } });
  logger.info('evolution_server.desativado', { serverId: id });
}

/**
 * `POST /api/v1/evolution-servers/:id/test-connection` — NUNCA lança por a
 * conexão ter falhado (isso é o RESULTADO do teste, `ok:false`), só por
 * `:id` não existir (`404`, via `findServerOrNotFound`). Chama `GET
 * /instance/fetchInstances` (checa URL alcançável + apikey válida, sem
 * depender de nenhuma instância existir) com um timeout CURTO
 * (`TEST_CONNECTION_TIMEOUT_MS`) — o operador está esperando na tela.
 */
export async function testEvolutionServerConnection(id: string): Promise<TestEvolutionServerConnectionResponse> {
  const server = await findServerOrNotFound(id);
  const startedAt = Date.now();
  const checkedAtNow = (): string => new Date().toISOString();

  let apiKey: string;
  try {
    apiKey = decryptEvolutionApiKey(server, process.env);
  } catch (err) {
    logger.error('evolution_server.teste_de_conexao_erro_de_configuracao', {
      serverId: id,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    const message =
      err instanceof EvolutionCryptoError
        ? 'Não foi possível decifrar a credencial deste servidor — verifique a chave-mestre configurada no ambiente (EVOLUTION_MASTER_KEY).'
        : 'Falha inesperada ao preparar o teste de conexão.';
    return { ok: false, latencyMs: Date.now() - startedAt, checkedAt: checkedAtNow(), error: { code: 'CONFIG_ERROR', message } };
  }

  const client = new EvolutionClient({ baseUrl: server.baseUrl, apiKey, timeoutMs: TEST_CONNECTION_TIMEOUT_MS });
  try {
    await client.testConnection();
    return { ok: true, latencyMs: Date.now() - startedAt, checkedAt: checkedAtNow(), error: null };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    if (err instanceof MessagingError) {
      logger.warn('evolution_server.teste_de_conexao_falhou', { serverId: id, code: err.code, status: err.status });
      return { ok: false, latencyMs, checkedAt: checkedAtNow(), error: { code: err.code, message: err.message } };
    }
    logger.error('evolution_server.teste_de_conexao_erro_inesperado', { serverId: id, err: err instanceof Error ? err : new Error(String(err)) });
    return { ok: false, latencyMs, checkedAt: checkedAtNow(), error: { code: 'UNKNOWN', message: 'Falha inesperada ao testar a conexão.' } };
  }
}
