/**
 * outcome.ts — o que `executeSendAttempt` devolve (união discriminada,
 * ARQUITETURA §6.8.0.2) e a tabela de classificação de erro da Evolution
 * (§4.9.5/§6.8.6) — ÚNICA fonte de verdade para "isto é falha confirmada ou
 * incerta", "isto pune a instância", "isto desconecta a instância", "isto é
 * 409 ou 502". `apps/worker` (Fase 4.F.4) NUNCA pode ter uma cópia própria
 * desta tabela — ver ARQUITETURA §6.8.0.4, linha `EVOLUTION_ERROR_EFFECT`.
 *
 * Por que uma união discriminada e não `throw` (§6.8.0.2 da ARQUITETURA):
 * `executeSendAttempt` NÃO lança `ApiHttpError` — o motor não tem pedido nem
 * humano; para ele, `409 SEND_PACE_LOCKED` não é um erro, é a instrução
 * "reagende este alvo". `apps/web` (`sendLeadMessage`) traduz o `outcome`
 * para HTTP; o futuro `dispatch-tick.job` traduz para estado do alvo de
 * campanha (§6.8.5) — o `switch` de cada lado é exaustivo em TIPO: um
 * `outcome`/`code` novo quebra a COMPILAÇÃO dos dois chamadores, não vira
 * decisão improvisada.
 */
import type { MessagingErrorCode } from '@inno/messaging';
import type { AdvanceSendPaceResult } from '@inno/core';
import type { SendGuardVerdict, SendGuardWarning } from '@inno/core';

export type BlockedVerdict = Extract<SendGuardVerdict, { allow: false }>;

export type SendAttemptResult =
  | { outcome: 'blocked'; verdict: BlockedVerdict; optOutCreatedAt: Date | null }
  | { outcome: 'expired'; messageId: string }
  | { outcome: 'sent'; messageId: string; providerMessageId: string; sentAt: Date; pace: AdvanceSendPaceResult; warnings: SendGuardWarning[] }
  // `message` é o texto para o HUMANO que decide o que fazer com o veredito
  // (a resposta HTTP do envio manual, ARQUITETURA §6.8.0.1 "vocabulário
  // HTTP" — quem MONTA a resposta é `apps/web`, mas o texto em si nasce
  // aqui, igual nascia dentro de `mapSendErrorToApiError` antes da extração,
  // byte a byte: `MessagingError.message` quando existe, senão um texto
  // genérico — NUNCA o `String(err)` cru de um erro desconhecido).
  | { outcome: 'failed'; messageId: string; code: MessagingErrorCode; reason: string; message: string }
  | { outcome: 'uncertain'; messageId: string; code: MessagingErrorCode; reason: 'EVOLUTION_SEND_UNCERTAIN'; message: string };

export type EvolutionErrorEffect = {
  httpStatus: 409 | 502;
  reason: string;
  /**
   * `'uncertain'` (achado do Órion, revisão de 2026-09-22) — a Evolution pode
   * ter recebido e processado o envio ANTES do erro chegar até nós (timeout
   * nosso, ou 5xx que só aparece depois de processar). Só se aplica a
   * `TIMEOUT`/`TRANSIENT_ERROR`: os outros códigos (4xx que a Evolution
   * devolve ANTES de sequer tentar enviar) são `'failed'` de verdade, com
   * compensação de cota normal.
   */
  outcome: 'failed' | 'uncertain';
  /** `false` para `INVALID_NUMBER`/`AUTH_ERROR` (não é falha da instância/erro de config nossa) e para `outcome:'uncertain'` (não é falha CONFIRMADA da instância). */
  incrementConsecutiveFailures: boolean;
  /** `true` só para `INSTANCE_DISCONNECTED`/`INSTANCE_NOT_FOUND` — a instância "sumiu" do lado da Evolution. */
  disconnectInstance: boolean;
};

export const EVOLUTION_ERROR_EFFECT: Record<MessagingErrorCode, EvolutionErrorEffect> = {
  INSTANCE_DISCONNECTED: { httpStatus: 409, reason: 'INSTANCE_NOT_CONNECTED', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: true },
  INSTANCE_NOT_FOUND: { httpStatus: 409, reason: 'INSTANCE_MISSING_UPSTREAM', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: true },
  INVALID_NUMBER: { httpStatus: 409, reason: 'NUMBER_HAS_NO_WHATSAPP', outcome: 'failed', incrementConsecutiveFailures: false, disconnectInstance: false },
  AUTH_ERROR: { httpStatus: 502, reason: 'EVOLUTION_AUTH', outcome: 'failed', incrementConsecutiveFailures: false, disconnectInstance: false },
  RATE_LIMITED: { httpStatus: 502, reason: 'EVOLUTION_RATE_LIMITED', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
  // ⚠️ TRANSIENT_ERROR/TIMEOUT são 'uncertain', não 'failed' — `sendText` roda
  // com `retryable: false` (packages/messaging) exatamente por isto: nunca
  // reenviamos automaticamente um desses dois, então o único jeito de saber
  // se saiu é o operador checar a conversa ou esperar o webhook de status.
  TRANSIENT_ERROR: { httpStatus: 502, reason: 'EVOLUTION_SEND_UNCERTAIN', outcome: 'uncertain', incrementConsecutiveFailures: false, disconnectInstance: false },
  TIMEOUT: { httpStatus: 502, reason: 'EVOLUTION_SEND_UNCERTAIN', outcome: 'uncertain', incrementConsecutiveFailures: false, disconnectInstance: false },
  VALIDATION_ERROR: { httpStatus: 502, reason: 'EVOLUTION_UNKNOWN', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
  UNKNOWN: { httpStatus: 502, reason: 'EVOLUTION_UNKNOWN', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
};
