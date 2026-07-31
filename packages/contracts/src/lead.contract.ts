/**
 * lead.contract.ts — Leads (ARQUITETURA §4.3). CONTRATO — Vega implementa,
 * Lyra consome. `leadFilterSchema` é reaproveitado por `POST /leads/bulk`
 * (`filter`) e por `POST /campaigns` (`audience.filter`, ver
 * campaign.contract.ts) — é literalmente o mesmo filtro em três lugares.
 */
import { z } from 'zod';
import {
  booleanQuerySchema,
  csvQuerySchema,
  e164Schema,
  ibgeCodeSchema,
  idSchema,
  isoDateTimeSchema,
  leadActivityActorSchema,
  leadSourceTypeSchema,
  leadStatusSchema,
  messageDirectionSchema,
  messageStatusSchema,
  paginatedSchema,
  paginationQuerySchema,
  phoneTypeSchema,
  ufSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// Filtro compartilhado (GET /leads, POST /leads/bulk, POST /campaigns)
// ─────────────────────────────────────────────────────────────────────────

export const leadSortFieldSchema = z.enum(['createdAt', 'name', 'rating', 'reviewCount']);
export type LeadSortField = z.infer<typeof leadSortFieldSchema>;

export const leadSortDirectionSchema = z.enum(['asc', 'desc']);
export type LeadSortDirection = z.infer<typeof leadSortDirectionSchema>;

/**
 * Aceita o formato de query `sort=campo:direção` (ex.: `"rating:desc"`) e
 * normaliza para `{ field, direction }`. Default `createdAt:desc`.
 */
export const leadSortSchema = z
  .string()
  .default('createdAt:desc')
  .transform((val, ctx) => {
    const [field, direction = 'desc'] = val.split(':');
    const parsedField = leadSortFieldSchema.safeParse(field);
    const parsedDirection = leadSortDirectionSchema.safeParse(direction);
    if (!parsedField.success || !parsedDirection.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'sort deve ser "<campo>:<asc|desc>", campo em createdAt|name|rating|reviewCount',
      });
      return z.NEVER;
    }
    return { field: parsedField.data, direction: parsedDirection.data };
  });

/** Filtro combinável (AND) de leads — ARQUITETURA §4.3, tabela de query params. */
export const leadFilterSchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  status: csvQuerySchema(leadStatusSchema),
  uf: csvQuerySchema(ufSchema),
  cityIbgeCode: csvQuerySchema(ibgeCodeSchema),
  category: csvQuerySchema(z.string()),
  searchJobId: idSchema.optional(),
  hasWebsite: booleanQuerySchema,
  hasPhone: booleanQuerySchema,
  phoneType: phoneTypeSchema.optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  tags: csvQuerySchema(z.string()),
  /** default `false` = esconde opt-outs (ARQUITETURA §4.3). */
  optedOut: booleanQuerySchema,
  contactedInCampaign: booleanQuerySchema,
  createdFrom: isoDateTimeSchema.optional(),
  createdTo: isoDateTimeSchema.optional(),
});
export type LeadFilter = z.infer<typeof leadFilterSchema>;

