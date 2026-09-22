'use client';

import { getQueueStatus } from '@/lib/api/scraper';
import { usePolling } from './usePolling';

/**
 * Estado da fila de coleta, revalidado a cada 20s — não precisa da agressividade
 * do polling de progresso de busca (3s, `useSearchJob`), é um banner de saúde,
 * não uma barra de progresso ao vivo.
 */
export function useQueueStatus() {
  return usePolling(getQueueStatus, { intervalMs: 20000 });
}
