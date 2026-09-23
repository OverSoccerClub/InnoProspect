/**
 * types.ts — tipos públicos do cliente Evolution (o que o resto do sistema
 * vê). Vocabulário próprio, não o da Evolution — ver `client/wire.ts` para o
 * formato bruto.
 */
import type { EvolutionWebhookEventName } from './client/wire.js';

/** Estado de conexão normalizado — `'close'` da Evolution vira `'disconnected'` aqui (mais claro para quem não conhece a API). */
export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

export type QrCode = {
  /** Já como veio da Evolution (o formato — data URI puro ou base64 cru — não foi confirmado contra servidor real; ver PENDÊNCIAS). */
  base64: string;
  pairingCode: string | null;
};

export type CreateInstanceInput = {
  /** Nome da instância na Evolution API — não confundir com `WhatsAppInstance.id` (cuid2) do Postgres, que ainda não existe (Fase 3, Cronos). */
  instanceName: string;
};

export type CreateInstanceResult = {
  instanceName: string;
  instanceId: string | null;
  state: ConnectionState;
  qr: QrCode | null;
  /**
   * 🆕 Credencial de webhook PRÓPRIA desta instância (distinta da chave
   * global do `EvolutionServer`) — achado do dono, 2026-09-23: a Evolution
   * v2 dá uma `apikey` por instância. `null` se a resposta não trouxe
   * nenhum campo reconhecido (`client/wire.ts#readInstanceApiKey`, parsing
   * defensivo — NÃO CONFIRMADO contra servidor real). Quem chama decide o
   * que fazer com `null` (cai no fallback da chave do servidor/env).
   */
  apiKey: string | null;
};

/** Ver `client/wire.ts#parseFetchInstancesResponse` — usado pelo comando operacional que preenche a credencial própria de instâncias já pareadas. */
export type FetchedInstanceInfo = {
  instanceName: string | null;
  apiKey: string | null;
};

export type ConnectResult = {
  state: ConnectionState;
  qr: QrCode | null;
};

export type SendTextInput = {
  /** E.164, ex.: "+5511987654321" (ARQUITETURA §4.0 — mesmo formato usado em toda a API). */
  to: string;
  text: string;
  /** ms de "digitando..." simulado antes do envio (repassado como `delay` — ver `client/wire.ts`). */
  delayMs?: number;
  linkPreview?: boolean;
};

export type SendTextResult = {
  /** `data.key.id` da Evolution — vira `Message.providerMessageId` quando o Cronos modelar `Message` (Fase 3). */
  providerMessageId: string;
  remoteJid: string | null;
  /** Status bruto (se a Evolution devolver um no corpo do `sendText`) — não usar para lógica; o status confiável vem do webhook `messages.update`. */
  rawStatus: string | null;
};

export type SetWebhookInput = {
  url: string;
  /** Default: os 4 eventos que `webhook/parser.ts` sabe interpretar (`DEFAULT_WEBHOOK_EVENTS`). */
  events?: EvolutionWebhookEventName[];
};

export type NumberCheckResult = {
  /** O E.164 que foi consultado (eco do input, não o formato bruto da Evolution). */
  input: string;
  exists: boolean;
  jid: string | null;
};
