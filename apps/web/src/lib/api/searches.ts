import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPost } from '@/lib/fetcher';
import { mockCancelSearchJob, mockCreateSearchJob, mockGetSearchJob, mockListSearchJobs } from '@/mocks/searches';
import { mockDelay } from '@/mocks/utils';
import type { Paginated } from '@/types/common';
import type { CreateSearchRequest, CreateSearchResponse, SearchJobDetail, SearchJobSummary } from '@/types/search';

export type ListSearchesParams = {
  status?: string;
  uf?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

export async function listSearchJobs(params: ListSearchesParams = {}): Promise<Paginated<SearchJobSummary>> {
  if (USE_MOCKS) {
    await mockDelay();
    const data = mockListSearchJobs(params);
    return { data, page: { cursor: null, nextCursor: null, limit: data.length, total: data.length } };
  }
  return apiGet<Paginated<SearchJobSummary>>('/api/v1/searches', params);
}

export async function getSearchJob(id: string): Promise<SearchJobDetail> {
  if (USE_MOCKS) {
    await mockDelay(150);
    return mockGetSearchJob(id);
  }
  return apiGet<SearchJobDetail>(`/api/v1/searches/${id}`);
}

export async function createSearchJob(input: CreateSearchRequest): Promise<CreateSearchResponse> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockCreateSearchJob(input);
  }
  return apiPost<CreateSearchResponse>('/api/v1/searches', input);
}

export async function cancelSearchJob(id: string): Promise<{ ok: true; status: 'cancelled'; cancelledTasks: number }> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockCancelSearchJob(id);
  }
  return apiPost(`/api/v1/searches/${id}/cancel`);
}

export async function retryFailedTasks(id: string): Promise<{ ok: true; requeuedTasks: number }> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return { ok: true, requeuedTasks: 0 };
  }
  return apiPost(`/api/v1/searches/${id}/retry-failed`);
}
