import { ApiRequestError } from '@/lib/fetcher';
import type {
  DispatchQueueStatusResponse,
  PauseDispatchQueueResponse,
  ResumeDispatchQueueResponse,
} from '@/types/dispatch-queue';

/**
 * Estado mutável do mock (módulo singleton, como o resto de `mocks/*`) — o
 * motor NASCE PAUSADO (`enabled: null`), mesma regra do lado real
 * (`lib/services/dispatch.ts`: ausência da chave = pausado). Sem ator/motivo
 * de pausa registrado de propósito — a API real também não guarda isso, ver
 * comentário em `types/dispatch-queue.ts`.
 */
let enabled: { enabledAt: string; enabledBy: string } | null = null;
/** Espelha `DISPATCH_PAUSED_META_KEY` do backend: escrito ao pausar, limpo ao retomar. Começa `null` — o motor nasce pausado e ninguém pausou. */
let pausedMeta: { pausedAt: string; pausedBy: string; reason?: string } | null = null;

/**
 * Heartbeat simulado como "worker sempre vivo": cada leitura devolve um
 * `lastTickAt` recente (poucos segundos atrás), calculado no momento da
 * chamada — não um valor fixo que envelheceria para sempre durante uma
 * sessão de mock longa. Não simula o worker morto (não há toggle de cenário
 * hoje neste mock, mesmo padrão de `mocks/scraper.ts`); se um dia for preciso
 * exercitar visualmente o caso "worker morto" com `NEXT_PUBLIC_USE_MOCKS`,
 * este é o lugar a mudar.
 */
function mockHeartbeat(): { lastTickAt: string; tickAgeSeconds: number } {
  const ageSeconds = 3;
  return { lastTickAt: new Date(Date.now() - ageSeconds * 1000).toISOString(), tickAgeSeconds: ageSeconds };
}

export function mockGetDispatchQueueStatus(): DispatchQueueStatusResponse {
  const heartbeat = mockHeartbeat();
  return {
    status: enabled ? 'running' : 'paused',
    enabledAt: enabled?.enabledAt ?? null,
    enabledBy: enabled?.enabledBy ?? null,
    pausedAt: enabled ? null : (pausedMeta?.pausedAt ?? null),
    pausedBy: enabled ? null : (pausedMeta?.pausedBy ?? null),
    pausedReason: enabled ? null : (pausedMeta?.reason ?? null),
    lastTickAt: heartbeat.lastTickAt,
    tickAgeSeconds: heartbeat.tickAgeSeconds,
  };
}

export function mockPauseDispatchQueue(): PauseDispatchQueueResponse {
  if (!enabled) {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'O motor de disparo já está pausado — não há o que pausar.',
      requestId: 'mock',
    });
  }
  enabled = null;
  pausedMeta = { pausedAt: new Date().toISOString(), pausedBy: 'operador@mock.local' };
  return { ok: true, status: 'paused' };
}

/**
 * Sem thread de sessão real até aqui (mocks não recebem o `actor` que a rota
 * de verdade tira de `session.user`, ver `lib/services/dispatch.ts`) — o
 * e-mail é um placeholder fixo só para o "retomado por" ter algo pra
 * mostrar em modo mock.
 */
export function mockResumeDispatchQueue(): ResumeDispatchQueueResponse {
  if (enabled) {
    throw new ApiRequestError(409, {
      code: 'CONFLICT',
      message: 'O motor de disparo já está rodando — não há o que retomar.',
      requestId: 'mock',
    });
  }
  const enabledAt = new Date().toISOString();
  enabled = { enabledAt, enabledBy: 'operador@mock.local' };
  pausedMeta = null;
  return { ok: true, status: 'running', enabledAt };
}
