'use client';

import { getCampaign } from '@/lib/api/campaigns';
import type { CampaignDetail } from '@/types/campaign';
import { usePolling } from './usePolling';

const LIVE_STATUSES: CampaignDetail['status'][] = ['running', 'scheduled'];

/**
 * Progresso ao vivo de uma campanha — polling de 3s, mesmo intervalo do
 * progresso de busca (ARQUITETURA.md §4.5.7: "a tela de campanha faz poll de
 * 3s em `GET /campaigns/:id`, igual à de busca. Não introduzir SSE/
 * WebSocket na Fase 4"). Para sozinho fora de `running`/`scheduled` — uma
 * campanha `draft`, `paused`, `halted`, `completed` ou `cancelled` não muda
 * sozinha entre um poll e outro.
 */
export function useCampaign(id: string) {
  return usePolling<CampaignDetail>(() => getCampaign(id), {
    intervalMs: 3000,
    shouldContinue: (campaign) => LIVE_STATUSES.includes(campaign.status),
  });
}
