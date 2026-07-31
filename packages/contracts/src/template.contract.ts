/**
 * template.contract.ts — Templates de mensagem (ARQUITETURA §4.4, §6.4).
 * CONTRATO — Vega implementa a rota, Lyra consome; a validação de variáveis
 * e spintax aqui usada precisa bater com `packages/core/templates/{render,
 * spintax}.ts` — mesma lista de variáveis, mesma sintaxe de spintax.
 */
import { z } from 'zod';
import { idSchema, isoDateTimeSchema, paginatedSchema, paginationQuerySchema } from './common.js';

/**
 * Variáveis permitidas em `MessageTemplate.body` (ARQUITETURA §4.4). Lista
 * fechada — usar `{{variável}}` fora daqui é `422 UNKNOWN_VARIABLE`.
 * `packages/core/templates/render.ts` é quem resolve o valor de cada uma.
 */
export const TEMPLATE_ALLOWED_VARIABLES = [
  'nome',
  'primeiro_nome',
  'cidade',
  'uf',
  'categoria',
  'site',
  'telefone',
  'minha_empresa',
] as const;
export const templateVariableSchema = z.enum(TEMPLATE_ALLOWED_VARIABLES);
export type TemplateVariable = z.infer<typeof templateVariableSchema>;

export const templateWarningCodeSchema = z.enum(['LOW_VARIATION']);
export type TemplateWarningCode = z.infer<typeof templateWarningCodeSchema>;

export const templateWarningSchema = z.object({
  code: templateWarningCodeSchema,
  message: z.string(),
});
export type TemplateWarning = z.infer<typeof templateWarningSchema>;

/** `GET /api/v1/templates` — item de listagem. */
export const templateItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  body: z.string(),
  /** Variáveis detectadas do corpo (subset de TEMPLATE_ALLOWED_VARIABLES). */
  variablesUsed: z.array(templateVariableSchema),
  hasSpintax: z.boolean(),
  /** Combinações possíveis geradas pelos blocos `{a|b|c}`. */
  spintaxVariations: z.number().int().min(1),
  isActive: z.boolean(),
  usageCount: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TemplateItem = z.infer<typeof templateItemSchema>;

export const listTemplatesQuerySchema = paginationQuerySchema.extend({
  isActive: z.coerce.boolean().optional(),
  q: z.string().trim().min(1).max(160).optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

export const listTemplatesResponseSchema = paginatedSchema(templateItemSchema);
export type ListTemplatesResponse = z.infer<typeof listTemplatesResponseSchema>;

/** `POST /api/v1/templates` */
export const createTemplateBodySchema = z.object({
  name: z.string().trim().min(3).max(80),
  body: z.string().trim().min(10).max(4000),
  isActive: z.boolean().default(true),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

/** `201` de `POST /api/v1/templates` — `TemplateItem` + avisos não bloqueantes. */
export const createTemplateResponseSchema = templateItemSchema.extend({
  warnings: z.array(templateWarningSchema).optional(),
});
export type CreateTemplateResponse = z.infer<typeof createTemplateResponseSchema>;

/** `PATCH /api/v1/templates/:id` — parcial, mesmas regras de `POST`. */
export const patchTemplateBodySchema = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    body: z.string().trim().min(10).max(4000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });
export type PatchTemplateBody = z.infer<typeof patchTemplateBodySchema>;

/** `POST /api/v1/templates/:id/preview` */
export const previewTemplateBodySchema = z.object({
  leadId: idSchema.optional(),
  sampleCount: z.number().int().min(1).max(20).default(3),
});
export type PreviewTemplateBody = z.infer<typeof previewTemplateBodySchema>;

export const templatePreviewItemSchema = z.object({
  text: z.string(),
  length: z.number().int().min(0),
  usedVariables: z.record(z.string(), z.string()),
});
export type TemplatePreviewItem = z.infer<typeof templatePreviewItemSchema>;

export const previewTemplateResponseSchema = z.object({
  previews: z.array(templatePreviewItemSchema),
  /** Variáveis sem valor no lead-exemplo — Lyra mostra alerta. */
  missingVariables: z.array(templateVariableSchema),
});
export type PreviewTemplateResponse = z.infer<typeof previewTemplateResponseSchema>;
