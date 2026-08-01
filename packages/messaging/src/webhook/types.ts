/**
 * webhook/types.ts — tipo normalizado dos eventos do webhook da Evolution
 * API (ARQUITETURA §4.8). Formato ESTÁVEL: o resto do sistema (a rota
 * `POST /api/webhooks/evolution/:instanceKey`, o worker) depende disto, não
 * do payload bruto da Evolution — só `webhook/parser.ts` conhece o bruto.
 */

export type MessageStatusNormalized = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export type InboundMessageEvent = {
  type: 'message_received';
  instance: string;
  /** `data.key.id` da Evolution — chave de idempotência (ARQUITETURA §4.8: "evento repetido é ignorado silenciosamente"). Quem dedupe é a rota (tem acesso ao Postgres); este parser só expõe o campo de forma estável. */
  providerMessageId: string;
  fromJid: string;
  text: string;
  pushName: string | null;
  /** ISO 8601 UTC. Convertido de `messageTimestamp` (segundos Unix, convenção Baileys) — NÃO confirmado contra payload real, ver PENDÊNCIAS. */
  timestamp: string;
  /** `true` quando `text` casa com `findOptOutTrigger` (@inno/core, ARQUITETURA §6.7). A rota deve criar `OptOut` IMEDIATAMENTE quando `true` — este parser só sinaliza, não persiste (sem Prisma aqui). */
  isOptOutRequest: boolean;
  optOutTrigger: string | null;
};

export type MessageStatusEvent = {
  type: 'message_status';
  instance: string;
  /** `data.keyId` — mesmo valor que seria `Message.providerMessageId` (Fase 3). */
  providerMessageId: string;
  status: MessageStatusNormalized;
};

export type ConnectionUpdateEvent = {
  type: 'connection_update';
  instance: string;
  state: 'connected' | 'connecting' | 'disconnected';
  /** `true` quando `state==='close'` com `statusReason===401` — ban confirmado (ARQUITETURA §4.8/§6.6: "→ instance.status='banned'"). */
  banned: boolean;
  statusReason: number | null;
};

export type QrCodeUpdateEvent = {
  type: 'qr_updated';
  instance: string;
  qrCodeBase64: string;
  pairingCode: string;
};

export type IgnoredEvent = {
  type: 'ignored';
  /** `null` quando nem o `instance` do payload pôde ser lido (payload totalmente inválido). */
  instance: string | null;
  reason: 'from_me' | 'group_message' | 'invalid_payload' | 'unrecognized_event';
};

export type MessagingWebhookEvent =
  | InboundMessageEvent
  | MessageStatusEvent
  | ConnectionUpdateEvent
  | QrCodeUpdateEvent
  | IgnoredEvent;