/** `GET /api/v1/leads` — filtro + paginação + ordenação. */
export const listLeadsQuerySchema = leadFilterSchema.merge(paginationQuerySchema).extend({
  sort: leadSortSchema,
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Item de listagem e resposta
// ─────────────────────────────────────────────────────────────────────────

export const leadListItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  phoneE164: e164Schema.nullable(),
  phoneType: phoneTypeSchema,
  address: z.string().nullable(),
  city: z.string().nullable(),
  uf: ufSchema.nullable(),
  website: z.string().nullable(),
  category: z.string().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().min(0).nullable(),
  status: leadStatusSchema,
  tags: z.array(z.string()),
  isOptedOut: z.boolean(),
  lastContactedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type LeadListItem = z.infer<typeof leadListItemSchema>;

/** `facets.byStatus` traz sempre as 7 chaves do enum, mesmo com contagem 0. */
export const leadFacetsSchema = z.object({
  byStatus: z.record(leadStatusSchema, z.number().int().min(0)),
  total: z.number().int().min(0),
});
export type LeadFacets = z.infer<typeof leadFacetsSchema>;

export const listLeadsResponseSchema = paginatedSchema(leadListItemSchema).extend({
  facets: leadFacetsSchema,
});
export type ListLeadsResponse = z.infer<typeof listLeadsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Detalhe do lead
// ─────────────────────────────────────────────────────────────────────────

export const leadActivitySchema = z.object({
  id: idSchema,
  type: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  actor: leadActivityActorSchema,
  createdAt: isoDateTimeSchema,
});
export type LeadActivity = z.infer<typeof leadActivitySchema>;

/**
 * Resumo de mensagem embutido na ficha do lead. Não confundir com o modelo
 * completo de `Message` (Fase 3, `whatsapp.contract.ts`) — aqui só o que a
 * timeline do lead precisa mostrar.
 */
export const leadMessageItemSchema = z.object({
  id: idSchema,
  direction: messageDirectionSchema,
  body: z.string(),
  status: messageStatusSchema,
  sentAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  readAt: isoDateTimeSchema.nullable(),
});
export type LeadMessageItem = z.infer<typeof leadMessageItemSchema>;

export const leadSourceSchema = z.object({
  type: leadSourceTypeSchema,
  url: z.string(),
  collectedAt: isoDateTimeSchema,
  searchJobId: idSchema,
});
export type LeadSource = z.infer<typeof leadSourceSchema>;

/** `GET /api/v1/leads/:id` — `LeadListItem` + detalhe. */
export const leadDetailSchema = leadListItemSchema.extend({
  notes: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  source: leadSourceSchema,
  firstSeenAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  activities: z.array(leadActivitySchema),
  messages: z.array(leadMessageItemSchema),
});
export type LeadDetail = z.infer<typeof leadDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/leads/:id
// ─────────────────────────────────────────────────────────────────────────

export const patchLeadBodySchema = z
  .object({
    status: leadStatusSchema.optional(),
    notes: z.string().max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    phoneE164: e164Schema.optional(),
    website: z.string().trim().max(500).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });
export type PatchLeadBody = z.infer<typeof patchLeadBodySchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/leads/bulk
// ─────────────────────────────────────────────────────────────────────────

export const leadBulkActionSchema = z.enum([
  'set_status',
  'add_tags',
  'remove_tags',
  'discard',
  'opt_out',
]);
export type LeadBulkAction = z.infer<typeof leadBulkActionSchema>;

/** Limite duro de 10.000 leads por chamada (ARQUITETURA §4.3, `422` acima disso). */
export const LEAD_BULK_MAX_IDS = 10_000;

export const bulkLeadsBodySchema = z
  .object({
    action: leadBulkActionSchema,
    leadIds: z.array(idSchema).max(LEAD_BULK_MAX_IDS).optional(),
    filter: leadFilterSchema.optional(),
    value: z
      .object({
        status: leadStatusSchema.optional(),
        tags: z.array(z.string().trim().min(1).max(40)).optional(),
      })
      .optional(),
  })
  .refine((body) => Boolean(body.leadIds?.length) !== Boolean(body.filter), {
    message: 'Informe exatamente um entre leadIds e filter',
  });
export type BulkLeadsBody = z.infer<typeof bulkLeadsBodySchema>;

export const bulkLeadsResponseSchema = z.object({
  ok: z.literal(true),
  affected: z.number().int().min(0),
});
export type BulkLeadsResponse = z.infer<typeof bulkLeadsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/leads/export
// ─────────────────────────────────────────────────────────────────────────

export const LEAD_EXPORT_COLUMNS = [
  'nome',
  'telefone',
  'tipo_telefone',
  'endereco',
  'cidade',
  'uf',
  'site',
  'categoria',
  'nota',
  'avaliacoes',
  'status',
  'tags',
  'origem_url',
  'coletado_em',
] as const;
export const leadExportColumnSchema = z.enum(LEAD_EXPORT_COLUMNS);
export type LeadExportColumn = z.infer<typeof leadExportColumnSchema>;

/** Limite duro de 50.000 linhas por export (`422 EXPORT_TOO_LARGE` acima disso). */
export const LEAD_EXPORT_MAX_ROWS = 50_000;

export const exportLeadsQuerySchema = leadFilterSchema.extend({
  columns: csvQuerySchema(leadExportColumnSchema),
  format: z.literal('csv').default('csv'),
});
export type ExportLeadsQuery = z.infer<typeof exportLeadsQuerySchema>;
