import { USE_MOCKS } from '@/lib/config';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/fetcher';
import {
  mockCreateTemplate,
  mockDeleteTemplate,
  mockGetTemplate,
  mockListTemplates,
  mockPatchTemplate,
  mockPreviewTemplate,
} from '@/mocks/templates';
import { mockDelay } from '@/mocks/utils';
import type { Paginated } from '@/types/common';
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  TemplateItem,
  TemplatePreviewResponse,
  UpdateTemplateRequest,
} from '@/types/template';

export type ListTemplatesParams = { cursor?: string; limit?: number; isActive?: boolean };

export async function listTemplates(params: ListTemplatesParams = {}): Promise<Paginated<TemplateItem>> {
  if (USE_MOCKS) {
    await mockDelay();
    return mockListTemplates(params);
  }
  return apiGet<Paginated<TemplateItem>>('/api/v1/templates', params);
}

export async function getTemplate(id: string): Promise<TemplateItem> {
  if (USE_MOCKS) {
    await mockDelay(150);
    return mockGetTemplate(id);
  }
  // não há GET /templates/:id documentado — a lista já traz o corpo completo (TemplateItem.body).
  const { data } = await listTemplates({ limit: 100 });
  const found = data.find((t) => t.id === id);
  if (!found) throw new Error('Template não encontrado.');
  return found;
}

export async function createTemplate(input: CreateTemplateRequest): Promise<CreateTemplateResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockCreateTemplate(input);
  }
  return apiPost<CreateTemplateResponse>('/api/v1/templates', input);
}

export async function patchTemplate(id: string, patch: UpdateTemplateRequest): Promise<CreateTemplateResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockPatchTemplate(id, patch);
  }
  return apiPatch<CreateTemplateResponse>(`/api/v1/templates/${id}`, patch);
}

export async function deleteTemplate(id: string): Promise<void> {
  if (USE_MOCKS) {
    await mockDelay(300);
    mockDeleteTemplate(id);
    return;
  }
  await apiDelete(`/api/v1/templates/${id}`);
}

export async function previewTemplate(id: string, sampleCount = 3): Promise<TemplatePreviewResponse> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockPreviewTemplate(id, sampleCount);
  }
  return apiPost<TemplatePreviewResponse>(`/api/v1/templates/${id}/preview`, { sampleCount });
}
