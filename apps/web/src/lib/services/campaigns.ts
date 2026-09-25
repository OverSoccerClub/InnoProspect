/**
 * lib/services/campaigns.ts — `Campaign`/`CampaignTarget`/`CampaignInstance`
 * (ARQUITETURA §4.5, §6.8). Fase 4.D: API de campanha SEM motor — cria em
 * `draft` já com os alvos MATERIALIZADOS (§4.5.2), as ações do ciclo de vida
 * (`start`/`pause`/`resume`/`cancel`), edição restrita por estado (§4.5.5,
 * A28) e o disparo MANUAL alvo-a-alvo (nenhum laço automático — o motor
 * `dispatch-tick.job` é a Fase 4.F).
 *
 * Duas invariantes do projeto que este arquivo NUNCA viola:
 *   1. Nenhuma escrita direta em `campaignTarget.status` — sempre por
 *      `advanceCampaignTargetStatus()` (`lib/services/campaign-targets.ts`,
 *      já existente, §4.5.0 "regra de ouro").
 *   2. O disparo manual reusa `sendLeadMessage` (`lib/services/messages.ts`)
 *      — NUNCA uma segunda implementação do guard/rede. Ver `CampaignSendContext`
 *      lá.
 */
import { prisma, type Campaign, type CampaignInstance, type Prisma, type WhatsAppInstance } from '@inno/db';
import {
  countSpintaxVariations,
  deriveInstanceHealth,
  effectiveDailyLimit,
  firstName,
  hasCompanyNameMention,
  hasOptOutNotice,
  localDateKey,
  renderTemplate,
  resolveCampaignWindow,
  resolveSendPolicy,
  resolveSpintax,
  type TemplateVariableValues,
} from '@inno/core';
import type {
  CampaignAudienceExcluded,
  CampaignAudienceInput,
  CampaignDetail,
  CampaignEstimate,
  CampaignInstanceProgress,
  CampaignSettings,
  CampaignSettingsInput,
  CampaignSummary,
  CampaignTargetItem,
  CancelCampaignResponse,
  CreateCampaignBody,
  CreateCampaignResponse,
  ListCampaignsQuery,
  ListCampaignsResponse,
  ListCampaignTargetsQuery,
  ListCampaignTargetsResponse,
  PatchCampaignBody,
  PauseCampaignResponse,
  ResumeCampaignBody,
  ResumeCampaignResponse,
  SendCampaignTargetBody,
  SendCampaignTargetResponse,
  StartCampaignResponse,
} from '@inno/contracts';
import { ApiHttpError, conflict, notFound } from '@/lib/api-handler';
import { advanceCampaignTargetStatus } from '@/lib/services/campaign-targets';
import { resolveLeadWhere } from '@/lib/services/leads';
import { sendLeadMessage } from '@/lib/services/messages';
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────
// Config (env) — mesmo padrão de `messages.ts#*FromEnv`.
// ─────────────────────────────────────────────────────────────────────────

/** ARQUITETURA §10/§4.5.4 — teto de alvos materializados por `POST`/`PATCH`. */
function campaignMaxTargetsFromEnv(): number {
  const value = Number.parseInt(process.env.CAMPAIGN_MAX_TARGETS ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 5_000;
}

function appTimezone(): string {
  return process.env.APP_TIMEZONE || 'America/Sao_Paulo';
}

/**
 * 🆕 Fase 4.F.2 — religado para `localDateKey` de `@inno/core` (era uma
 * cópia manual do mesmo cálculo que existia, também duplicada, em
 * `whatsapp-instances.ts` e `messages.ts` — ver `local-date-key.ts` para o
 * porquê da unificação). Comportamento idêntico ao de antes.
 */
function todayDateKey(): Date {
  return localDateKey(new Date(), appTimezone());
}

// ─────────────────────────────────────────────────────────────────────────
// Settings — defaults efetivos (mesmos valores de `Campaign.*` no schema).
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_SEND_WINDOW = { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] };
const DEFAULT_JITTER_SECONDS = { min: 45, max: 180 };
const DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS = 30;

/** `settings?` inteiro ausente no `POST`/`PATCH` — Zod não roda os defaults internos porque o objeto todo nunca chega a ser parseado. Resolvidos aqui, manualmente, contra os MESMOS valores que `Campaign.*` usa como `@default` no schema. */
function resolveCampaignSettings(input: CampaignSettingsInput | undefined) {
  return {
    dailyLimitPerInstance: input?.dailyLimitPerInstance,
    sendWindow: input?.sendWindow ?? DEFAULT_SEND_WINDOW,
    jitterSeconds: input?.jitterSeconds ?? DEFAULT_JITTER_SECONDS,
    skipRecentlyContactedDays: input?.skipRecentlyContactedDays ?? DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
  };
}

/** Valor de EXIBIÇÃO de `dailyLimitPerInstance` quando o operador não fixou um (nulo = "usa a quota de warmup vigente", ARQUITETURA §4.5) — o menor teto efetivo entre as instâncias escolhidas HOJE. Puramente informativo: a coluna persistida continua `null`, o comportamento dinâmico é preservado. */
function displayDailyLimit(explicit: number | undefined, instances: readonly WhatsAppInstance[]): number {
  if (explicit !== undefined) return explicit;
  const limits = instances.map((i) => effectiveDailyLimit(i.warmupDay, i.dailyLimitOverride));
  return limits.length > 0 ? Math.min(...limits) : 20;
}

