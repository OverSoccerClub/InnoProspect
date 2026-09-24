import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPost } from '@/lib/fetcher';
import {
  mockCancelCampaign,
  mockCreateCampaign,
  mockGetCampaign,
  mockListCampaigns,
  mockListCampaignTargets,
  mockPauseCampaign,
  mockPreviewCampaignAudience,
  mockResumeCampaign,
  mockSendCampaignTarget,
  mockStartCampaign,
} from '@/mocks/campaigns';
import { mockDelay } from '@/mocks/utils';
import type {
  CampaignAudienceInput,
  CampaignAudienceSummary,
  CampaignDetail,
  CampaignStatus,
  CampaignSummary,
  CampaignTargetItem,
  CampaignTargetStatus,
  CancelCampaignResponse,
  CreateCampaignRequest,
  CreateCampaignResponse,
  PauseCampaignResponse,
  ResumeCampaignRequest,
  ResumeCampaignResponse,
  SendCampaignTargetRequest,
  SendCampaignTargetResponse,
  StartCampaignResponse,
} from '@/types/campaign';
import type { Paginated } from '@/types/common';

export type ListCampaignsParams = { status?: CampaignStatus; q?: string; cursor?: string; limit?: number };

export async function listCampaigns(params: ListCampaignsParams = {}): Promise<Paginated<CampaignSummary>> {
  const resolved = { ...params, limit: params.limit ?? 25 };
  if (USE_MOCKS) {
    await mockDelay();
    return mockListCampaigns(resolved);
  }
  return apiGet<Paginated<CampaignSummary>>('/api/v1/campaigns', resolved);
}

export async function getCampaign(id: string): Promise<CampaignDetail> {
  if (USE_MOCKS) {
    await mockDelay(150);
    return mockGetCampaign(id);
  }
  return apiGet<CampaignDetail>(`/api/v1/campaigns/${id}`);
}

export type ListCampaignTargetsParams = { status?: CampaignTargetStatus; cursor?: string; limit?: number };

export async function listCampaignTargets(id: string, params: ListCampaignTargetsParams = {}): Promise<Paginated<CampaignTargetItem>> {
  const resolved = { ...params, limit: params.limit ?? 25 };
  if (USE_MOCKS) {
    await mockDelay();
    return mockListCampaignTargets(id, resolved);
  }
  return apiGet<Paginated<CampaignTargetItem>>(`/api/v1/campaigns/${id}/targets`, resolved);
}

/**
 * Prévia de audiência sem criar nada — ver a nota grande em
 * `mocks/campaigns.ts#mockPreviewCampaignAudience`. `null` fora do modo
 * mock: não existe `POST /campaigns/preview` no contrato publicado ainda
 * (histórico em `types/campaign.ts`); a tela precisa tratar `null` como
 * "prévia indisponível aqui", não como erro.
 */
export async function previewCampaignAudience(
  audience: CampaignAudienceInput,
  skipRecentlyContactedDays?: number,
): Promise<CampaignAudienceSummary | null> {
  if (!USE_MOCKS) return null;
  await mockDelay(300);
  return mockPreviewCampaignAudience(audience, skipRecentlyContactedDays);
}

export async function createCampaign(input: CreateCampaignRequest): Promise<CreateCampaignResponse> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockCreateCampaign(input);
  }
  return apiPost<CreateCampaignResponse>('/api/v1/campaigns', input);
}

export async function startCampaign(id: string): Promise<StartCampaignResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockStartCampaign(id);
  }
  return apiPost<StartCampaignResponse>(`/api/v1/campaigns/${id}/start`);
}

export async function pauseCampaign(id: string): Promise<PauseCampaignResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockPauseCampaign(id);
  }
  return apiPost<PauseCampaignResponse>(`/api/v1/campaigns/${id}/pause`);
}

export async function resumeCampaign(id: string, body: ResumeCampaignRequest = {}): Promise<ResumeCampaignResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockResumeCampaign(id, body);
  }
  return apiPost<ResumeCampaignResponse>(`/api/v1/campaigns/${id}/resume`, body);
}

export async function cancelCampaign(id: string): Promise<CancelCampaignResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockCancelCampaign(id);
  }
  return apiPost<CancelCampaignResponse>(`/api/v1/campaigns/${id}/cancel`);
}

/**
 * Disparo MANUAL de um alvo (ARQUITETURA §4.5, "🆕 Fase 4.D") — sem motor
 * automático nesta rodada, é o único jeito de uma campanha `running`
 * efetivamente enviar algo. `instanceId` omitido deixa o backend escolher
 * entre as instâncias da campanha.
 */
export async function sendCampaignTarget(
  campaignId: string,
  targetId: string,
  body: SendCampaignTargetRequest = {},
): Promise<SendCampaignTargetResponse> {
  if (USE_MOCKS) {
    await mockDelay(600);
    return mockSendCampaignTarget(campaignId, targetId, body);
  }
  return apiPost<SendCampaignTargetResponse>(`/api/v1/campaigns/${campaignId}/targets/${targetId}/send`, body);
}
