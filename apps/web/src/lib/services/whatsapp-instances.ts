/**
 * lib/services/whatsapp-instances.ts — `WhatsAppInstance` (ARQUITETURA
 * §4.6). Combina o estado em Postgres (fonte da verdade) com chamadas ao
 * `EvolutionClient` (`@inno/messaging`) — nunca o contrário: se a Evolution
 * cair, a API ainda responde com o último estado conhecido do banco (só as
 * ações que precisam mesmo de rede, como `connect`/QR, propagam `502
 * UPSTREAM_ERROR`).
 */
import { MessagingError, type ConnectResult } from '@inno/messaging';
import { Prisma, prisma, type WhatsAppInstance } from '@inno/db';
import { deriveInstanceHealth, effectiveDailyLimit, isWarmupDayWarm } from '@inno/core';
import type {
  ConnectInstanceResponse,
  CreateWhatsAppInstanceBody,
  CreateWhatsAppInstanceResponse,
  DisconnectInstanceResponse,
  GetQrCodeResponse,
  ListWhatsAppInstancesResponse,
  WhatsAppInstanceDetail,
  WhatsAppInstanceItem,
} from '@inno/contracts';
import { conflict, notFound, upstreamError } from '@/lib/api-handler';
import {
  buildWebhookUrl,
  generateEvolutionInstanceName,
  generateInstanceKey,
  getEvolutionClientForInstance,
  getEvolutionClientForServer,
  requireActiveEvolutionServer,
} from '@/lib/evolution';
import { haltCampaignsSoleInstanceDisconnected } from '@/lib/services/campaign-targets';
import { sendAlert } from '@/lib/alerts';
import { logger } from '@/lib/logger';

