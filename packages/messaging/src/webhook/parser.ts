/**
 * webhook/parser.ts — normaliza os 4 eventos do webhook da Evolution API
 * (ARQUITETURA §4.8) num tipo interno estável (`MessagingWebhookEvent`). O
 * resto do sistema NUNCA vê o formato bruto da Evolution — só este tipo.
 *
 * Reaproveita, sem duplicar:
 *   - `evolutionWebhookEventSchema`/`EVOLUTION_MESSAGE_STATUS_MAP` de
 *     `@inno/contracts` — já é o CONTRATO do shape bruto (ARQUITETURA §4.8).
 *   - `findOptOutTrigger` de `@inno/core` (ARQUITETURA §6.7) — o parser só
 *     SINALIZA que uma mensagem inbound é opt-out; quem cria o `OptOut` de
 *     fato é a rota do webhook (fora deste pacote — precisa de Prisma, que
 *     `packages/messaging` não pode importar).
 */
import { findOptOutTrigger } from '@inno/core';
import {
  EVOLUTION_MESSAGE_STATUS_MAP,
  evolutionWebhookEventSchema,
  type ConnectionUpdateEvent as RawConnectionUpdateEvent,
  type MessagesUpdateEvent as RawMessagesUpdateEvent,
  type MessagesUpsertEvent as RawMessagesUpsertEvent,
  type QrCodeUpdatedEvent as RawQrCodeUpdatedEvent,
} from '@inno/contracts';
import type {
  ConnectionUpdateEvent,
  IgnoredEvent,
  InboundMessageEvent,
  MessageStatusEvent,
  MessagingWebhookEvent,
  QrCodeUpdateEvent,
} from './types.js';

function ignored(instance: string | null, reason: IgnoredEvent['reason']): IgnoredEvent {
  return { type: 'ignored', instance, reason };
}

function normalizeMessagesUpsert(event: RawMessagesUpsertEvent): InboundMessageEvent | IgnoredEvent {
  const { key, message, pushName, messageTimestamp } = event.data;

  // fromMe: eco da nossa própria mensagem enviada — não é resposta do lead.
  if (key.fromMe) return ignored(event.instance, 'from_me');
  // Grupo (@g.us): fora de escopo — campanhas são 1:1 com o lead.
  if (key.remoteJid.endsWith('@g.us')) return ignored(event.instance, 'group_message');

  const text = message?.conversation ?? message?.extendedTextMessage?.text ?? '';
  const optOutTrigger = findOptOutTrigger(text);

  return {
    type: 'message_received',
    instance: event.instance,
    providerMessageId: key.id,
    fromJid: key.remoteJid,
    text,
    pushName: pushName ?? null,
    timestamp: new Date(messageTimestamp * 1000).toISOString(),
    isOptOutRequest: optOutTrigger !== null,
    optOutTrigger,
  };
}

function normalizeMessagesUpdate(event: RawMessagesUpdateEvent): MessageStatusEvent {
  return {
    type: 'message_status',
    instance: event.instance,
    providerMessageId: event.data.keyId,
    status: EVOLUTION_MESSAGE_STATUS_MAP[event.data.status],
  };
}

function normalizeConnectionUpdate(event: RawConnectionUpdateEvent): ConnectionUpdateEvent {
  const { state, statusReason } = event.data;
  const banned = state === 'close' && statusReason === 401;
  const normalizedState = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
  return {
    type: 'connection_update',
    instance: event.instance,
    state: normalizedState,
    banned,
    statusReason: statusReason ?? null,
  };
}

function normalizeQrCodeUpdated(event: RawQrCodeUpdatedEvent): QrCodeUpdateEvent {
  return {
    type: 'qr_updated',
    instance: event.instance,
    qrCodeBase64: event.data.qrcode.base64,
    pairingCode: event.data.qrcode.code,
  };
}

/** Tenta extrair `instance` de um payload que falhou a validação — só para log/observabilidade, nunca confiável. */
function looseInstance(rawBody: unknown): string | null {
  if (rawBody !== null && typeof rawBody === 'object' && 'instance' in rawBody) {
    const value = (rawBody as Record<string, unknown>).instance;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Normaliza um corpo bruto de `POST /api/webhooks/evolution/:instanceKey`
 * (ARQUITETURA §4.8) num `MessagingWebhookEvent`. NUNCA lança — payload
 * inválido ou evento desconhecido vira `{ type: 'ignored' }` em vez de
 * exceção, porque o contrato do webhook exige responder `200` rápido mesmo
 * em erro de processamento (§4.8: "a Evolution API reenvia em não-200 e pode
 * entrar em loop").
 */
export function parseEvolutionWebhookEvent(rawBody: unknown): MessagingWebhookEvent {
  const parsed = evolutionWebhookEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return ignored(looseInstance(rawBody), 'invalid_payload');
  }

  const event = parsed.data;
  switch (event.event) {
    case 'connection.update':
      return normalizeConnectionUpdate(event);
    case 'qrcode.updated':
      return normalizeQrCodeUpdated(event);
    case 'messages.upsert':
      return normalizeMessagesUpsert(event);
    case 'messages.update':
      return normalizeMessagesUpdate(event);
    default: {
      // Exaustividade: `evolutionWebhookEventSchema` é união discriminada
      // fechada — se o TS reclamar aqui, um evento novo foi adicionado ao
      // Zod sem atualizar este switch.
      const _exhaustive: never = event;
      void _exhaustive;
      return ignored(null, 'unrecognized_event');
    }
  }
}

/**
 * Comparação em tempo constante — para a rota do webhook validar o header
 * `apikey` contra `EVOLUTION_API_KEY` sem vazar timing (ARQUITETURA §4.8:
 * "conferido... em tempo constante"). Implementado sem `node:crypto` para
 * não prender este pacote a um runtime específico.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
