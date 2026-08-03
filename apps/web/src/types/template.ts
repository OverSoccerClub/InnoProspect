// Fonte da verdade: @inno/contracts (ARQUITETURA.md §4.4), publicado pelo
// Vega em paralelo a esta entrega. Reexporta com os nomes já usados em
// lib/api/templates.ts, mocks/templates.ts e nos componentes desta pasta —
// evita reescrever todo consumidor só por causa do nome do schema Zod.
export type {
  TemplateItem,
  TemplateWarning,
  CreateTemplateResponse,
  CreateTemplateBody as CreateTemplateRequest,
  PatchTemplateBody as UpdateTemplateRequest,
  PreviewTemplateBody as TemplatePreviewRequest,
  PreviewTemplateResponse as TemplatePreviewResponse,
} from '@inno/contracts';