/** Chave do dia corrente (00:00 UTC do dia civil em `APP_TIMEZONE`) — mesma granularidade de `InstanceDailyStat.date` (`@db.Date`). */
function todayDateKey(): Date {
  const tz = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${ymd}T00:00:00.000Z`);
}

async function countActiveCampaigns(instanceId: string): Promise<number> {
  return prisma.campaignInstance.count({
    where: { instanceId, campaign: { status: { in: ['scheduled', 'running', 'paused', 'halted'] } } },
  });
}

async function toInstanceItem(
  instance: WhatsAppInstance,
  todayStat: { sentCount: number; failedCount: number; respondedCount: number } | null,
  activeCampaigns: number,
): Promise<WhatsAppInstanceItem> {
  const dailyLimit = effectiveDailyLimit(instance.warmupDay, instance.dailyLimitOverride);
  const sent = todayStat?.sentCount ?? 0;

  return {
    id: instance.id,
    name: instance.name,
    phoneNumber: instance.phoneNumber,
    status: instance.status,
    health: deriveInstanceHealth({ status: instance.status, isDegraded: instance.isDegraded, warmupDay: instance.warmupDay }),
    warmup: { day: instance.warmupDay, dailyLimit, isWarm: isWarmupDayWarm(instance.warmupDay) },
    today: {
      sent,
      failed: todayStat?.failedCount ?? 0,
      responded: todayStat?.respondedCount ?? 0,
      remaining: Math.max(0, dailyLimit - sent),
    },
    lastConnectionAt: instance.lastConnectionAt?.toISOString() ?? null,
    lastErrorAt: instance.lastErrorAt?.toISOString() ?? null,
    lastError: instance.lastErrorMessage,
    activeCampaigns,
  };
}

export async function listWhatsAppInstances(): Promise<ListWhatsAppInstancesResponse> {
  const instances = await prisma.whatsAppInstance.findMany({ orderBy: { createdAt: 'asc' } });
  if (instances.length === 0) return { data: [] };

  const today = todayDateKey();
  const [todayStats, campaignCounts] = await Promise.all([
    prisma.instanceDailyStat.findMany({ where: { instanceId: { in: instances.map((i) => i.id) }, date: today } }),
    Promise.all(instances.map((i) => countActiveCampaigns(i.id))),
  ]);
  const statsByInstance = new Map(todayStats.map((s) => [s.instanceId, s]));

  const data = await Promise.all(
    instances.map((instance, i) => toInstanceItem(instance, statsByInstance.get(instance.id) ?? null, campaignCounts[i] ?? 0)),
  );
  return { data };
}

/**
 * Traduz `MessagingError` (`@inno/messaging`) para o envelope de erro da API
 * — a Evolution é um upstream, nunca `500` nosso. Também dispara o alerta
 * `evolution_api_error` (fire-and-forget, `sendAlert` nunca lança) — antes
 * desta rodada essas falhas só apareciam no log, silenciosas fora dele. Só
 * `code`/`action` vão pro alerta, nunca `err.message`/`err.cause` (podem
 * ecoar dado da requisição — ver regra 4 em `lib/alerts.ts`); a
 * deduplicação por `code` (dentro de `sendAlert`) evita 1 alerta por
 * requisição enquanto a Evolution estiver fora do ar.
 */
function rethrowAsUpstream(err: unknown, action: string): never {
  if (err instanceof MessagingError) {
    logger.error(`falha ao ${action} na Evolution API`, { code: err.code, status: err.status });
    void sendAlert({ kind: 'evolution_api_error', action, code: err.code });
    upstreamError(`Não foi possível ${action} agora (Evolution API indisponível ou com erro). Tente novamente em instantes.`);
  }
  throw err;
}

export async function createWhatsAppInstance(
  body: CreateWhatsAppInstanceBody,
  createdById: string,
): Promise<CreateWhatsAppInstanceResponse> {
  // 🆕 Fase 4.B — `evolutionServerId` é OBRIGATÓRIO na camada de aplicação
  // para toda instância NOVA (mesmo com a coluna ainda nullable no banco,
  // durante a janela de bootstrap — ver comentário completo em
  // `packages/db/prisma/schema.prisma#WhatsAppInstance.evolutionServerId`).
  // `requireActiveEvolutionServer` devolve 404/409 (erro do OPERADOR: id
  // inexistente ou servidor desativado), nunca deixa criar contra um
  // servidor que não existe/está fora de uso.
  const server = await requireActiveEvolutionServer(body.evolutionServerId);
  const evolutionInstanceName = generateEvolutionInstanceName(body.name);
  const instanceKey = generateInstanceKey();
  const client = getEvolutionClientForServer(server);

  let created: WhatsAppInstance;
  try {
    await client.createInstance({ instanceName: evolutionInstanceName });
    await client.setWebhook(evolutionInstanceName, { url: buildWebhookUrl(instanceKey) });
  } catch (err) {
    rethrowAsUpstream(err, 'criar a instância');
  }

  try {
    created = await prisma.whatsAppInstance.create({
      data: {
        name: body.name,
        evolutionInstanceName,
        instanceKey,
        evolutionServerId: server.id,
        status: 'qr_pending',
        warmupStartedAt: body.startWarmup ? new Date() : null,
        createdById,
      },
    });
  } catch (err) {
    // Instância já foi criada do lado da Evolution mas o INSERT no nosso
    // banco falhou (ex.: corrida rara em `evolutionInstanceName`/`instanceKey`,
    // ambos gerados aleatoriamente — praticamente impossível, mas
    // best-effort de limpeza para não deixar lixo órfão na Evolution).
    try {
      await client.deleteInstance(evolutionInstanceName);
    } catch (cleanupErr) {
      logger.error('falha ao limpar instância órfã na Evolution após erro de banco', {
        evolutionInstanceName,
        err: cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr)),
      });
    }
    throw err;
  }

  return {
    id: created.id,
    name: created.name,
    status: 'qr_pending',
    evolutionInstanceName: created.evolutionInstanceName,
  };
}

async function findInstanceOrNotFound(id: string): Promise<WhatsAppInstance> {
  const instance = await prisma.whatsAppInstance.findUnique({ where: { id } });
  if (!instance) notFound('Instância de WhatsApp não encontrada.');
  return instance;
}

export async function getWhatsAppInstanceDetail(id: string): Promise<WhatsAppInstanceDetail> {
  const instance = await findInstanceOrNotFound(id);
  const [todayStat, activeCampaigns, history] = await Promise.all([
    prisma.instanceDailyStat.findUnique({ where: { instanceId_date: { instanceId: id, date: todayDateKey() } } }),
    countActiveCampaigns(id),
    prisma.instanceDailyStat.findMany({ where: { instanceId: id }, orderBy: { date: 'desc' }, take: 30 }),
  ]);

  const item = await toInstanceItem(instance, todayStat, activeCampaigns);
  return {
    ...item,
    history: history.map((h) => ({
      date: h.date.toISOString().slice(0, 10),
      sentCount: h.sentCount,
      failedCount: h.failedCount,
      respondedCount: h.respondedCount,
      blockedCount: h.blockedCount,
    })),
  };
}

