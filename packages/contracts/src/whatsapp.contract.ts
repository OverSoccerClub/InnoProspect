/**
 * whatsapp.contract.ts — Instâncias de WhatsApp / Evolution API (ARQUITETURA
 * §4.6). Estado ainda não modelado no Prisma (Fase 3) — este arquivo é a
 * fonte da verdade até Cronos criar `WhatsAppInstance`/`InstanceDailyStat`.
 */
import { z } from 'zod';
import {
  idSchema,
  instanceHealthSchema,
  isoDateTimeSchema,
  messageDirectionSchema,
  messageStatusSchema,
  whatsAppInstanceStatusSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances
// ─────────────────────────────────────────────────────────────────────────

export const instanceWarmupSchema = z.object({
  day: z.number().int().min(1),
  dailyLimit: z.number().int().min(1),
  /** `true` quando já passou do ramp-up (dia 22+, ARQUITETURA §6.2). */
  isWarm: z.boolean(),
});
export type InstanceWarmup = z.infer<typeof instanceWarmupSchema>;

export const instanceTodayStatsSchema = z.object({
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  responded: z.number().int().min(0),
  remaining: z.number().int().min(0),
});
export type InstanceTodayStats = z.infer<typeof instanceTodayStatsSchema>;

export const whatsAppInstanceItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  phoneNumber: z.string().nullable(),
  status: whatsAppInstanceStatusSchema,
  health: instanceHealthSchema,
  warmup: instanceWarmupSchema,
  today: instanceTodayStatsSchema,
  lastConnectionAt: isoDateTimeSchema.nullable(),
  lastErrorAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  activeCampaigns: z.number().int().min(0),
});
export type WhatsAppInstanceItem = z.infer<typeof whatsAppInstanceItemSchema>;

export const listWhatsAppInstancesResponseSchema = z.object({
  data: z.array(whatsAppInstanceItemSchema),
});
export type ListWhatsAppInstancesResponse = z.infer<typeof listWhatsAppInstancesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/whatsapp/instances
// ─────────────────────────────────────────────────────────────────────────

export const createWhatsAppInstanceBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  startWarmup: z.boolean().default(true),
});
export type CreateWhatsAppInstanceBody = z.infer<typeof createWhatsAppInstanceBodySchema>;

export const createWhatsAppInstanceResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.literal('qr_pending'),
  evolutionInstanceName: z.string(),
});
export type CreateWhatsAppInstanceResponse = z.infer<typeof createWhatsAppInstanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances/:id/qr
// ─────────────────────────────────────────────────────────────────────────

export const getQrCodeResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('qr_pending'),
    qrCodeBase64: z.string(),
    expiresInSeconds: z.number().int().min(0),
    pairingCode: z.string().optional(),
  }),
  z.object({
    status: z.literal('connected'),
    qrCodeBase64: z.null(),
  }),
]);
export type GetQrCodeResponse = z.infer<typeof getQrCodeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances/:id
// ─────────────────────────────────────────────────────────────────────────

export const instanceDailyStatSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  sentCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  respondedCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
});
export type InstanceDailyStat = z.infer<typeof instanceDailyStatSchema>;

/** `GET /api/v1/whatsapp/instances/:id` — objeto completo + histórico de 30 dias. */
export const whatsAppInstanceDetailSchema = whatsAppInstanceItemSchema.extend({
  history: z.array(instanceDailyStatSchema),
});
export type WhatsAppInstanceDetail = z.infer<typeof whatsAppInstanceDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Ações
// ─────────────────────────────────────────────────────────────────────────

export const connectInstanceResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('qr_pending'),
});
export type ConnectInstanceResponse = z.infer<typeof connectInstanceResponseSchema>;

export const disconnectInstanceResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('disconnected'),
  pausedCampaigns: z.array(idSchema),
});
export type DisconnectInstanceResponse = z.infer<typeof disconnectInstanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Message — modelo completo (Fase 3+), reaproveitado por lead/campaign quando
// precisarem do detalhe completo de uma mensagem (aqui só o essencial).
// ─────────────────────────────────────────────────────────────────────────

export const messageItemSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  campaignTargetId: idSchema.nullable(),
  instanceId: idSchema,
  direction: messageDirectionSchema,
  body: z.string(),
  providerMessageId: z.string().nullable(),
  status: messageStatusSchema,
  errorCode: z.string().nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  readAt: isoDateTimeSchema.nullable(),
});
export type MessageItem = z.infer<typeof messageItemSchema>;
