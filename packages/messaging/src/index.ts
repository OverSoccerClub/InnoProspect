/**
 * @inno/messaging — TODO o acoplamento com a Evolution API vive aqui
 * (ARQUITETURA §1.2, §4.6, §4.8). Único pacote do projeto que conhece o
 * formato de payload/endpoint da Evolution — `apps/web` e `apps/worker` só
 * enxergam os tipos normalizados exportados por este arquivo.
 *
 * ⚠️ NÃO VALIDADO CONTRA UM SERVIDOR EVOLUTION REAL — não há Evolution API
 * rodando neste ambiente. Escrito contra doc.evolution-api.com (v2.x) e
 * ARQUITETURA §4.8. Ver `client/wire.ts` para o detalhe do que está marcado
 * como suposição e o handoff do Vega para a lista de PENDÊNCIAS.
 */

// ─────────────────────────────────────────────────────────────────────────
// Erros — classificação (ARQUITETURA §6.6, kill switch consome `code`/`retryable`)
// ─────────────────────────────────────────────────────────────────────────
export { MessagingError, MESSAGING_ERROR_POLICY, applyJitter, backoffForAttempt, sleep } from './errors.js';
export type { MessagingErrorCode, MessagingErrorPolicy, MessagingErrorOptions } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────
// Cliente HTTP tipado (ARQUITETURA §4.6)
// ─────────────────────────────────────────────────────────────────────────
export { EvolutionClient, evolutionConfigFromEnv } from './client/evolution-client.js';
export type { EvolutionClientConfig } from './client/evolution-client.js';
export type {
  ConnectionState,
  QrCode,
  CreateInstanceInput,
  CreateInstanceResult,
  ConnectResult,
  SendTextInput,
  SendTextResult,
  SetWebhookInput,
  NumberCheckResult,
} from './types.js';
export { DEFAULT_WEBHOOK_EVENTS } from './client/wire.js';
export type { EvolutionWebhookEventName } from './client/wire.js';

// ─────────────────────────────────────────────────────────────────────────
// Webhook — parser normalizado + opt-out (ARQUITETURA §4.8, §6.7)
// ─────────────────────────────────────────────────────────────────────────
export { parseEvolutionWebhookEvent, constantTimeEqual } from './webhook/parser.js';
export type {
  MessagingWebhookEvent,
  InboundMessageEvent,
  MessageStatusEvent,
  ConnectionUpdateEvent,
  QrCodeUpdateEvent,
  IgnoredEvent,
  MessageStatusNormalized,
} from './webhook/types.js';
