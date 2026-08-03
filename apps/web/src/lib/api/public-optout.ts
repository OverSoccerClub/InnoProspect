import { USE_MOCKS } from '@/lib/config';
import { apiPost } from '@/lib/fetcher';
import { mockConfirmPublicOptOut } from '@/mocks/public-optout';
import { mockDelay } from '@/mocks/utils';
import type { PublicOptOutResponse } from '@/types/optout';

/**
 * Endpoint público, sem sessão (ARQUITETURA.md §4.7 — `POST /api/v1/public/optout`).
 * Usado só pela página `/descadastro/[token]`. Nunca chamar `apiGet` para
 * "checar" o token antes — o contrato não define um GET de validação
 * separado, só a confirmação via POST com `confirm: true`.
 */
export async function confirmPublicOptOut(token: string): Promise<PublicOptOutResponse> {
  if (USE_MOCKS) {
    await mockDelay(500);
    return mockConfirmPublicOptOut(token);
  }
  return apiPost<PublicOptOutResponse>('/api/v1/public/optout', { token, confirm: true });
}
