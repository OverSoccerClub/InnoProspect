/**
 * common.ts — envelope de resposta, paginação, erro e enums compartilhados
 * entre TODOS os contratos de API. Ver ARQUITETURA.md §4.0.
 *
 * ⚠️ Os enums abaixo marcados "CONTRATO — espelha Prisma" têm que bater,
 * valor por valor e na mesma ordem de aparição, com os enums equivalentes em
 * `packages/db/prisma/schema.prisma`. Isso não é garantido "de olho": veja
 * `src/__tests__/enum-parity.test.ts`, que importa os dois lados e falha se
 * alguém mudar um sem mudar o outro. Enums que ainda não existem no Prisma
 * (Campaign*, Message*, WhatsApp*, OptOut* — chegam nas Fases 3/4) são fonte
 * da verdade AQUI até Cronos os modelar; quando modelar, entram no teste.
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Primitivos
// ─────────────────────────────────────────────────────────────────────────

/** IDs de entidade operacional são cuid2 (ARQUITETURA §4.0). */
export const idSchema = z.cuid2();

/** Datas sempre ISO 8601 em UTC (ex.: `2026-07-30T14:03:00.000Z`, ARQUITETURA §4.0). */
export const isoDateTimeSchema = z.iso.datetime();

/**
 * Telefone sempre em E.164 na resposta (ARQUITETURA §4.0). Ex.: "+5511987654321".
 * O bruto (como veio do scraping) fica em `phoneRaw`, sem essa validação.
 */
export const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Telefone deve estar em E.164 (ex.: +5511987654321)');

/** UF: sigla de 2 letras maiúsculas. */
export const ufSchema = z.string().length(2).regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras maiúsculas');

/** Código IBGE de município: 7 dígitos, preservando zero à esquerda. */
export const ibgeCodeSchema = z.string().regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos');

// ─────────────────────────────────────────────────────────────────────────
// Enums — CONTRATO, espelham packages/db/prisma/schema.prisma
// ─────────────────────────────────────────────────────────────────────────

export const leadStatusSchema = z.enum([
  'new',
  'validated',
  'contacted',
  'responded',
  'negotiating',
  'won',
  'discarded',
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const phoneTypeSchema = z.enum(['mobile', 'landline', 'unknown']);
export type PhoneType = z.infer<typeof phoneTypeSchema>;

export const searchJobStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export type SearchJobStatus = z.infer<typeof searchJobStatusSchema>;

export const searchTaskStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);
export type SearchTaskStatus = z.infer<typeof searchTaskStatusSchema>;

export const leadActivityActorSchema = z.enum(['user', 'system', 'lead']);
export type LeadActivityActor = z.infer<typeof leadActivityActorSchema>;

export const leadSourceTypeSchema = z.enum(['google_maps_scrape']);
export type LeadSourceType = z.infer<typeof leadSourceTypeSchema>;

export const userRoleSchema = z.enum(['admin', 'operator']);
export type UserRole = z.infer<typeof userRoleSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Enums — ainda não modelados no Prisma (Fases 3/4). Fonte da verdade aqui
// até existir model correspondente; ver ARQUITETURA §3.1 / §4.5-§4.8.
// ─────────────────────────────────────────────────────────────────────────

export const campaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'cancelled',
  'halted',
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignTargetStatusSchema = z.enum([
  'pending',
  'sent',
  'delivered',
  'read',
  'responded',
  'failed',
  'skipped',
]);
export type CampaignTargetStatus = z.infer<typeof campaignTargetStatusSchema>;

export const messageStatusSchema = z.enum(['queued', 'sent', 'delivered', 'read', 'failed']);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const messageDirectionSchema = z.enum(['outbound', 'inbound']);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const whatsAppInstanceStatusSchema = z.enum([
  'disconnected',
  'connecting',
  'qr_pending',
  'connected',
  'banned',
]);
export type WhatsAppInstanceStatus = z.infer<typeof whatsAppInstanceStatusSchema>;

/** Estado derivado exibido na UI (ARQUITETURA §4.6) — distinto de `status`. */
export const instanceHealthSchema = z.enum(['ok', 'warming', 'degraded', 'blocked']);
export type InstanceHealth = z.infer<typeof instanceHealthSchema>;

export const optOutSourceSchema = z.enum(['reply', 'manual', 'public_link', 'request']);
export type OptOutSource = z.infer<typeof optOutSourceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Paginação (ARQUITETURA §4.0 — cursor, default limit 25, máx 100)
// ─────────────────────────────────────────────────────────────────────────

export const pageInfoSchema = z.object({
  cursor: z.string().nullable(),
  nextCursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    page: pageInfoSchema,
  });
}
export type Paginated<T> = { data: T[]; page: PageInfo };

/** Query string comum a toda listagem paginada: `?cursor=<id>&limit=<1..100>`. */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Helper para query params CSV (`?status=a,b,c`). URLSearchParams sempre
 * entrega string — isto faz o split, remove vazios e valida cada item contra
 * `itemSchema`. String vazia/ausente vira `undefined` (filtro não aplicado).
 */
export function csvQuerySchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess((val) => {
    if (val === undefined || val === null) return undefined;
    if (Array.isArray(val)) return val;
    if (typeof val !== 'string') return val;
    const items = val
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  }, z.array(itemSchema).optional());
}

/** Idem `csvQuerySchema`, mas para `?flag=true|false` vindo de query string. */
export const booleanQuerySchema = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return val;
}, z.boolean().optional());

// ─────────────────────────────────────────────────────────────────────────
// Erro (ARQUITETURA §4.0 — envelope de erro de TODAS as rotas)
// ─────────────────────────────────────────────────────────────────────────

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Mapa fixo código → status HTTP, na convenção declarada em ARQUITETURA §4.0
 * ("Códigos HTTP usados: 200, 201, 202, 204, 400, 401, 403, 404, 409, 422,
 * 429, 500, 502"). `api-handler.ts` (Vega/Lyra) usa isto para não hardcodar
 * o número em cada rota.
 */
export const API_ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Monta o envelope de erro padrão. `requestId` deve vir do middleware de
 * observabilidade (Vega) — se ausente, gera um UUID para nunca devolver
 * resposta sem `requestId` (é o campo que liga o erro ao log estruturado).
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  opts?: { details?: ApiErrorDetail[]; requestId?: string },
): ApiError {
  return {
    error: {
      code,
      message,
      ...(opts?.details && opts.details.length > 0 ? { details: opts.details } : {}),
      requestId: opts?.requestId ?? crypto.randomUUID(),
    },
  };
}
