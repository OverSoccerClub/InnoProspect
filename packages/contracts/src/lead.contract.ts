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
  /**
   * 🆕 2026-09-23 (achado do dono em produção): `true` = só os leads cuja
   * `category` diverge do nicho da busca de ORIGEM (`Lead.offNiche`); `false`
   * = só os aderentes; ausente = todos. Critério em
   * `packages/core/src/leads/niche.ts` (`isOffNiche`) — NUNCA usado para
   * excluir da coleta, só para filtrar a listagem quando o operador pedir.
   * Reaproveitado de brinde por `POST /leads/bulk` (`filter`) e
   * `GET /leads/export` (mesmo `leadFilterSchema`) — não pedido
   * explicitamente para os dois, mas nenhum dos dois precisou de mudança
   * própria para ganhar isto.
   */
  offNiche: booleanQuerySchema,
  createdFrom: isoDateTimeSchema.optional(),
  createdTo: isoDateTimeSchema.optional(),
});
export type LeadFilter = z.infer<typeof leadFilterSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Paginação numerada de `GET /leads` — 🆕 2026-09-23, substitui a paginação
// por cursor (`common.ts#paginationQuerySchema`/`pageInfoSchema`) SÓ para
// este endpoint. Pedido do dono: seletor de "quantos por página" +
// navegação por número de página, o que exige acesso por OFFSET (cursor não
// dá para "ir direto para a página 7"). As demais listagens
// (`search.contract.ts`, `template.contract.ts`, `campaign.contract.ts`,
// `optout.contract.ts`) CONTINUAM em `paginationQuerySchema`/`pageInfoSchema`
// — não tocadas por esta mudança.
//
// ⚠️ CUSTO REGISTRADO (pedido explícito do Atlas): `OFFSET` alto degrada em
// tabela grande — o Postgres ainda PRECISA percorrer e descartar as `OFFSET`
// linhas anteriores antes de devolver a página, então o custo de "página 400
// com pageSize=100" (offset 40.000) cresce quase linearmente com o número da
// página, não é O(1) como o cursor. Com 10k-500k leads (ARQUITETURA, ano 1):
// nas primeiras páginas (uso real esperado — ninguém navega manualmente até
// a página 4.000) o custo é irrelevante; no fim de uma base de 500k com
// pageSize=25 (20.000 páginas), a última página exigiria escanear/descartar
// ~499.975 linhas do índice de ordenação a cada requisição — caro. Cursor
// não tem esse problema porque salta direto pelo índice a partir do último
// id visto, sem descartar nada.
// MITIGAÇÃO ACEITA para o MVP: nenhuma — decisão do Atlas foi paginação
// numerada mesmo com esse custo, porque o padrão de uso real (dashboard
// interno, poucos operadores, filtros que reduzem a base antes de paginar)
// raramente chega a páginas profundas. Se isso se tornar um problema medido
// em produção, a saída SEM mudar o contrato de novo é o serviço trocar a
// implementação por keyset pagination "disfarçada" de página numerada
// (mantendo um mapa página→cursor em cache, populado conforme o operador
// navega sequencialmente) — não implementado agora por ser complexidade sem
// necessidade medida ainda.
export const LEAD_PAGE_SIZES = [25, 50, 100] as const;
export type LeadPageSize = (typeof LEAD_PAGE_SIZES)[number];

export const leadPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .preprocess((val) => (val === undefined || val === null || val === '' ? 25 : val), z.coerce.number().int())
    .refine((val): val is LeadPageSize => (LEAD_PAGE_SIZES as readonly number[]).includes(val), {
      message: `pageSize deve ser um de: ${LEAD_PAGE_SIZES.join(', ')}`,
    }),
});
export type LeadPaginationQuery = z.infer<typeof leadPaginationQuerySchema>;

/** `GET /api/v1/leads` — filtro + paginação numerada + ordenação. */
export const listLeadsQuerySchema = leadFilterSchema.merge(leadPaginationQuerySchema).extend({
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
  /** 🆕 2026-09-23: busca de ORIGEM deste lead (`Lead.searchJobId`, imutável). */
  searchJobId: idSchema,
  /** 🆕 2026-09-23: `SearchJob.niche` da busca de origem — para exibir ao lado de `offNiche` sem 2ª chamada. */
  searchNiche: z.string(),
  /** 🆕 2026-09-23: `true` = `category` diverge do nicho de origem — ver `leadFilterSchema.offNiche`. NUNCA é motivo de exclusão automática. */
  offNiche: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type LeadListItem = z.infer<typeof leadListItemSchema>;

/** `facets.byStatus` traz sempre as 7 chaves do enum, mesmo com contagem 0. */
export const leadFacetsSchema = z.object({
  byStatus: z.record(leadStatusSchema, z.number().int().min(0)),
  total: z.number().int().min(0),
});
export type LeadFacets = z.infer<typeof leadFacetsSchema>;

/**
 * 🆕 2026-09-23: `page`/`pageSize`/`total`/`totalPages` FLAT no envelope
 * (não mais aninhados num objeto `page`) — aqui `page` É o número da
 * página, não um objeto de cursor. Formato conferido contra o que a Lyra já
 * consome de verdade em `apps/web/src/types/lead.ts#LeadListResponse` (ela
 * implementou contra a especificação do Atlas em paralelo) — bate 1:1.
 * Substitui o `paginatedSchema`/`pageInfoSchema` genérico por cursor de
 * `common.ts`, só para este endpoint (ver comentário de
 * `leadPaginationQuerySchema` acima).
 */
export const listLeadsResponseSchema = z.object({
  data: z.array(leadListItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int(),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
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
// POST /api/v1/leads/:id/eliminate — 🆕 Fase 5.3 (ARQUITETURA §7.3/§7.4,
// direito de Eliminação, ação `delete_lead_data`). Admin-only, irreversível
// — mesmo rigor de confirmação do `POST /api/v1/dispatch/queue/resume`
// (`{ acknowledge: true }` literal, não um booleano qualquer: a tela não
// pode mandar `{ acknowledge: false }` "por engano" e passar validação).
// ─────────────────────────────────────────────────────────────────────────

export const eliminateLeadDataBodySchema = z.object({ acknowledge: z.literal(true) });
export type EliminateLeadDataBody = z.infer<typeof eliminateLeadDataBodySchema>;

export const eliminateLeadDataResponseSchema = z.object({
  ok: z.literal(true),
  leadId: idSchema,
  /** Quantas linhas de `Message`/`LeadActivity` foram levadas pelo cascade da exclusão do Lead — só para o operador confirmar o tamanho do que foi apagado, a própria linha já se foi. */
  deletedMessages: z.number().int().min(0),
  deletedActivities: z.number().int().min(0),
  /** `null` quando o lead nunca teve telefone — não há `OptOut` possível (chave é `phoneE164`, ARQUITETURA §6.7 item 2), e portanto nenhuma proteção contra recoleta futura por este canal (limitação conhecida, documentada no handoff). */
  optOutId: idSchema.nullable(),
  /** `true` só quando este pedido CRIOU o `OptOut` — `false` quando o telefone já estava descadastrado antes (ex.: resposta "sair" anterior) e a linha existente foi apenas preservada. */
  optOutCreated: z.boolean(),
});
export type EliminateLeadDataResponse = z.infer<typeof eliminateLeadDataResponseSchema>;

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
