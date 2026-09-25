import { USE_MOCKS } from '@/lib/config';
import { apiGet, apiPost } from '@/lib/fetcher';
import { mockGetDispatchQueueStatus, mockPauseDispatchQueue, mockResumeDispatchQueue } from '@/mocks/dispatch';
import { mockDelay } from '@/mocks/utils';
import type {
  DispatchQueueStatusResponse,
  PauseDispatchQueueResponse,
  ResumeDispatchQueueResponse,
} from '@/types/dispatch-queue';

/** `GET /api/v1/dispatch/queue` — estado do freio global do motor de disparo (pausado/rodando) + heartbeat do worker. Qualquer operador autenticado pode ler. */
export async function getDispatchQueueStatus(): Promise<DispatchQueueStatusResponse> {
  if (USE_MOCKS) {
    await mockDelay(200);
    return mockGetDispatchQueueStatus();
  }
  return apiGet<DispatchQueueStatusResponse>('/api/v1/dispatch/queue');
}

/**
 * `POST /api/v1/dispatch/queue` — pausa manual (o botão de incidente,
 * ARQUITETURA §6.8.9). De propósito SEM `acknowledge`/confirmação no corpo —
 * tem que funcionar em UM clique sob estresse. `requireRole: 'admin'` do
 * lado da API; o gate de UI é só cortesia (ver `dispatch-engine-card.tsx`).
 */
export async function pauseDispatchQueue(): Promise<PauseDispatchQueueResponse> {
  if (USE_MOCKS) {
    await mockDelay(300);
    return mockPauseDispatchQueue();
  }
  return apiPost<PauseDispatchQueueResponse>('/api/v1/dispatch/queue');
}

/**
 * `POST /api/v1/dispatch/queue/resume` — liga/retoma o motor. Sempre com
 * `acknowledge: true` explícito (a ação de MAIOR risco deste par — volta a
 * mandar mensagem pra gente real), mesmo espírito de `resumeQueue` (scraper).
 */
export async function resumeDispatchQueue(): Promise<ResumeDispatchQueueResponse> {
  if (USE_MOCKS) {
    await mockDelay(400);
    return mockResumeDispatchQueue();
  }
  return apiPost<ResumeDispatchQueueResponse>('/api/v1/dispatch/queue/resume', { acknowledge: true });
}
