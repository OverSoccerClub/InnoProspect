/**
 * campaign.contract.ts — Campanhas de disparo (ARQUITETURA §4.5, §6). Estado
 * ainda não modelado no Prisma (Fase 4) — este arquivo é a fonte da verdade
 * até Cronos criar `Campaign`/`CampaignTarget`.
 */
import { z } from 'zod';
import {
  campaignStatusSchema,
  campaignTargetStatusSchema,
  e164Schema,
  idSchema,
  isoDateTimeSchema,
  paginatedSchema,
  paginationQuerySchema,
} from './common.js';
import { leadFilterSchema } from './lead.contract.js';

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns
// ─────────────────────────────────────────────────────────────────────────

export const campaignAudienceInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ids'), leadIds: z.array(idSchema).min(1) }),
  z.object({ mode: z.literal('filter'), filter: leadFilterSchema }),
]);
export type CampaignAudienceInput = z.infer<typeof campaignAudienceInputSchema>;

export const sendWindowSchema = z.object({
  startHour: z.number().int().min(8).max(20),
  endHour: z.number().int().min(8).max(20),
  /** 0=domingo .. 6=sábado. */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
});
export type SendWindow = z.infer<typeof sendWindowSchema>;

/** Jitter mínimo de 30s é obrigatório (ARQUITETURA §4.5, §6.3). */
export const jitterSecondsSchema = z
  .object({
    min: z.number().int().min(30),
    max: z.number().int().min(30),
  })
  .refine((j) => j.max >= j.min, { message: 'jitterSeconds.max deve ser >= jitterSeconds.min' });
export type JitterSeconds = z.infer<typeof jitterSecondsSchema>;

export const campaignSettingsInputSchema = z.object({
  dailyLimitPerInstance: z.number().int().min(1).optional(),
  sendWindow: sendWindowSchema.optional(),
  jitterSeconds: jitterSecondsSchema.optional(),
  skipRecentlyContactedDays: z.number().int().min(0).default(30),
});
export type CampaignSettingsInput = z.infer<typeof campaignSettingsInputSchema>;

export const createCampaignBodySchema = z.object({
  name: z.string().trim().min(3).max(120),
  templateId: idSchema,
  /** 1..n instâncias; rotação round-robin ponderada por quota. */
  instanceIds: z.array(idSchema).min(1),
  audience: campaignAudienceInputSchema,
  settings: campaignSettingsInputSchema.optional(),
  scheduledFor: isoDateTimeSchema.optional(),
});
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

/** Settings efetivas devolvidas pela API, com defaults já resolvidos. */
export const campaignSettingsSchema = z.object({
  dailyLimitPerInstance: z.number().int().min(1),
  sendWindow: sendWindowSchema,
  jitterSeconds: jitterSecondsSchema,
  skipRecentlyContactedDays: z.number().int().min(0),
});
export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

/** `audience.excluded` — motivos pelos quais `totalMatched` virou `eligible`. */
export const campaignAudienceExcludedSchema = z.object({
  optedOut: z.number().int().min(0),
  landline: z.number().int().min(0),
  noPhone: z.number().int().min(0),
  recentlyContacted: z.number().int().min(0),
  duplicatePhone: z.number().int().min(0),
});
export type CampaignAudienceExcluded = z.infer<typeof campaignAudienceExcludedSchema>;

export const campaignAudienceSummarySchema = z.object({
  totalMatched: z.number().int().min(0),
  eligible: z.number().int().min(0),
  excluded: campaignAudienceExcludedSchema,
});
export type CampaignAudienceSummary = z.infer<typeof campaignAudienceSummarySchema>;

export const campaignEstimateSchema = z.object({
  days: z.number().min(0),
  messagesPerDay: z.number().min(0),
  finishesAround: isoDateTimeSchema,
});
export type CampaignEstimate = z.infer<typeof campaignEstimateSchema>;

/** `201` de `POST /api/v1/campaigns` — cria em `draft`, NÃO dispara. */
export const createCampaignResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.literal('draft'),
  templateId: idSchema,
  instanceIds: z.array(idSchema),
  audience: campaignAudienceSummarySchema,
  settings: campaignSettingsSchema,
  estimate: campaignEstimateSchema,
  createdAt: isoDateTimeSchema,
});
export type CreateCampaignResponse = z.infer<typeof createCampaignResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns
// ─────────────────────────────────────────────────────────────────────────

