'use client';

import { getDispatchQueueStatus } from '@/lib/api/dispatch';
import { usePolling } from './usePolling';

/**
 * Estado do motor de disparo, revalidado a cada 15s — mesmo intervalo do
 * tick do worker (`DISPATCH_TICK_INTERVAL_MS`, `apps/worker/src/scheduler.ts`),
 * para o card conseguir mostrar um heartbeat que praticamente nunca fica
 * "atrasado" só por causa do próprio polling. Entre polls, `useNow` (no
 * componente) continua envelhecendo o texto relativo sem precisar de fetch.
 */
export function useDispatchQueueStatus() {
  return usePolling(getDispatchQueueStatus, { intervalMs: 15000 });
}
