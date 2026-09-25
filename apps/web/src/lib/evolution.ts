/**
 * lib/evolution.ts — resolução do `EvolutionClient` (`@inno/messaging`) +
 * helpers de configuração usados pelas rotas de `whatsapp/instances`, pelo
 * webhook e pelo envio de mensagens (ARQUITETURA §4.6/§4.8, Fase 4.B).
 *
 * 🆕 Fase 4.B — MULTI-SERVIDOR: antes desta rodada, todo o processo falava
 * com UM único servidor Evolution, configurado via `EVOLUTION_API_URL`/
 * `EVOLUTION_API_KEY` (variável de ambiente, cliente singleton). Agora
 * `WhatsAppInstance.evolutionServerId` diz EM QUAL `EvolutionServer` (linha
 * do banco, credencial cifrada em repouso) aquela instância vive, e o
 * cliente é resolvido POR INSTÂNCIA/SERVIDOR, não mais um singleton único de
 * processo.
 *
 * 🆕 Fase 4.F.4 — a cifra e a resolução em si (achar o servidor, decifrar,
 * montar o `EvolutionClient`) MUDARAM DE DONO: viraram `@inno/sending`
 * (`evolution-crypto.ts`/`evolution-resolver.ts`), porque `apps/worker`
 * (`dispatch-tick.job`) agora TAMBÉM precisa resolver o cliente por
 * instância, e "achar o servidor certo" não pode ter uma segunda cópia
 * (ARQUITETURA §6.8.0.1). Este arquivo fica como CAMADA FINA em cima disso:
 * a política de erro (o que fazer quando o servidor não existe/está
 * inativo) continua só daqui — `apps/web` tem uma requisição HTTP esperando
 * e transforma isso em `404/409/502`; `apps/worker` não tem requisição
 * nenhuma e reage diferente (tira a instância da rotação, halta a campanha
 * se não sobrar nenhuma) — ver `apps/worker/src/lib/evolution.ts`. As rotas
 * HTTP existentes não mudam de comportamento nenhum — só de onde vem a
 * implementação.
 *
 * ⚠️ FALLBACK PARA A ENV, DE PROPÓSITO E TEMPORÁRIO: `evolutionServerId` é
 * NULLABLE (migração `20260923140000_evolution_servers` — ver comentário
 * completo no schema Prisma) porque toda `WhatsAppInstance` já existente em
 * produção nasceu ANTES de `EvolutionServer` existir. `getEvolutionClientForInstance`
 * cai em `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` (env) SÓ quando o campo
 * ainda é `null` — nunca para uma instância que já tem servidor atribuído.
 * REMOVER ESTE FALLBACK só depois que `packages/db/prisma/evolution-servers.ts
 * bootstrap` (o script operacional, roda 1x) tiver preenchido
 * `evolutionServerId` em TODA linha legada — o handoff do Vega documenta o
 * comando de conferência (`SELECT count(*) ... WHERE "evolutionServerId" IS
 * NULL` deve dar 0) antes de considerar isto seguro de apagar.
 */
import { randomBytes } from 'node:crypto';
import { prisma, type EvolutionServer } from '@inno/db';
import type { EvolutionClient } from '@inno/messaging';
import {
  buildEvolutionClientFromServer,
  buildLegacyEnvEvolutionClient,
  resolveInstanceEvolutionClient,
} from '@inno/sending';
import { conflict, notFound, upstreamError } from './api-handler';
import { logger } from './logger';

let legacyEnvClient: EvolutionClient | null = null;
let legacyEnvFallbackWarned = false;

/**
 * Cliente construído a partir de `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`
 * (comportamento PRÉ-Fase-4.B) — usado só como fallback para instância cujo
 * `evolutionServerId` ainda é `null` (ver comentário no topo do arquivo).
 * Loga UMA VEZ por processo (não a cada chamada) para o operador notar, sem
 * inundar o log, que ainda existe alguma instância legada dependendo da env.
 * O cache/aviso é DESTE processo (`apps/web`) — `apps/worker` tem o seu
 * próprio, com o seu próprio texto de aviso.
 */
