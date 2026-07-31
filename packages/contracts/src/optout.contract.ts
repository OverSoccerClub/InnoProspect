/**
 * optout.contract.ts — Opt-out / blacklist (ARQUITETURA §4.7, §6.7). Não
 * listado nominalmente no plano de arquivos de Nova, mas §4.7 é CONTRATO —
 * incluído aqui para não deixar a API de opt-out sem tipos (é a peça mais
 * crítica do sistema em termos de risco, ARQUITETURA §3.1).
 */
import { z } from 'zod';
import { e164Schema, idSchema, isoDateTimeSchema, optOutSourceSchema, paginatedSchema, paginationQuerySchema } from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/optouts
// ─────────────────────────────────────────────────────────────────────────

export const optOutItemSchema = z.object({
  id: idSchema,
  phoneE164: e164Schema,
  source: optOutSourceSchema,
  leadName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type OptOutItem = z.infer<typeof optOutItemSchema>;

export const listOptOutsResponseSchema = paginatedSchema(optOutItemSchema);
export type ListOptOutsResponse = z.infer<typeof listOptOutsResponseSchema>;
export const listOptOutsQuerySchema = paginationQuerySchema;
export type ListOptOutsQuery = z.infer<typeof listOptOutsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/optouts (autenticado, operador registra manualmente)
// ─────────────────────────────────────────────────────────────────────────

export const createOptOutBodySchema = z.object({
  phoneE164: e164Schema,
  reason: z.string().trim().max(500).optional(),
  source: z.enum(['manual', 'request']).default('manual'),
});
export type CreateOptOutBody = z.infer<typeof createOptOutBodySchema>;

export const createOptOutResponseSchema = z.object({
  id: idSchema,
  phoneE164: e164Schema,
  createdAt: isoDateTimeSchema,
  /** Quantos CampaignTarget pendentes foram marcados `skipped` na mesma transação. */
  affectedTargets: z.number().int().min(0),
});
export type CreateOptOutResponse = z.infer<typeof createOptOutResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/public/optout — página pública `/descadastro/:token`, sem auth
// ─────────────────────────────────────────────────────────────────────────

export const publicOptOutBodySchema = z.object({
  token: z.string().min(1),
  confirm: z.literal(true),
});
export type PublicOptOutBody = z.infer<typeof publicOptOutBodySchema>;

export const publicOptOutResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});
export type PublicOptOutResponse = z.infer<typeof publicOptOutResponseSchema>;
