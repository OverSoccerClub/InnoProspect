import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPatch } from '@/lib/fetcher';
import { mockGetLead, mockListLeads, mockPatchLead } from '@/mocks/leads';
import { mockDelay } from '@/mocks/utils';
import type { LeadDetail, LeadFilter, LeadListResponse } from '@/types/lead';

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
