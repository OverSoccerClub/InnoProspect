// TODO: trocar por import de @inno/contracts se/quando o Vega formalizar este
// contrato ali (ainda não existe `dispatch.contract.ts` — conferido em
// `packages/contracts/src/` na Fase 4.F.3). Formato lido direto de
// `apps/web/src/lib/services/dispatch.ts` (`DispatchQueueStatusView` e os
// retornos de `pauseDispatchQueue`/`resumeDispatchQueue`) — mesmo espírito de
// `types/scraper-queue.ts`, precisa continuar batendo campo a campo com o
// serviço real.

export type DispatchQueueStatus = 'paused' | 'running';

export type DispatchQueueStatusResponse = {
  status: DispatchQueueStatus;
  /** `null` quando pausado — quem ligou o motor só faz sentido enquanto ele está ligado. */
  enabledAt: string | null;
  enabledBy: string | null;
  /**
   * Autoria da pausa ATUAL — só preenchida quando `status === 'paused'`.
   * `null` numa pausa é legítimo e tem três causas indistinguíveis: o motor
   * nasceu pausado (ninguém pausou), o Redis foi limpo, ou a pausa é
   * anterior a este registro existir. A tela precisa tratar "pausado sem
   * autoria" como normal, nunca como dado faltando.
   */
  pausedAt: string | null;
  pausedBy: string | null;
  /** Texto livre curto, só quem chama a API direto envia — a tela pausa sem perguntar nada (§6.8.9). */
  pausedReason: string | null;
  /**
   * `null` = sem heartbeat (worker nunca subiu OU caiu há mais de
   * `DISPATCH_HEARTBEAT_TTL_SECONDS` — a chave no Redis expira e as duas
   * situações ficam indistinguíveis uma vez que o TTL estourou; ver
   * `lib/dispatch-heartbeat.ts`). Presente = heartbeat visto há no máximo
   * ~45s (o próprio TTL garante isso).
   */
  lastTickAt: string | null;
  /** Snapshot do servidor no momento do `GET` — a tela recalcula a idade no cliente via `lastTickAt` + `useNow`, não confia neste número parado entre polls. */
  tickAgeSeconds: number | null;
};

export type PauseDispatchQueueResponse = { ok: true; status: 'paused' };

export type ResumeDispatchQueueResponse = { ok: true; status: 'running'; enabledAt: string };
