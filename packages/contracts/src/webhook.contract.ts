/**
 * webhook.contract.ts — Webhook do Evolution API (ARQUITETURA §4.8).
 * CONTRATO — Vega implementa `POST /api/webhooks/evolution/:instanceKey`.
 *
 * Regras de contrato reforçadas aqui (não são só tipo, são comportamento
 * exigido de quem implementa a rota — ver ARQUITETURA §4.8):
 *   - `:instanceKey` errado → 404, nunca 401 (não confirmar existência).
 *   - Responder sempre `200 { received: true }` rápido, mesmo em erro de
 *     processamento — processamento pesado vai para a fila.
 *   - Idempotência por `data.key.id`.
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Eventos recebidos da Evolution API
// ─────────────────────────────────────────────────────────────────────────

export const connectionUpdateEventSchema = z.object({
  event: z.literal('connection.update'),
  instance: z.string(),
  data: z.object({
    state: z.enum(['open', 'close', 'connecting']),
    statusReason: z.number().optional(),
  }),
});
export type ConnectionUpdateEvent = z.infer<typeof connectionUpdateEventSchema>;

export const qrCodeUpdatedEventSchema = z.object({
  event: z.literal('qrcode.updated'),
  instance: z.string(),
  data: z.object({
    qrcode: z.object({
      base64: z.string(),
      code: z.string(),
    }),
  }),
});
export type QrCodeUpdatedEvent = z.infer<typeof qrCodeUpdatedEventSchema>;

export const messagesUpsertEventSchema = z.object({
  event: z.literal('messages.upsert'),
  instance: z.string(),
  data: z.object({
    key: z.object({
      id: z.string(),
      remoteJid: z.string(),
      fromMe: z.boolean(),
    }),
    message: z
      .object({
        conversation: z.string().optional(),
        extendedTextMessage: z.object({ text: z.string() }).optional(),
      })
      .nullable()
      .optional(),
    pushName: z.string().optional(),
    messageTimestamp: z.number(),
  }),
});
export type MessagesUpsertEvent = z.infer<typeof messagesUpsertEventSchema>;

export const evolutionMessageStatusSchema = z.enum([
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'ERROR',
]);
export type EvolutionMessageStatus = z.infer<typeof evolutionMessageStatusSchema>;

/**
 * Mapa fixo (CONTRATO ARQUITETURA §4.8): `PENDING→queued`, `SERVER_ACK→sent`,
 * `DELIVERY_ACK→delivered`, `READ→read`, `ERROR→failed`.
 */
export const EVOLUTION_MESSAGE_STATUS_MAP: Record<EvolutionMessageStatus, 'queued' | 'sent' | 'delivered' | 'read' | 'failed'> = {
  PENDING: 'queued',
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  ERROR: 'failed',
};

export const messagesUpdateEventSchema = z.object({
  event: z.literal('messages.update'),
  instance: z.string(),
  data: z.object({
    keyId: z.string(),
    status: evolutionMessageStatusSchema,
  }),
});
export type MessagesUpdateEvent = z.infer<typeof messagesUpdateEventSchema>;

/** União discriminada por `event` — corpo de `POST /api/webhooks/evolution/:instanceKey`. */
export const evolutionWebhookEventSchema = z.discriminatedUnion('event', [
  connectionUpdateEventSchema,
  qrCodeUpdatedEventSchema,
  messagesUpsertEventSchema,
  messagesUpdateEventSchema,
]);
export type EvolutionWebhookEvent = z.infer<typeof evolutionWebhookEventSchema>;

/** Resposta padrão — sempre `200`, mesmo em erro de processamento interno. */
export const webhookAckResponseSchema = z.object({ received: z.literal(true) });
export type WebhookAckResponse = z.infer<typeof webhookAckResponseSchema>;