export const campaignStatsSchema = z.object({
  total: z.number().int().min(0),
  pending: z.number().int().min(0),
  sent: z.number().int().min(0),
  delivered: z.number().int().min(0),
  read: z.number().int().min(0),
  responded: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type CampaignStats = z.infer<typeof campaignStatsSchema>;

export const campaignRatesSchema = z.object({
  deliveryRate: z.number().min(0).max(1),
  responseRate: z.number().min(0).max(1),
});
export type CampaignRates = z.infer<typeof campaignRatesSchema>;

export const campaignSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  status: campaignStatusSchema,
  templateName: z.string(),
  instanceCount: z.number().int().min(0),
  stats: campaignStatsSchema,
  rates: campaignRatesSchema,
  /** Preenchido quando `status === 'halted'` (ARQUITETURA §6.6). */
  haltReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  nextSendAt: isoDateTimeSchema.nullable(),
});
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusSchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const listCampaignsResponseSchema = paginatedSchema(campaignSummarySchema);
export type ListCampaignsResponse = z.infer<typeof listCampaignsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns/:id
// ─────────────────────────────────────────────────────────────────────────

export const campaignInstanceProgressSchema = z.object({
  instanceId: idSchema,
  name: z.string(),
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  quotaRemaining: z.number().int().min(0),
  status: z.string(),
});
export type CampaignInstanceProgress = z.infer<typeof campaignInstanceProgressSchema>;

export const campaignDetailSchema = campaignSummarySchema.extend({
  settings: campaignSettingsSchema,
  /** Corpo do template congelado no `start` — editar o template depois não afeta. */
  renderedTemplateSnapshot: z.string().nullable(),
  perInstance: z.array(campaignInstanceProgressSchema),
});
export type CampaignDetail = z.infer<typeof campaignDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns/:id/targets
// ─────────────────────────────────────────────────────────────────────────

export const campaignTargetItemSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  leadName: z.string(),
  phoneE164: e164Schema,
  status: campaignTargetStatusSchema,
  skipReason: z.string().nullable(),
  attempt: z.number().int().min(0),
  scheduledFor: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  messagePreview: z.string().nullable(),
});
export type CampaignTargetItem = z.infer<typeof campaignTargetItemSchema>;

export const listCampaignTargetsQuerySchema = paginationQuerySchema.extend({
  status: campaignTargetStatusSchema.optional(),
});
export type ListCampaignTargetsQuery = z.infer<typeof listCampaignTargetsQuerySchema>;

export const listCampaignTargetsResponseSchema = paginatedSchema(campaignTargetItemSchema);
export type ListCampaignTargetsResponse = z.infer<typeof listCampaignTargetsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Ações — POST /api/v1/campaigns/:id/{action}  (ARQUITETURA §4.5)
// ─────────────────────────────────────────────────────────────────────────

export const campaignActionSchema = z.enum(['start', 'pause', 'resume', 'cancel']);
export type CampaignAction = z.infer<typeof campaignActionSchema>;

/** Body de `resume` — de `halted` exige `acknowledgeHalt: true`. */
export const resumeCampaignBodySchema = z.object({
  acknowledgeHalt: z.boolean().optional(),
});
export type ResumeCampaignBody = z.infer<typeof resumeCampaignBodySchema>;

export const startCampaignResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('running'),
  firstSendAt: isoDateTimeSchema,
});
export type StartCampaignResponse = z.infer<typeof startCampaignResponseSchema>;

export const pauseCampaignResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('paused'),
  pendingTargets: z.number().int().min(0),
});
export type PauseCampaignResponse = z.infer<typeof pauseCampaignResponseSchema>;

export const resumeCampaignResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('running'),
});
export type ResumeCampaignResponse = z.infer<typeof resumeCampaignResponseSchema>;

export const cancelCampaignResponseSchema = z.object({
  ok: z.literal(true),
  cancelledTargets: z.number().int().min(0),
});
export type CancelCampaignResponse = z.infer<typeof cancelCampaignResponseSchema>;