function getLegacyEnvEvolutionClient(): EvolutionClient {
  if (!legacyEnvClient) {
    legacyEnvClient = buildLegacyEnvEvolutionClient(process.env);
  }
  if (!legacyEnvFallbackWarned) {
    legacyEnvFallbackWarned = true;
    logger.warn(
      'evolution.fallback_env_ativo — instância(s) sem evolutionServerId ainda dependem de EVOLUTION_API_URL/EVOLUTION_API_KEY; rode packages/db/prisma/evolution-servers.ts bootstrap',
    );
  }
  return legacyEnvClient;
}

/**
 * `POST /api/v1/whatsapp/instances` (criação) — `evolutionServerId` vem do
 * CORPO da requisição (entrada do operador), então erro de servidor
 * inexistente/inativo é `404`/`409` (erro do CLIENTE), não `502`.
 */
export async function requireActiveEvolutionServer(evolutionServerId: string): Promise<EvolutionServer> {
  const server = await prisma.evolutionServer.findUnique({ where: { id: evolutionServerId } });
  if (!server) notFound('Servidor Evolution não encontrado.', 'SERVER_NOT_FOUND');
  if (!server.isActive) conflict('Este servidor Evolution está desativado. Escolha outro ou reative-o antes de criar a instância.', undefined, 'SERVER_INACTIVE');
  return server;
}

export function getEvolutionClientForServer(server: EvolutionServer): EvolutionClient {
  return buildEvolutionClientFromServer(server, process.env);
}

/**
 * Resolve o cliente Evolution de uma instância JÁ EXISTENTE (`connect`/`qr`/
 * `disconnect`/`delete`/envio de mensagem) — usa o servidor atribuído
 * (`evolutionServerId`) quando presente; cai no cliente por variável de
 * ambiente SÓ enquanto o campo for `null` (ver comentário no topo do
 * arquivo). Diferente de `requireActiveEvolutionServer`: aqui
 * `evolutionServerId` já está GRAVADO na instância (não é entrada do
 * operador AGORA) — um servidor ausente/inativo é uma inconsistência de
 * dados/operação, não um erro de validação do request atual, por isso vira
 * `502 UPSTREAM_ERROR` (nosso problema a resolver), não `404`/`409`.
 */
export async function getEvolutionClientForInstance(instance: { evolutionServerId: string | null }): Promise<EvolutionClient> {
  const result = await resolveInstanceEvolutionClient(
    { prisma, env: process.env, legacyClient: getLegacyEnvEvolutionClient },
    instance,
  );
  if (result.outcome === 'server_not_found') {
    upstreamError('O servidor Evolution associado a esta instância não foi encontrado. Contate o administrador.', 'SERVER_NOT_FOUND');
  }
  if (result.outcome === 'server_inactive') {
    upstreamError('O servidor Evolution associado a esta instância está desativado. Contate o administrador.', 'SERVER_INACTIVE');
  }
  return result.client;
}

/**
 * Segredo por instância usado no path `/api/webhooks/evolution/:instanceKey`
 * (ARQUITETURA §4.8) — GERADO POR NÓS, não é o nome da instância nem
 * `EVOLUTION_API_KEY`. 32 bytes aleatórios em hex (64 chars): espaço grande o
 * suficiente para não ser adivinhável por força bruta, e hex evita qualquer
 * problema de caractere especial em path de URL.
 */
export function generateInstanceKey(): string {
  return randomBytes(32).toString('hex');
}

/** `evolutionInstanceName` — nome da instância dentro do container Evolution. Único: prefixo do nome amigável (para depuração) + sufixo aleatório (para nunca colidir mesmo com 2 instâncias de mesmo nome). */
export function generateEvolutionInstanceName(friendlyName: string): string {
  const slug = friendlyName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(4).toString('hex');
  return `${slug || 'instancia'}-${suffix}`;
}

/** URL completa de webhook por instância — `{EVOLUTION_WEBHOOK_BASE_URL}/:instanceKey` (ARQUITETURA §4.8/§10). */
export function buildWebhookUrl(instanceKey: string): string {
  const base = (process.env.EVOLUTION_WEBHOOK_BASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/${instanceKey}`;
}
