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
  /**
   * Motivo técnico da falha, quando `status === 'failed'`. Existe porque
   * `failed` sozinho junta dois casos opostos: `EVOLUTION_SEND_UNCERTAIN`
   * (o WhatsApp não respondeu a tempo e a mensagem PODE ter sido entregue) e
   * falhas em que nada saiu. Mostrar os dois como "Falhou" convida o operador
   * a reenviar, e no caso incerto isso faz o lead receber duas vezes.
   * Opcional para não quebrar quem já consome o formato anterior.
   */
  errorCode: z.string().nullable().optional(),
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
//
// 🆕 Revisão de 2026-09-22 (uso próprio, sem multi-cliente): o rascunho
// original desta seção (Fase 1, ARQUITETURA §4.3) tinha `{ ok, affected }` e
// nenhuma proteção de `expectedCount`. Ficou provado insuficiente antes de
// qualquer rota consumir — ninguém implementou contra ele ainda — então esta
// revisão substitui o formato em vez de versionar por cima:
//   1. `discard`/`opt_out` saíram do enum de ação: `discard` é só
//      `set_status` com `value.status: 'discarded'` (mesma máquina de
//      estados); `opt_out` grava em `OptOut` com `source`, o que é uma
//      operação de escopo diferente (não uma edição de `Lead`) — melhor como
//      endpoint próprio no futuro do que forçado aqui sem o contrato de
//      `source` decidido.
//   2. `expectedCount` (obrigatório com `filter`, proibido com `leadIds`):
//      sem isso, um filtro que mudou de contagem entre a tela carregar e o
//      operador clicar "aplicar" muda mais (ou menos) leads do que ele viu —
//      a chamada é recusada com `409 CONFLICT`/`EXPECTED_COUNT_MISMATCH` em
//      vez de aplicar sobre um conjunto diferente do conferido.
//   3. Resposta rica (`updatedIds`/`skipped`/`summary`) em vez de só
//      `affected`: a operação nunca falha o lote inteiro por um item ruim
//      (lead sumiu, transição inválida) — o chamador precisa saber QUAL item
//      e POR QUÊ, não só um total.
// ─────────────────────────────────────────────────────────────────────────

export const leadBulkActionSchema = z.enum(['set_status', 'add_tags', 'remove_tags']);
export type LeadBulkAction = z.infer<typeof leadBulkActionSchema>;

/** Limite duro de 10.000 leads por chamada (ARQUITETURA §4.3, `422` acima disso). */
export const LEAD_BULK_MAX_IDS = 10_000;

export const bulkLeadsValueSchema = z.object({
  status: leadStatusSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
});
export type BulkLeadsValue = z.infer<typeof bulkLeadsValueSchema>;

export const bulkLeadsBodySchema = z
  .object({
    action: leadBulkActionSchema,
    leadIds: z.array(idSchema).min(1).max(LEAD_BULK_MAX_IDS).optional(),
    filter: leadFilterSchema.optional(),
    /**
     * Obrigatório quando `filter` é usado; proibido com `leadIds` (que já é
     * uma lista exata, sem ambiguidade de contagem). Ver nota da seção.
     */
    expectedCount: z.number().int().min(0).optional(),
    value: bulkLeadsValueSchema.default({}),
  })
  .superRefine((body, ctx) => {
    const hasIds = Boolean(body.leadIds?.length);
    const hasFilter = Boolean(body.filter);
    if (hasIds === hasFilter) {
      ctx.addIssue({ code: 'custom', path: ['leadIds'], message: 'Informe exatamente um entre leadIds e filter' });
    }
    if (hasFilter && body.expectedCount === undefined) {
      ctx.addIssue({ code: 'custom', path: ['expectedCount'], message: 'expectedCount é obrigatório ao usar filter' });
    }
    if (hasIds && body.expectedCount !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['expectedCount'], message: 'expectedCount só se aplica a filter, não a leadIds' });
    }
    if (body.action === 'set_status') {
      if (!body.value.status) {
        ctx.addIssue({ code: 'custom', path: ['value', 'status'], message: 'Informe value.status para action="set_status"' });
      }
      if (body.value.tags) {
        ctx.addIssue({ code: 'custom', path: ['value', 'tags'], message: 'value.tags não se aplica a action="set_status"' });
      }
    } else {
      if (!body.value.tags?.length) {
        ctx.addIssue({ code: 'custom', path: ['value', 'tags'], message: `Informe value.tags para action="${body.action}"` });
      }
      if (body.value.status) {
        ctx.addIssue({ code: 'custom', path: ['value', 'status'], message: 'value.status só se aplica a action="set_status"' });
      }
    }
  });
export type BulkLeadsBody = z.infer<typeof bulkLeadsBodySchema>;

/**
 * Por que um lead alvo pode ficar de fora da alteração — nunca derruba o
 * lote inteiro (ARQUITETURA §3.2 regra 2 continua valendo por item).
 *   - `NOT_FOUND`: id em `leadIds` que não existe (mais provável: já excluído).
 *   - `INVALID_STATUS_TRANSITION`: a transição viola a máquina de estados
 *     (mesma regra de `checkStatusTransition` usada em `PATCH /leads/:id`).
 *   - `NO_CHANGE`: já estava no estado/tags pedidos — não é erro, só não
 *     gera `LeadActivity` (ruído zero na timeline por uma não-mudança).
 */
export const bulkLeadsSkipReasonSchema = z.enum(['NOT_FOUND', 'INVALID_STATUS_TRANSITION', 'NO_CHANGE']);
export type BulkLeadsSkipReason = z.infer<typeof bulkLeadsSkipReasonSchema>;

export const bulkLeadsSkippedItemSchema = z.object({
  id: idSchema,
  reason: bulkLeadsSkipReasonSchema,
  message: z.string(),
});
export type BulkLeadsSkippedItem = z.infer<typeof bulkLeadsSkippedItemSchema>;

export const bulkLeadsResponseSchema = z.object({
  ok: z.literal(true),
  updatedIds: z.array(idSchema),
  skipped: z.array(bulkLeadsSkippedItemSchema),
  summary: z.object({
    requested: z.number().int().min(0),
    updated: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
});
export type BulkLeadsResponse = z.infer<typeof bulkLeadsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/leads/export
//
// 🆕 Revisão de 2026-09-22: duas mudanças sobre o rascunho original —
//   1. Separador `;`, não `,` (ARQUITETURA dizia `,`): o Excel PT-BR usa
//      VÍRGULA como separador DECIMAL (ex.: "4,5" em `nota`) — abrir um CSV
//      separado por vírgula faz cada célula numérica quebrar em duas colunas.
//      `;` é o separador padrão de facto do Excel em locale pt-BR.
//   2. Coluna `descadastrado` adicionada: quem exporta para outra ferramenta
//      precisa saber quem não pode ser contatado, e o rascunho original não
//      trazia `isOptedOut` nenhuma — ARQUITETURA §4.3 deve ser atualizada
//      para refletir isto (fora do meu escopo tocar o arquivo).
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
  'descadastrado',
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
