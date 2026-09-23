import { USE_MOCKS } from '@/lib/config';
import { triggerBlobDownload, triggerUrlDownload } from '@/lib/download';
import { apiGet, apiPatch, apiPost, toQueryString } from '@/lib/fetcher';
import {
  mockBulkUpdateLeads,
  mockExportLeadsCsv,
  mockGetLead,
  mockListLeads,
  mockPatchLead,
  mockPreviewLeadMessage,
  mockSendLeadMessage,
} from '@/mocks/leads';
import { mockDelay } from '@/mocks/utils';
import {
  LEAD_EXPORT_COLUMNS,
  type BulkLeadsBody,
  type BulkLeadsResponse,
  type LeadDetail,
  type LeadFilter,
  type LeadListResponse,
} from '@/types/lead';
import type { LeadMessagePreviewResponse, SendLeadMessageRequest, SendLeadMessageResponse } from '@/types/lead-message';

/**
 * Todo campo de `LeadFilter` que NÃO é paginação — reaproveitado por
 * `listLeads` e `exportLeads` para os dois nunca divergirem sobre "o que é o
 * filtro atual" (o mesmo risco que motiva `resolveLeadWhere` no backend do
 * Vega ser compartilhado entre `listLeads`/`export`/`bulk`).
 */
function filterQueryParams(filter: LeadFilter) {
  return {
    q: filter.q,
    status: filter.status,
    uf: filter.uf,
    cityIbgeCode: filter.cityIbgeCode,
    category: filter.category,
    searchJobId: filter.searchJobId,
    hasWebsite: filter.hasWebsite,
    hasPhone: filter.hasPhone,
    phoneType: filter.phoneType,
    minRating: filter.minRating,
    tags: filter.tags,
    optedOut: filter.optedOut,
    offNiche: filter.offNiche,
    contactedInCampaign: filter.contactedInCampaign,
    createdFrom: filter.createdFrom,
    createdTo: filter.createdTo,
  };
}

/**
 * `GET /api/v1/leads` — paginação NUMERADA (`page`/`pageSize`), não cursor.
 * Contrato fixado pelo Atlas em 2026-09-23 — ver nota em `types/lead.ts`
 * (`LeadListResponse`). Em modo real, isto assume que o backend já fala este
 * contrato; enquanto o Vega não publicar a migração, a resposta real não vai
 * ter `page`/`pageSize`/`totalPages` no formato esperado (ver PENDÊNCIAS do
 * handoff da Lyra) — não é regressão desta função, é a integração pendente.
 */
export async function listLeads(filter: LeadFilter = {}): Promise<LeadListResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListLeads(filter);
  }
  return apiGet<LeadListResponse>('/api/v1/leads', {
    ...filterQueryParams(filter),
    sort: filter.sort,
    page: filter.page,
    pageSize: filter.pageSize,
  });
}

export async function getLead(id: string): Promise<LeadDetail> {
  if (USE_MOCKS) {
    await mockDelay(150);
    return mockGetLead(id);
  }
  return apiGet<LeadDetail>(`/api/v1/leads/${id}`);
}

export async function patchLead(
  id: string,
  patch: Partial<Pick<LeadDetail, 'status' | 'notes' | 'tags' | 'name' | 'phoneE164' | 'website'>>,
): Promise<LeadDetail> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockPatchLead(id, patch);
  }
  return apiPatch<LeadDetail>(`/api/v1/leads/${id}`, patch);
}

/**
 * `POST /templates/:id/preview` com `leadId` — variáveis reais do lead +
 * variações de spintax seedadas (ARQUITETURA.md §4.9.4). Fica aqui (não em
 * `lib/api/templates.ts`) porque só existe no contexto do compositor da
 * ficha do lead — `TemplatePreviewResponse` (de `@inno/contracts`) ainda não
 * tem `spintaxSeed`; ver TODO em `types/lead-message.ts`.
 */
export async function previewLeadMessage(
  leadId: string,
  templateId: string,
  sampleCount = 3,
): Promise<LeadMessagePreviewResponse> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockPreviewLeadMessage(leadId, templateId, sampleCount);
  }
  return apiPost<LeadMessagePreviewResponse>(`/api/v1/templates/${templateId}/preview`, { leadId, sampleCount });
}

/** `POST /api/v1/leads/:id/messages` (ARQUITETURA.md §4.9.2) — envio unitário. */
export async function sendLeadMessage(leadId: string, input: SendLeadMessageRequest): Promise<SendLeadMessageResponse> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockSendLeadMessage(leadId, input);
  }
  return apiPost<SendLeadMessageResponse>(`/api/v1/leads/${leadId}/messages`, input);
}

/**
 * `GET /api/v1/leads/export` — CSV com o filtro atual da tela (ARQUITETURA §4.3),
 * SEM paginação: sempre o dump completo do que o filtro resolve, nunca só a
 * página visível — é por isto que `exportLeads` recebe o mesmo `LeadFilter` da
 * tela mas nunca `page`/`pageSize` (`filterQueryParams` de propósito não inclui
 * paginação). Antes desta revisão só `q/status/uf/cityIbgeCode` eram
 * repassados ao endpoint real — qualquer outro filtro ativo na tela
 * (`searchJobId`, `offNiche`, tags, etc.) era ignorado pelo export e o CSV
 * saía maior que a lista visível. Corrigido reaproveitando `filterQueryParams`.
 *
 * Em modo mock, como não existe servidor gerando o arquivo, montamos o CSV no
 * cliente (mesmo formato: BOM, separador `;`, decimal com vírgula — ver
 * `mocks/leads.ts`) e disparamos como download de Blob; em modo real, é uma
 * navegação para a rota autenticada (o servidor faz streaming e já manda
 * `Content-Disposition: attachment`, então o navegador baixa sem sair da tela).
 */
export async function exportLeads(filter: LeadFilter): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(400);
    const { filename, csv } = mockExportLeadsCsv(filter, LEAD_EXPORT_COLUMNS);
    triggerBlobDownload(filename, csv, 'text/csv;charset=utf-8');
    return;
  }
  const query = toQueryString(filterQueryParams(filter));
  triggerUrlDownload(`/api/v1/leads/export${query}`);
}

/**
 * `POST /api/v1/leads/bulk` (ARQUITETURA §4.3) — ação em massa sobre uma
 * seleção explícita de ids (linhas marcadas na tela). A tela nunca envia
 * `filter`/`expectedCount` nesta rodada — ver nota em `mocks/leads.ts`.
 */
export async function bulkUpdateLeads(body: BulkLeadsBody): Promise<BulkLeadsResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockBulkUpdateLeads(body);
  }
  return apiPost<BulkLeadsResponse>('/api/v1/leads/bulk', body);
}