/** `estimate` (ARQUITETURA §4.5.4) — "estimativa, não promessa". Aproximação deliberada: dia-da-semana em UTC (não no fuso `APP_TIMEZONE`), aceitável para um número exibido como "cerca de N dias". */
function addBusinessDays(from: Date, days: number, daysOfWeek: readonly number[], endHour: number): Date {
  const result = new Date(from);
  let counted = 0;
  while (counted < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (daysOfWeek.includes(result.getUTCDay())) counted++;
  }
  result.setUTCHours(endHour, 0, 0, 0);
  return result;
}

function computeEstimate(
  eligibleCount: number,
  instances: readonly WhatsAppInstance[],
  dailyLimitPerInstance: number | undefined,
  sendWindow: { startHour: number; endHour: number; daysOfWeek: readonly number[] },
): CampaignEstimate {
  const perInstanceCapToday = instances.map((i) => {
    const eff = effectiveDailyLimit(i.warmupDay, i.dailyLimitOverride);
    return dailyLimitPerInstance !== undefined ? Math.min(eff, dailyLimitPerInstance) : eff;
  });
  const messagesPerDay = perInstanceCapToday.reduce((a, b) => a + b, 0) || 1;
  const days = Math.max(1, Math.ceil(eligibleCount / messagesPerDay));
  const finishesAround = addBusinessDays(new Date(), days, sendWindow.daysOfWeek, sendWindow.endHour);
  return { days, messagesPerDay, finishesAround: finishesAround.toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────
// Classificação de audiência (ARQUITETURA §4.5.4) — os 6 motivos de exclusão,
// em ordem de avaliação. Cada lead conta em UM motivo só (o primeiro que
// casar) — é isso que sustenta `totalMatched = eligible + Σ excluded`.
// ─────────────────────────────────────────────────────────────────────────

type AudienceCandidate = { id: string; phoneE164: string | null; phoneType: string; createdAt: Date };

async function loadCandidateLeads(audience: CampaignAudienceInput): Promise<AudienceCandidate[]> {
  if (audience.mode === 'ids') {
    return prisma.lead.findMany({
      where: { id: { in: audience.leadIds } },
      select: { id: true, phoneE164: true, phoneType: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  const where = await resolveLeadWhere(audience.filter);
  return prisma.lead.findMany({
    where,
    select: { id: true, phoneE164: true, phoneType: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Campanhas "vivas" para a regra 6 (`alreadyTargeted`) — não terminais. */
const NON_TERMINAL_CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'halted'] as const;

type AudienceClassification = {
  totalMatched: number;
  eligible: Array<{ id: string; phoneE164: string }>;
  excluded: CampaignAudienceExcluded;
};

/**
 * `excludeCampaignId` — usado por `PATCH /campaigns/:id` (recálculo de
 * audiência da PRÓPRIA campanha): a regra 6 não pode contar os alvos que a
 * campanha já tem como "de outra campanha".
 */
async function classifyAudience(
  audience: CampaignAudienceInput,
  skipRecentlyContactedDays: number,
  excludeCampaignId?: string,
): Promise<AudienceClassification> {
  const candidates = await loadCandidateLeads(audience);
  const totalMatched = candidates.length;
  const excluded: CampaignAudienceExcluded = { noPhone: 0, landline: 0, optedOut: 0, duplicatePhone: 0, recentlyContacted: 0, alreadyTargeted: 0 };

  let remaining = candidates.filter((c) => {
    if (!c.phoneE164) {
      excluded.noPhone++;
      return false;
    }
    return true;
  });

  // Regra 2 — fixo não recebe WhatsApp. Nota: `phoneType !== 'mobile'`
  // (não só `=== 'landline'`) — `unknown` também é excluído aqui, dentro do
  // MESMO motivo (ARQUITETURA §4.5.4 item 2, não existe `allowNonMobile` em
  // campanha).
  remaining = remaining.filter((c) => {
    if (c.phoneType !== 'mobile') {
      excluded.landline++;
      return false;
    }
    return true;
  });

  const phones = [...new Set(remaining.map((c) => c.phoneE164!))];
  const optedOutRows = phones.length > 0 ? await prisma.optOut.findMany({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } }) : [];
  const optedOutSet = new Set(optedOutRows.map((r) => r.phoneE164));
  remaining = remaining.filter((c) => {
    if (optedOutSet.has(c.phoneE164!)) {
      excluded.optedOut++;
      return false;
    }
    return true;
  });

  // Regra 4 — mesmo telefone, dois leads: mantém o mais antigo (ordenado
  // `createdAt asc` desde `loadCandidateLeads`).
  const seenPhones = new Set<string>();
  remaining = remaining.filter((c) => {
    if (seenPhones.has(c.phoneE164!)) {
      excluded.duplicatePhone++;
      return false;
    }
    seenPhones.add(c.phoneE164!);
    return true;
  });

  if (remaining.length > 0 && skipRecentlyContactedDays > 0) {
    const cutoff = new Date(Date.now() - skipRecentlyContactedDays * 24 * 60 * 60 * 1000);
    const leadIds = remaining.map((c) => c.id);
    const contactedRows = await prisma.message.findMany({
      where: { leadId: { in: leadIds }, direction: 'outbound', createdAt: { gte: cutoff } },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    const contactedSet = new Set(contactedRows.map((r) => r.leadId));
    remaining = remaining.filter((c) => {
      if (contactedSet.has(c.id)) {
        excluded.recentlyContacted++;
        return false;
      }
      return true;
    });
  }

  // Regra 6 (🆕 v1.2) — pendente em OUTRA campanha não terminal.
  if (remaining.length > 0) {
    const leadIds = remaining.map((c) => c.id);
    const targetedRows = await prisma.campaignTarget.findMany({
      where: {
        leadId: { in: leadIds },
        status: 'pending',
        campaign: {
          status: { in: [...NON_TERMINAL_CAMPAIGN_STATUSES] },
          ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
        },
      },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    const targetedSet = new Set(targetedRows.map((r) => r.leadId));
    remaining = remaining.filter((c) => {
      if (targetedSet.has(c.id)) {
        excluded.alreadyTargeted++;
        return false;
      }
      return true;
    });
  }

  return { totalMatched, eligible: remaining.map((c) => ({ id: c.id, phoneE164: c.phoneE164! })), excluded };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns
// ─────────────────────────────────────────────────────────────────────────

export async function createCampaign(body: CreateCampaignBody, createdById: string): Promise<CreateCampaignResponse> {
  const template = await prisma.messageTemplate.findUnique({ where: { id: body.templateId } });
  if (!template) notFound('Template não encontrado.', 'TEMPLATE_NOT_FOUND');

  const instances = await prisma.whatsAppInstance.findMany({ where: { id: { in: body.instanceIds } } });
  const foundIds = new Set(instances.map((i) => i.id));
  const missingInstanceIds = body.instanceIds.filter((id) => !foundIds.has(id));
  if (missingInstanceIds.length > 0) {
    throw new ApiHttpError(
      'NOT_FOUND',
      'Uma ou mais instâncias de WhatsApp não foram encontradas.',
      missingInstanceIds.map((id) => ({ path: id, message: 'Instância não encontrada.' })),
      'INSTANCE_NOT_FOUND',
    );
  }

  const settings = resolveCampaignSettings(body.settings);
  const classification = await classifyAudience(body.audience, settings.skipRecentlyContactedDays);

  if (classification.eligible.length === 0) {
    conflict('Nenhum lead elegível para esta campanha (todos foram excluídos — veja "excluded" na prévia).', undefined, 'EMPTY_AUDIENCE');
  }
  const maxTargets = campaignMaxTargetsFromEnv();
  if (classification.eligible.length > maxTargets) {
    conflict(
      `A audiência elegível (${classification.eligible.length}) excede o teto de ${maxTargets} alvos por campanha. Refine o filtro ou divida em mais de uma campanha.`,
      [{ path: 'audience', message: `eligible=${classification.eligible.length}, max=${maxTargets}` }],
      'AUDIENCE_TOO_LARGE',
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        name: body.name,
        templateId: body.templateId,
        audienceSnapshot: body.audience as unknown as Prisma.InputJsonValue,
        dailyLimitPerInstance: settings.dailyLimitPerInstance ?? null,
        sendWindowStartHour: settings.sendWindow.startHour,
        sendWindowEndHour: settings.sendWindow.endHour,
        sendWindowDaysOfWeek: settings.sendWindow.daysOfWeek,
        jitterMinSeconds: settings.jitterSeconds.min,
        jitterMaxSeconds: settings.jitterSeconds.max,
        skipRecentlyContactedDays: settings.skipRecentlyContactedDays,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
        status: body.scheduledFor ? 'scheduled' : 'draft',
        createdById,
        totalTargets: classification.eligible.length,
        instances: { create: body.instanceIds.map((instanceId) => ({ instanceId })) },
      },
    });

    // ARQUITETURA §4.5.2 — os alvos são materializados AGORA, não no `start`.
    await tx.campaignTarget.createMany({
      data: classification.eligible.map((lead) => ({
        campaignId: campaign.id,
        leadId: lead.id,
        phoneE164: lead.phoneE164,
        status: 'pending' as const,
      })),
    });

    return campaign;
  });

  logger.info('campanha criada', { campaignId: created.id, eligible: classification.eligible.length, totalMatched: classification.totalMatched });

  return {
    id: created.id,
    name: created.name,
    status: 'draft',
    templateId: created.templateId,
    instanceIds: body.instanceIds,
    audience: { totalMatched: classification.totalMatched, eligible: classification.eligible.length, excluded: classification.excluded },
    settings: {
      dailyLimitPerInstance: displayDailyLimit(settings.dailyLimitPerInstance, instances),
      sendWindow: settings.sendWindow,
      jitterSeconds: settings.jitterSeconds,
      skipRecentlyContactedDays: settings.skipRecentlyContactedDays,
    },
    estimate: computeEstimate(classification.eligible.length, instances, settings.dailyLimitPerInstance, settings.sendWindow),
    createdAt: created.createdAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns, GET /api/v1/campaigns/:id
// ─────────────────────────────────────────────────────────────────────────

type CampaignWithRelations = Campaign & { template: { name: string }; instances: (CampaignInstance & { instance: WhatsAppInstance })[] };

async function toCampaignSummary(campaign: CampaignWithRelations): Promise<CampaignSummary> {
  const pendingCount = await prisma.campaignTarget.count({ where: { campaignId: campaign.id, status: 'pending' } });

  let nextSendAt: string | null = null;
  if ((campaign.status === 'running' || campaign.status === 'scheduled') && pendingCount > 0) {
    const nextTarget = await prisma.campaignTarget.findFirst({
      where: { campaignId: campaign.id, status: 'pending' },
      orderBy: { scheduledFor: 'asc' },
      select: { scheduledFor: true },
    });
    if (nextTarget?.scheduledFor) {
      const gates = campaign.instances.map((ci) => ci.instance.nextSendAllowedAt).filter((d): d is Date => d !== null);
      const minGate = gates.length > 0 ? new Date(Math.min(...gates.map((d) => d.getTime()))) : null;
      const candidate = minGate && minGate.getTime() > nextTarget.scheduledFor.getTime() ? minGate : nextTarget.scheduledFor;
      nextSendAt = candidate.toISOString();
    }
  }

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    templateName: campaign.template.name,
    instanceCount: campaign.instances.length,
    stats: {
      total: campaign.totalTargets,
      pending: pendingCount,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      read: campaign.readCount,
      responded: campaign.respondedCount,
      failed: campaign.failedCount,
      skipped: campaign.skippedCount,
    },
    rates: {
      deliveryRate: campaign.sentCount > 0 ? campaign.deliveredCount / campaign.sentCount : 0,
      responseRate: campaign.sentCount > 0 ? campaign.respondedCount / campaign.sentCount : 0,
    },
    haltReason: campaign.haltReason,
    createdAt: campaign.createdAt.toISOString(),
    startedAt: campaign.startedAt?.toISOString() ?? null,
    finishedAt: campaign.finishedAt?.toISOString() ?? null,
    nextSendAt,
  };
}

const CAMPAIGN_LIST_INCLUDE = { template: { select: { name: true } }, instances: { include: { instance: true } } } as const;

export async function listCampaigns(query: ListCampaignsQuery): Promise<ListCampaignsResponse> {
  const where: Prisma.CampaignWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

  const [total, rows] = await Promise.all([
    prisma.campaign.count({ where }),
    prisma.campaign.findMany({
      where,
      include: CAMPAIGN_LIST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const data = await Promise.all(page.map((c) => toCampaignSummary(c)));
  return { data, page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total } };
}

function buildEffectiveSettings(campaign: Campaign, instances: readonly WhatsAppInstance[]): CampaignSettings {
  return {
    dailyLimitPerInstance: displayDailyLimit(campaign.dailyLimitPerInstance ?? undefined, instances),
    sendWindow: { startHour: campaign.sendWindowStartHour, endHour: campaign.sendWindowEndHour, daysOfWeek: campaign.sendWindowDaysOfWeek },
    jitterSeconds: { min: campaign.jitterMinSeconds, max: campaign.jitterMaxSeconds },
    skipRecentlyContactedDays: campaign.skipRecentlyContactedDays,
  };
}

export async function getCampaignDetail(id: string): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: CAMPAIGN_LIST_INCLUDE });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');

  const summary = await toCampaignSummary(campaign);
  const instances = campaign.instances.map((ci) => ci.instance);

  const today = todayDateKey();
  const todayStats = instances.length > 0
    ? await prisma.instanceDailyStat.findMany({ where: { instanceId: { in: instances.map((i) => i.id) }, date: today } })
    : [];
  const statByInstance = new Map(todayStats.map((s) => [s.instanceId, s.sentCount]));

  const perInstance: CampaignInstanceProgress[] = campaign.instances.map((ci) => {
    const tableLimit = effectiveDailyLimit(ci.instance.warmupDay, ci.instance.dailyLimitOverride);
    const cap = campaign.dailyLimitPerInstance !== null ? Math.min(tableLimit, campaign.dailyLimitPerInstance) : tableLimit;
    const sentToday = statByInstance.get(ci.instanceId) ?? 0;
    return {
      instanceId: ci.instanceId,
      name: ci.instance.name,
      sent: ci.sentCount,
      failed: ci.failedCount,
      quotaRemaining: Math.max(0, cap - sentToday),
      status: deriveInstanceHealth({ status: ci.instance.status, isDegraded: ci.instance.isDegraded, warmupDay: ci.instance.warmupDay }),
    };
  });

  return {
    ...summary,
    settings: buildEffectiveSettings(campaign, instances),
    renderedTemplateSnapshot: campaign.renderedTemplateSnapshot,
    perInstance,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns/:id/targets
// ─────────────────────────────────────────────────────────────────────────

export async function listCampaignTargets(campaignId: string, query: ListCampaignTargetsQuery): Promise<ListCampaignTargetsResponse> {
  const exists = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!exists) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');

  const where: Prisma.CampaignTargetWhereInput = { campaignId };
  if (query.status) where.status = query.status;

  const [total, rows] = await Promise.all([
    prisma.campaignTarget.count({ where }),
    prisma.campaignTarget.findMany({
      where,
      include: { lead: { select: { name: true } }, message: { select: { body: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const data: CampaignTargetItem[] = page.map((t) => ({
    id: t.id,
    leadId: t.leadId,
    leadName: t.lead.name,
    phoneE164: t.phoneE164,
    status: t.status,
    skipReason: t.skipReason,
    attempt: t.attempt,
    scheduledFor: t.scheduledFor?.toISOString() ?? null,
    sentAt: t.sentAt?.toISOString() ?? null,
    messagePreview: t.message?.body ? t.message.body.slice(0, 80) : null,
  }));

  return { data, page: { cursor: query.cursor ?? null, nextCursor, limit: query.limit, total } };
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/campaigns/:id (ARQUITETURA §4.5.5, A28)
// ─────────────────────────────────────────────────────────────────────────

/** Campos editáveis por estado — tabela normativa do §4.5.5. `running`/`completed`/`cancelled` = conjunto vazio (nada editável). */
const EDITABLE_FIELDS_BY_STATUS: Record<string, ReadonlySet<string>> = {
  draft: new Set(['name', 'templateId', 'instanceIds', 'audience', 'settings', 'scheduledFor']),
  scheduled: new Set(['name', 'templateId', 'instanceIds', 'audience', 'settings', 'scheduledFor']),
  paused: new Set(['name', 'instanceIds', 'settings']),
  halted: new Set(['name', 'instanceIds', 'settings']),
  running: new Set(),
  completed: new Set(),
  cancelled: new Set(),
};

export async function patchCampaign(id: string, body: PatchCampaignBody): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { instances: true } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');

  const allowed = EDITABLE_FIELDS_BY_STATUS[campaign.status] ?? new Set<string>();
  if (allowed.size === 0) {
    conflict('Esta campanha não pode ser editada no estado atual — pause-a primeiro.', [{ path: 'status', message: campaign.status }], 'CAMPAIGN_NOT_EDITABLE');
  }

  const requestedFields = Object.keys(body);
  const disallowedFields = requestedFields.filter((field) => !allowed.has(field));
  if (disallowedFields.length > 0) {
    conflict(
      `Campo(s) não editável(is) no estado "${campaign.status}": ${disallowedFields.join(', ')}.`,
      disallowedFields.map((field) => ({ path: field, message: `Não editável em status="${campaign.status}"` })),
      'FIELD_NOT_EDITABLE_IN_STATE',
    );
  }

  if (body.instanceIds !== undefined && body.instanceIds.length === 0) {
    conflict('A campanha precisa de ao menos uma instância.', undefined, 'LAST_INSTANCE_REMOVED');
  }

  await prisma.$transaction(async (tx) => {
    const data: Prisma.CampaignUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.scheduledFor !== undefined) data.scheduledFor = new Date(body.scheduledFor);

    if (body.templateId !== undefined) {
      const template = await tx.messageTemplate.findUnique({ where: { id: body.templateId } });
      if (!template) notFound('Template não encontrado.', 'TEMPLATE_NOT_FOUND');
      data.template = { connect: { id: body.templateId } };
    }

    let resolvedSettings: ReturnType<typeof resolveCampaignSettings> | undefined;
    if (body.settings !== undefined) {
      resolvedSettings = resolveCampaignSettings(body.settings);
      data.dailyLimitPerInstance = resolvedSettings.dailyLimitPerInstance ?? null;
      data.sendWindowStartHour = resolvedSettings.sendWindow.startHour;
      data.sendWindowEndHour = resolvedSettings.sendWindow.endHour;
      data.sendWindowDaysOfWeek = resolvedSettings.sendWindow.daysOfWeek;
      data.jitterMinSeconds = resolvedSettings.jitterSeconds.min;
      data.jitterMaxSeconds = resolvedSettings.jitterSeconds.max;
      data.skipRecentlyContactedDays = resolvedSettings.skipRecentlyContactedDays;
      // Reagendamento fino de alvos fora da janela nova (ARQUITETURA §4.5.5)
      // fica para quando o `dispatch-tick` existir de fato (Fase 4.F) — hoje
      // `scheduledFor` só importa para o disparo MANUAL, que não olha janela
      // além do que o guard (`evaluateSendGuard`) já checa a cada envio.
    }

    if (body.instanceIds !== undefined) {
      const currentIds = new Set(campaign.instances.map((ci) => ci.instanceId));
      const nextIds = new Set(body.instanceIds);
      const toAdd = body.instanceIds.filter((iid) => !currentIds.has(iid));
      const toRemove = campaign.instances.filter((ci) => !nextIds.has(ci.instanceId));

      if (toAdd.length > 0) {
        const found = await tx.whatsAppInstance.findMany({ where: { id: { in: toAdd } } });
        if (found.length !== toAdd.length) {
          const foundIds = new Set(found.map((i) => i.id));
          const missing = toAdd.filter((iid) => !foundIds.has(iid));
          throw new ApiHttpError('NOT_FOUND', 'Uma ou mais instâncias não foram encontradas.', missing.map((iid) => ({ path: iid, message: 'Instância não encontrada.' })), 'INSTANCE_NOT_FOUND');
        }
        await tx.campaignInstance.createMany({ data: toAdd.map((instanceId) => ({ campaignId: id, instanceId })) });
      }
      if (toRemove.length > 0) {
        await tx.campaignInstance.deleteMany({ where: { id: { in: toRemove.map((ci) => ci.id) } } });
      }
    }

    if (body.audience !== undefined) {
      const skipDays = resolvedSettings?.skipRecentlyContactedDays ?? campaign.skipRecentlyContactedDays;
      const classification = await classifyAudience(body.audience, skipDays, id);
      if (classification.eligible.length === 0) conflict('Nenhum lead elegível para esta campanha.', undefined, 'EMPTY_AUDIENCE');
      const maxTargets = campaignMaxTargetsFromEnv();
      if (classification.eligible.length > maxTargets) {
        conflict(`A audiência elegível (${classification.eligible.length}) excede o teto de ${maxTargets} alvos.`, undefined, 'AUDIENCE_TOO_LARGE');
      }

      // ARQUITETURA §4.5.5 — recalcula do zero: remove quem saiu, insere quem
      // entrou, MANTÉM quem permaneceu (preserva `createdAt`/ordem). Só toca
      // alvos `pending` — os que já saíram do funil (`sent`/`failed`/…) são
      // histórico e não são tocados por uma reedição de audiência.
      const nextLeadIds = new Set(classification.eligible.map((e) => e.id));
      const existingPending = await tx.campaignTarget.findMany({ where: { campaignId: id, status: 'pending' }, select: { id: true, leadId: true } });
      const existingLeadIds = new Set(existingPending.map((t) => t.leadId));

      const toDelete = existingPending.filter((t) => !nextLeadIds.has(t.leadId));
      const toInsert = classification.eligible.filter((e) => !existingLeadIds.has(e.id));

      if (toDelete.length > 0) await tx.campaignTarget.deleteMany({ where: { id: { in: toDelete.map((t) => t.id) } } });
      if (toInsert.length > 0) {
        await tx.campaignTarget.createMany({
          data: toInsert.map((lead) => ({ campaignId: id, leadId: lead.id, phoneE164: lead.phoneE164, status: 'pending' as const })),
        });
      }

      data.audienceSnapshot = body.audience as unknown as Prisma.InputJsonValue;
      data.totalTargets = await tx.campaignTarget.count({ where: { campaignId: id } });
    }

    if (Object.keys(data).length > 0) {
      await tx.campaign.update({ where: { id }, data });
    }
  });

  return getCampaignDetail(id);
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/campaigns/:id (ARQUITETURA §4.5.6)
// ─────────────────────────────────────────────────────────────────────────

export async function deleteCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');
  if (campaign.status !== 'draft') {
    conflict('Só é possível apagar campanhas em rascunho — campanhas que já iniciaram são histórico (use "cancel").', [{ path: 'status', message: campaign.status }], 'CAMPAIGN_NOT_DELETABLE');
  }
  await prisma.campaign.delete({ where: { id } }); // onDelete: Cascade limpa CampaignTarget/CampaignInstance.
}

// ─────────────────────────────────────────────────────────────────────────
// Validação de conteúdo do template no `start` (ARQUITETURA §4.5.10, nota
// final) — roda sobre a PARTE FIXA: spintax removido, `{{minha_empresa}}`
// resolvido. Verificar TODAS as variações seria combinatório; a parte fixa é
// O(1) e é a regra certa de qualquer forma (aviso que só aparece em 1 de 12
// variações não é aviso).
// ─────────────────────────────────────────────────────────────────────────

function stripSpintaxGroups(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2);
      const end = close === -1 ? text.length : close + 2;
      result += text.slice(i, end);
      i = end;
      continue;
    }
    if (text[i] === '{') {
      const close = text.indexOf('}', i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

function buildFixedPartForValidation(templateBody: string): string {
  const withoutSpintax = stripSpintaxGroups(templateBody);
  return renderTemplate(withoutSpintax, { minha_empresa: process.env.APP_COMPANY_NAME || undefined });
}

/** `alvos > 50` e `variações < 10` (ARQUITETURA §6.4/§4.5.9) — bloqueio, não aviso. */
const INSUFFICIENT_VARIATION_THRESHOLD = 10;
const INSUFFICIENT_VARIATION_TARGET_THRESHOLD = 50;

// ─────────────────────────────────────────────────────────────────────────
// Ações — POST /api/v1/campaigns/:id/{start|pause|resume|cancel} (§4.5.9)
// ─────────────────────────────────────────────────────────────────────────

export async function startCampaign(id: string): Promise<StartCampaignResponse> {
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { template: true, instances: { include: { instance: true } } } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    conflict('Campanha não pode ser iniciada no estado atual.', [{ path: 'status', message: campaign.status }], 'INVALID_CAMPAIGN_TRANSITION');
  }

  const badInstances = campaign.instances.filter((ci) => ci.instance.status !== 'connected');
  if (badInstances.length > 0) {
    conflict(
      'Uma ou mais instâncias não estão conectadas.',
      badInstances.map((ci) => ({ path: ci.instanceId, message: `${ci.instance.name}: status "${ci.instance.status}"` })),
      'INSTANCE_NOT_CONNECTED',
    );
  }

  const fixedPart = buildFixedPartForValidation(campaign.template.body);
  if (!hasOptOutNotice(fixedPart)) {
    conflict('O template desta campanha não contém um aviso de descadastro (ex.: "responda SAIR").', undefined, 'MISSING_OPTOUT_NOTICE');
  }
  if (!hasCompanyNameMention(fixedPart, process.env.APP_COMPANY_NAME)) {
    conflict('O template desta campanha não identifica quem está enviando (configure APP_COMPANY_NAME e mencione {{minha_empresa}}).', undefined, 'MISSING_COMPANY_NAME');
  }

  const variations = countSpintaxVariations(campaign.template.body);
  if (variations < INSUFFICIENT_VARIATION_THRESHOLD && campaign.totalTargets > INSUFFICIENT_VARIATION_TARGET_THRESHOLD) {
    conflict(
      `Este template gera apenas ${variations} variação(ões) de texto para ${campaign.totalTargets} alvos — risco de bloqueio por padrão repetitivo (ARQUITETURA §6.4). Adicione spintax ({opção a|opção b}).`,
      undefined,
      'INSUFFICIENT_TEXT_VARIATION',
    );
  }

  // 🆕 Fase 4.F.4 (ARQUITETURA §6.8.10/A32) — defesa em profundidade: o
  // contrato (`sendWindowSchema`) já recusa 0/6 na entrada desde esta rodada,
  // mas uma linha ANTIGA no banco (criada antes da restrição) pode ter
  // `sendWindowDaysOfWeek` que, intersectado com o piso da env, resulta numa
  // janela que NUNCA abre — a campanha ficaria `running` para sempre sem
  // enviar nada e sem explicação nenhuma na tela. Recusar aqui é a mesma
  // regra do "start que aceita uma campanha impossível é pior que um start
  // que recusa com motivo" (briefing da 4.F.4).
  const effectiveWindow = resolveCampaignWindow(resolveSendPolicy(process.env).sendWindow, {
    startHour: campaign.sendWindowStartHour,
    endHour: campaign.sendWindowEndHour,
    daysOfWeek: campaign.sendWindowDaysOfWeek,
  });
  const effectiveDaysOfWeek = effectiveWindow.businessWindow.daysOfWeek ?? [];
  const windowNeverOpens = effectiveDaysOfWeek.length === 0 || effectiveWindow.businessWindow.startHour >= effectiveWindow.businessWindow.endHour;
  if (windowNeverOpens) {
    conflict(
      'A janela de envio configurada para esta campanha (dias/horário), depois de combinada com o piso do ambiente, nunca abre — ajuste os dias da semana ou o horário nas configurações da campanha.',
      [{ path: 'settings.sendWindow', message: `dias efetivos: [${effectiveDaysOfWeek.join(',')}], horário efetivo: ${effectiveWindow.businessWindow.startHour}h-${effectiveWindow.businessWindow.endHour}h` }],
      'EMPTY_SEND_WINDOW',
    );
  }

  const pendingCountBefore = await prisma.campaignTarget.count({ where: { campaignId: id, status: 'pending' } });
  if (pendingCountBefore === 0) {
    conflict('Nenhum alvo pendente para iniciar esta campanha.', undefined, 'EMPTY_AUDIENCE');
  }

  const firstSendAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id }, data: { renderedTemplateSnapshot: campaign.template.body } });

    // Segunda passagem de exclusão (ARQUITETURA §4.5.2/§4.5.9 passo 7) —
    // opt-out/contato recente podem ter mudado entre criar e iniciar.
    const pendingTargets = await tx.campaignTarget.findMany({
      where: { campaignId: id, status: 'pending' },
      select: { id: true, phoneE164: true, leadId: true },
    });
    const phones = [...new Set(pendingTargets.map((t) => t.phoneE164))];
    const optedOutRows = phones.length > 0 ? await tx.optOut.findMany({ where: { phoneE164: { in: phones } }, select: { phoneE164: true } }) : [];
    const optedOutSet = new Set(optedOutRows.map((r) => r.phoneE164));

    const cutoff = new Date(Date.now() - campaign.skipRecentlyContactedDays * 24 * 60 * 60 * 1000);
    const leadIds = pendingTargets.map((t) => t.leadId);
    const recentRows = leadIds.length > 0
      ? await tx.message.findMany({ where: { leadId: { in: leadIds }, direction: 'outbound', createdAt: { gte: cutoff } }, select: { leadId: true }, distinct: ['leadId'] })
      : [];
    const recentSet = new Set(recentRows.map((r) => r.leadId));

    let stillPending = 0;
    for (const target of pendingTargets) {
      if (optedOutSet.has(target.phoneE164)) {
        await advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason: 'opted_out_before_start' });
      } else if (recentSet.has(target.leadId)) {
        await advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason: 'recently_contacted_before_start' });
      } else {
        stillPending++;
      }
    }

    if (stillPending === 0) {
      // Tudo que sobrava foi excluído na 2ª passagem — abortar a transação
      // (rollback) em vez de deixar a campanha "running" sem nenhum alvo.
      throw new ApiHttpError('CONFLICT', 'Nenhum alvo elegível restante após reavaliar opt-out/contato recente.', undefined, 'EMPTY_AUDIENCE');
    }

    await tx.campaignTarget.updateMany({ where: { campaignId: id, status: 'pending' }, data: { scheduledFor: firstSendAt } });
    return tx.campaign.update({ where: { id }, data: { status: 'running', startedAt: firstSendAt } });
  });

  logger.info('campanha iniciada', { campaignId: id, firstSendAt: firstSendAt.toISOString(), pendingCountBefore });

  return { ok: true, status: 'running', firstSendAt: updated.startedAt!.toISOString() };
}

export async function pauseCampaign(id: string): Promise<PauseCampaignResponse> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');
  if (campaign.status !== 'running') {
    conflict('Só é possível pausar uma campanha em execução.', [{ path: 'status', message: campaign.status }], 'INVALID_CAMPAIGN_TRANSITION');
  }

  await prisma.campaign.update({ where: { id }, data: { status: 'paused' } });
  // Envio em voo termina normalmente; alvos `pending` continuam `pending`
  // (ARQUITETURA §4.5.1 invariante 4) — não há cancelamento de envio no meio.
  const pendingTargets = await prisma.campaignTarget.count({ where: { campaignId: id, status: 'pending' } });
  return { ok: true, status: 'paused', pendingTargets };
}

export async function resumeCampaign(id: string, body: ResumeCampaignBody): Promise<ResumeCampaignResponse> {
  const campaign = await prisma.campaign.findUnique({ where: { id }, include: { instances: { include: { instance: true } } } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');

  if (campaign.status !== 'paused' && campaign.status !== 'halted') {
    conflict('Campanha não pode ser retomada no estado atual.', [{ path: 'status', message: campaign.status }], 'INVALID_CAMPAIGN_TRANSITION');
  }
  if (campaign.status === 'halted' && !body.acknowledgeHalt) {
    conflict(
      'É preciso confirmar que você entende o motivo da parada (acknowledgeHalt: true) antes de retomar.',
      campaign.haltReason ? [{ path: 'haltReason', message: campaign.haltReason }] : undefined,
      'HALT_NOT_ACKNOWLEDGED',
    );
  }

  const badInstances = campaign.instances.filter((ci) => ci.instance.status !== 'connected');
  if (badInstances.length > 0) {
    conflict(
      'Uma ou mais instâncias ainda não estão conectadas — retomar agora só pararia de novo em instantes.',
      badInstances.map((ci) => ({ path: ci.instanceId, message: `${ci.instance.name}: status "${ci.instance.status}"` })),
      'INSTANCE_NOT_CONNECTED',
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id }, data: { status: 'running', haltReason: null } });
    await tx.campaignTarget.updateMany({ where: { campaignId: id, status: 'pending' }, data: { scheduledFor: now } });
  });

  logger.info('campanha retomada', { campaignId: id, fromStatus: campaign.status });
  return { ok: true, status: 'running' };
}

export async function cancelCampaign(id: string): Promise<CancelCampaignResponse> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');
  if (!['draft', 'scheduled', 'running', 'paused', 'halted'].includes(campaign.status)) {
    conflict('Campanha já está num estado terminal.', [{ path: 'status', message: campaign.status }], 'INVALID_CAMPAIGN_TRANSITION');
  }

  const cancelledTargets = await prisma.$transaction(async (tx) => {
    const pendingTargets = await tx.campaignTarget.findMany({ where: { campaignId: id, status: 'pending' }, select: { id: true } });
    for (const target of pendingTargets) {
      await advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason: 'campaign_cancelled' });
    }
    await tx.campaign.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } });
    return pendingTargets.length;
  });

  logger.info('campanha cancelada', { campaignId: id, cancelledTargets });
  return { ok: true, cancelledTargets };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns/:id/targets/:targetId/send — disparo MANUAL
// (ARQUITETURA: "nenhum laço automático nesta rodada"). Reusa
// `sendLeadMessage` — o único portão de envio do sistema.
// ─────────────────────────────────────────────────────────────────────────

/** Duplicado de propósito de `messages.ts#buildLeadTemplateValues` — mesma convenção do monorepo (regra 4, `convention-api-routes-fase1`): módulos de serviço não importam função privada um do outro. */
function buildLeadTemplateValues(lead: { name: string; city: { name: string } | null; uf: string; category: string | null; website: string | null; phoneE164: string | null }): TemplateVariableValues {
  return {
    nome: lead.name,
    primeiro_nome: firstName(lead.name),
    cidade: lead.city?.name,
    uf: lead.uf,
    categoria: lead.category ?? undefined,
    site: lead.website ?? undefined,
    telefone: lead.phoneE164 ?? undefined,
    minha_empresa: process.env.APP_COMPANY_NAME || undefined,
  };
}

export async function sendCampaignTargetMessage(
  campaignId: string,
  targetId: string,
  body: SendCampaignTargetBody,
  actor: { id: string; role: string },
): Promise<SendCampaignTargetResponse> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { instances: true } });
  if (!campaign) notFound('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND');
  if (campaign.status !== 'running') {
    conflict('Só é possível disparar mensagens de uma campanha em execução.', [{ path: 'status', message: campaign.status }], 'CAMPAIGN_NOT_RUNNING');
  }
  if (!campaign.renderedTemplateSnapshot) {
    // Defensivo — não deveria acontecer: toda campanha `running` passou pelo `start`, que congela o snapshot.
    conflict('Esta campanha ainda não tem um template congelado.', undefined, 'CAMPAIGN_NOT_RUNNING');
  }

  const target = await prisma.campaignTarget.findUnique({ where: { id: targetId } });
  if (!target || target.campaignId !== campaignId) notFound('Alvo não encontrado nesta campanha.', 'TARGET_NOT_FOUND');
  if (target.status !== 'pending') {
    conflict('Este alvo já foi processado (não está mais pendente).', [{ path: 'status', message: target.status }], 'TARGET_NOT_PENDING');
  }

  const lead = await prisma.lead.findUnique({ where: { id: target.leadId }, include: { city: { select: { name: true } } } });
  if (!lead) notFound('Lead deste alvo não foi encontrado.', 'LEAD_NOT_FOUND');

  // Texto final a partir do SNAPSHOT congelado (nunca do MessageTemplate
  // vivo — editar o template depois de `start` não pode afetar a campanha,
  // ARQUITETURA §3.2 regra 5). Semente = `target.id`: o MESMO alvo, em
  // retry, recebe o MESMO texto (ARQUITETURA §6.4).
  const values = buildLeadTemplateValues(lead);
  const rendered = renderTemplate(campaign.renderedTemplateSnapshot, values);
  const finalText = resolveSpintax(rendered, { seed: target.id });

  const allowedInstanceIds = campaign.instances.map((ci) => ci.instanceId);

  return sendLeadMessage(
    target.leadId,
    {
      body: finalText,
      instanceId: body.instanceId,
      confirmOutsideBusinessWindow: false,
      allowNonMobile: false,
    },
    actor,
    { targetId: target.id, campaignId: campaign.id, allowedInstanceIds },
  );
}
