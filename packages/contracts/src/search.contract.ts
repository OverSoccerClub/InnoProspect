/**
 * search.contract.ts — Localidades (§4.1) e Buscas/SearchJob (§4.2).
 * CONTRATO — Vega implementa as rotas, Lyra consome estes tipos.
 */
import { z } from 'zod';
import {
  ibgeCodeSchema,
  idSchema,
  isoDateTimeSchema,
  paginatedSchema,
  paginationQuerySchema,
  csvQuerySchema,
  searchJobStatusSchema,
  searchTaskStatusSchema,
  ufSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// §4.1 Localidades (auxiliar do formulário de busca)
// ─────────────────────────────────────────────────────────────────────────

/** `GET /api/v1/locations/ufs` */
export const ufListItemSchema = z.object({
  id: ufSchema,
  sigla: ufSchema,
  nome: z.string(),
  cityCount: z.number().int().min(0),
});
export type UfListItem = z.infer<typeof ufListItemSchema>;

export const listUfsResponseSchema = z.object({ data: z.array(ufListItemSchema) });
export type ListUfsResponse = z.infer<typeof listUfsResponseSchema>;

/** `GET /api/v1/locations/ufs/:sigla/cities` — query `?q=&limit=` */
export const listCitiesQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCitiesQuery = z.infer<typeof listCitiesQuerySchema>;

export const cityListItemSchema = z.object({
  ibgeCode: ibgeCodeSchema,
  nome: z.string(),
  slug: z.string(),
  population: z.number().int().min(0),
});
export type CityListItem = z.infer<typeof cityListItemSchema>;

export const listCitiesResponseSchema = z.object({ data: z.array(cityListItemSchema) });
export type ListCitiesResponse = z.infer<typeof listCitiesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// §4.2 Buscas (SearchJob)
// ─────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/searches` */
export const createSearchJobBodySchema = z.object({
  niche: z.string().trim().min(3).max(120),
  uf: ufSchema,
  /** Vazio/ausente = fanout para TODOS os municípios da UF (ARQUITETURA §4.2). */
  cityIbgeCodes: z.array(ibgeCodeSchema).optional(),
  maxResultsPerCity: z.number().int().min(1).max(300).default(120),
  /** Rótulo amigável; se ausente, a API monta `"{niche} — {uf}"`. */
  name: z.string().trim().min(1).max(160).optional(),
});
export type CreateSearchJobBody = z.infer<typeof createSearchJobBodySchema>;

/** `201 Created` de `POST /api/v1/searches`. */
export const createSearchJobResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  niche: z.string(),
  uf: ufSchema,
  status: z.literal('queued'),
  /** = nº de municípios no fanout. */
  totalTasks: z.number().int().min(0),
  doneTasks: z.literal(0),
  leadsFound: z.literal(0),
  leadsNew: z.literal(0),
  createdAt: isoDateTimeSchema,
  /** Heurística: `totalTasks * ~40s / concorrência`. */
  estimatedDurationMinutes: z.number().min(0),
});
export type CreateSearchJobResponse = z.infer<typeof createSearchJobResponseSchema>;

/** Item de `GET /api/v1/searches` e base de `GET /api/v1/searches/:id`. */
export const searchJobSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  niche: z.string(),
  uf: ufSchema,
  status: searchJobStatusSchema,
  progress: z.object({
    total: z.number().int().min(0),
    done: z.number().int().min(0),
    failed: z.number().int().min(0),
    percent: z.number().min(0).max(100),
  }),
  leadsFound: z.number().int().min(0),
  leadsNew: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type SearchJobSummary = z.infer<typeof searchJobSummarySchema>;

/** `GET /api/v1/searches` — query `?status=&uf=&q=&cursor=&limit=`. */
export const listSearchJobsQuerySchema = paginationQuerySchema.extend({
  status: csvQuerySchema(searchJobStatusSchema),
  uf: ufSchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
});
export type ListSearchJobsQuery = z.infer<typeof listSearchJobsQuerySchema>;

export const listSearchJobsResponseSchema = paginatedSchema(searchJobSummarySchema);
export type ListSearchJobsResponse = z.infer<typeof listSearchJobsResponseSchema>;

/** Um item de `SearchJobDetail.tasks`. */
export const searchTaskItemSchema = z.object({
  id: idSchema,
  cityName: z.string(),
  ibgeCode: ibgeCodeSchema,
  status: searchTaskStatusSchema,
  resultCount: z.number().int().min(0),
  attempt: z.number().int().min(0),
  errorCode: z.string().nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type SearchTaskItem = z.infer<typeof searchTaskItemSchema>;

/**
 * `GET /api/v1/searches/:id` — `SearchJobSummary & { tasks, error? }`.
 * Nota para Lyra (ARQUITETURA §4.2): a tela de progresso faz polling de 3s
 * neste endpoint enquanto `status ∈ {queued, running}`. Sem WebSocket no MVP.
 */
export const searchJobDetailSchema = searchJobSummarySchema.extend({
  tasks: z.array(searchTaskItemSchema),
  error: z.string().optional(),
});
export type SearchJobDetail = z.infer<typeof searchJobDetailSchema>;

/** `POST /api/v1/searches/:id/cancel` */
export const cancelSearchJobResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('cancelled'),
  cancelledTasks: z.number().int().min(0),
});
export type CancelSearchJobResponse = z.infer<typeof cancelSearchJobResponseSchema>;

/** `POST /api/v1/searches/:id/retry-failed` */
export const retryFailedSearchTasksResponseSchema = z.object({
  ok: z.literal(true),
  requeuedTasks: z.number().int().min(0),
});
export type RetryFailedSearchTasksResponse = z.infer<typeof retryFailedSearchTasksResponseSchema>;
