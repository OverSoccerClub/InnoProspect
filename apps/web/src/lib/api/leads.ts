import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPatch, apiPost } from '@/lib/fetcher';
import { mockGetLead, mockListLeads, mockPatchLead, mockPreviewLeadMessage, mockSendLeadMessage } from '@/mocks/leads';
import { mockDelay } from '@/mocks/utils';
import type { LeadDetail, LeadFilter, LeadListResponse } from '@/types/lead';
import type { LeadMessagePreviewResponse, SendLeadMessageRequest, SendLeadMessageResponse } from '@/types/lead-message';

export async function listLeads(filter: LeadFilter = {}): Promise<LeadListResponse> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListLeads(filter);
  }
  return apiGet<LeadListResponse>('/api/v1/leads', {
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
    contactedInCampaign: filter.contactedInCampaign,
    createdFrom: filter.createdFrom,
    createdTo: filter.createdTo,
    sort: filter.sort,
    cursor: filter.cursor,
    limit: filter.limit,
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