/**
 * `GET /whatsapp/instances/:id/qr` — chama a Evolution AO VIVO a cada
 * requisição (o QR expira em ~60s, ARQUITETURA §4.6, e Lyra faz poll de 2s
 * enquanto o modal está aberto). Decisão do Vega: em vez de cachear o QR
 * recebido via webhook `qrcode.updated` em Redis (sugestão de infra da
 * ARQUITETURA), esta rota busca direto — funcionalmente equivalente (QR
 * sempre fresco a cada poll) e evita introduzir um cliente Redis genérico em
 * `apps/web` só para isso. Ver PENDÊNCIAS no handoff.
 */
export async function getWhatsAppInstanceQr(id: string): Promise<GetQrCodeResponse> {
  const instance = await findInstanceOrNotFound(id);

  let result: ConnectResult;
  try {
    const client = await getEvolutionClientForInstance(instance);
    result = await client.connect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'obter o QR code');
  }

  if (result.state === 'connected') {
    await prisma.whatsAppInstance.update({
      where: { id },
      data: { status: 'connected', lastConnectionAt: new Date() },
    });
    return { status: 'connected', qrCodeBase64: null };
  }

  if (!result.qr) {
    upstreamError('Evolution API não devolveu QR code nem confirmou conexão. Tente novamente em instantes.');
  }

  await prisma.whatsAppInstance.update({ where: { id }, data: { status: 'qr_pending' } });
  return {
    status: 'qr_pending',
    qrCodeBase64: result.qr.base64,
    expiresInSeconds: 60,
    ...(result.qr.pairingCode ? { pairingCode: result.qr.pairingCode } : {}),
  };
}

/** `POST /whatsapp/instances/:id/connect` — resposta é sempre `status:'qr_pending'` por CONTRATO (`connectInstanceResponseSchema`, `@inno/contracts`): é um "iniciei o pareamento", o estado real é confirmado via `GET .../qr` ou `GET .../:id` (polling). */
export async function connectWhatsAppInstance(id: string): Promise<ConnectInstanceResponse> {
  const instance = await findInstanceOrNotFound(id);

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.connect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'conectar a instância');
  }

  await prisma.whatsAppInstance.update({ where: { id }, data: { status: 'qr_pending' } });
  return { ok: true, status: 'qr_pending' };
}

/** `POST /whatsapp/instances/:id/disconnect` — logout (mantém a instância), kill switch nas campanhas que dependiam SÓ dela (ARQUITETURA §6.6). */
export async function disconnectWhatsAppInstance(id: string): Promise<DisconnectInstanceResponse> {
  const instance = await findInstanceOrNotFound(id);

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.disconnect(instance.evolutionInstanceName);
  } catch (err) {
    rethrowAsUpstream(err, 'desconectar a instância');
  }

  const pausedCampaigns = await prisma.$transaction(async (tx) => {
    await tx.whatsAppInstance.update({
      where: { id },
      data: { status: 'disconnected', lastErrorAt: new Date(), lastErrorMessage: 'Desconectado manualmente pelo operador.' },
    });
    return haltCampaignsSoleInstanceDisconnected(tx, id, 'Instância de WhatsApp desconectada manualmente.');
  });

  return { ok: true, status: 'disconnected', pausedCampaigns };
}

/** `DELETE /whatsapp/instances/:id` — `409 INSTANCE_IN_USE` se qualquer campanha (ativa ou não) referenciar a instância (schema reforça com `onDelete: Restrict`, mesmo padrão de `deleteTemplate`). */
export async function deleteWhatsAppInstance(id: string): Promise<void> {
  const instance = await findInstanceOrNotFound(id);

  const inUse = await prisma.campaignInstance.findFirst({ where: { instanceId: id }, select: { id: true } });
  if (inUse) {
    conflict('Esta instância está associada a uma campanha e não pode ser apagada. Desconecte-a ou remova-a da campanha primeiro.');
  }

  try {
    const client = await getEvolutionClientForInstance(instance);
    await client.deleteInstance(instance.evolutionInstanceName);
  } catch (err) {
    // Best-effort: se a Evolution já não tiver a instância (ou estiver fora
    // do ar), ainda assim removemos nosso registro — Postgres é a fonte da
    // verdade (mesmo princípio de R10, ARQUITETURA §9.1: "Redis é volátil por
    // design; a verdade está no Postgres", aqui aplicado à Evolution).
    logger.error('falha ao apagar instância na Evolution API (prosseguindo com a remoção local)', {
      instanceId: id,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    if (err instanceof MessagingError) {
      void sendAlert({ kind: 'evolution_api_error', action: 'apagar a instância', code: err.code });
    }
  }

  try {
    await prisma.whatsAppInstance.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2014')) {
      conflict('Esta instância está associada a uma campanha e não pode ser apagada. Desconecte-a ou remova-a da campanha primeiro.');
    }
    throw err;
  }
}
