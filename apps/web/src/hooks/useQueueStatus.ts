'use client';

import { getQueueStatus } from '@/lib/api/scraper';
import { usePolling } from './usePolling';

/**
 * Estado da fila de coleta, revalidado a cada 20s — não precisa da agressividade
 * do polling de progresso de busca (3s, `useSearchJob`), é um banner de saúde,
 * não uma barra de progresso ao vivo. `enabled=false` desliga o polling
 * inteiro (usado por `QueueHealthBanner` quando um `status` fixo já foi
 * passado via prop — evita um round-trip que ninguém vai usar).
 */
export function useQueueStatus(enabled = true) {
  return usePolling(getQueueStatus, { intervalMs: 20000, enabled });
}
