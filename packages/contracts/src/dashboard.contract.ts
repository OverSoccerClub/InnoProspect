/**
 * dashboard.contract.ts — `GET /api/v1/dashboard/summary` (painel logado).
 * CONTRATO fechado pelo Atlas entre Vega (implementa) e Lyra (consome, tela
 * do painel) — formato NÃO deve ser alterado sem passar pelos dois de novo.
 *
 * Números "últimos N dias" (`createdLast7d`/`createdPrev7d`/
 * `completedLast30d`/`tasksFailedLast30d`) são janelas ROLANTES de N*24h a
 * partir de `generatedAt` (UTC puro, sem alinhamento a fuso) — só `byDay`
 * (série diária) é alinhado a dia-calendário em `America/Sao_Paulo`, porque é
 * o único campo que precisa de "dia" como unidade discreta e exibível.
 */
import { z } from 'zod';
import { isoDateTimeSchema, leadStatusSchema, ufSchema } from './common.js';

export const dashboardTimezoneSchema = z.literal('America/Sao_Paulo');
export type DashboardTimezone = z.infer<typeof dashboardTimezoneSchema>;

/** `date` sempre `YYYY-MM-DD`, dia-calendário em `America/Sao_Paulo` — ver `dashboard.ts#toSaoPauloDateKey`. */
export const dashboardLeadsByDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date deve estar no formato YYYY-MM-DD'),
  count: z.number().int().min(0),
});
export type DashboardLeadsByDay = z.infer<typeof dashboardLeadsByDaySchema>;

export const dashboardTopUfSchema = z.object({
  uf: ufSchema,
  count: z.number().int().min(0),
});
export type DashboardTopUf = z.infer<typeof dashboardTopUfSchema>;

export const dashboardTopCategorySchema = z.object({
  category: z.string(),
  count: z.number().int().min(0),
});
export type DashboardTopCategory = z.infer<typeof dashboardTopCategorySchema>;

/** `byStatus` traz sempre as 7 chaves de `LeadStatus`, mesmo com contagem 0 — mesma convenção de `LeadFacets` (`lead.contract.ts`). */
export const dashboardLeadsSummarySchema = z.object({
  total: z.number().int().min(0),
  createdLast7d: z.number().int().min(0),
  createdPrev7d: z.number().int().min(0),
  withPhone: z.number().int().min(0),
  withMobile: z.number().int().min(0),
  optedOut: z.number().int().min(0),
  byStatus: z.record(leadStatusSchema, z.number().int().min(0)),
  /** Sempre EXATAMENTE 30 itens, ordem crescente, dias sem lead com `count: 0`. */
  byDay: z.array(dashboardLeadsByDaySchema).length(30),
  /** Até 5 itens, desc. */
  topUfs: z.array(dashboardTopUfSchema).max(5),
  /** Até 5 itens, desc — `category` nula/vazia nunca aparece aqui. */
  topCategories: z.array(dashboardTopCategorySchema).max(5),
});
export type DashboardLeadsSummary = z.infer<typeof dashboardLeadsSummarySchema>;

export const dashboardSearchesSummarySchema = z.object({
  queued: z.number().int().min(0),
  running: z.number().int().min(0),
  completedLast30d: z.number().int().min(0),
  tasksFailedLast30d: z.number().int().min(0),
});
export type DashboardSearchesSummary = z.infer<typeof dashboardSearchesSummarySchema>;

/** `GET /api/v1/dashboard/summary` — resposta completa. */
export const dashboardSummarySchema = z.object({
  generatedAt: isoDateTimeSchema,
  timezone: dashboardTimezoneSchema,
  leads: dashboardLeadsSummarySchema,
  searches: dashboardSearchesSummarySchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
