/**
 * whatsapp.contract.ts — Instâncias de WhatsApp / Evolution API (ARQUITETURA
 * §4.6). Estado ainda não modelado no Prisma (Fase 3) — este arquivo é a
 * fonte da verdade até Cronos criar `WhatsAppInstance`/`InstanceDailyStat`.
 */
import { z } from 'zod';
import {
  idSchema,
  instanceHealthSchema,
  isoDateTimeSchema,
  messageDirectionSchema,
  messageStatusSchema,
  whatsAppInstanceStatusSchema,
} from './common.js';

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances
// ─────────────────────────────────────────────────────────────────────────

export const instanceWarmupSchema = z.object({
  day: z.number().int().min(1),
  dailyLimit: z.number().int().min(1),
  /** `true` quando já passou do ramp-up (dia 22+, ARQUITETURA §6.2). */
  isWarm: z.boolean(),
});
export type InstanceWarmup = z.infer<typeof instanceWarmupSchema>;

export const instanceTodayStatsSchema = z.object({
  sent: z.number().int().min(0),
  failed: z.number().int().min(0),
  responded: z.number().int().min(0),
  remaining: z.number().int().min(0),
});
export type InstanceTodayStats = z.infer<typeof instanceTodayStatsSchema>;

export const whatsAppInstanceItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  phoneNumber: z.string().nullable(),
  status: whatsAppInstanceStatusSchema,
  health: instanceHealthSchema,
  warmup: instanceWarmupSchema,
  today: instanceTodayStatsSchema,
  lastConnectionAt: isoDateTimeSchema.nullable(),
  lastErrorAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  activeCampaigns: z.number().int().min(0),
  /**
   * 🆕 Reconciliação de status (incidente do dono, 2026-09-24: "mesmo
   * desconectado, o sistema ainda mostra como conectado"). A última vez que
   * este `status` foi CONFIRMADO contra a Evolution API — NUNCA "a última
   * vez que mudou". `null` = nunca confirmado desde que esta coluna existe
   * (instância antiga, ou reconciliação ainda não rodou para ela). A tela
   * usa isto para dizer "não consigo confirmar desde X" quando a Evolution
   * está fora do ar (a reconciliação falha em silêncio e NÃO avança este
   * campo — ver `apps/web/src/lib/services/whatsapp-instances.ts`).
   */
  statusCheckedAt: isoDateTimeSchema.nullable(),
});
export type WhatsAppInstanceItem = z.infer<typeof whatsAppInstanceItemSchema>;

export const listWhatsAppInstancesResponseSchema = z.object({
  data: z.array(whatsAppInstanceItemSchema),
});
export type ListWhatsAppInstancesResponse = z.infer<typeof listWhatsAppInstancesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/whatsapp/instances/reconcile
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reconciliação FORÇADA (sob pedido explícito do operador, `requireRole:
 * 'admin'`) — ignora o limite de frescor e cobre TODA instância, não só as
 * `connected` (diferente da reconciliação automática de `GET
 * /whatsapp/instances`, que só olha para instância `connected` e obsoleta —
 * ver o comentário grande em `whatsapp-instances.ts#reconcileOneInstance`).
 * `data` tem o MESMO shape de `ListWhatsAppInstancesResponse` de propósito:
 * a tela troca os dados que já tem pelo resultado, sem precisar de um
 * segundo formato.
 *
 * `unconfirmed` NÃO é decoração. A reconciliação NUNCA falha a requisição:
 * uma instância que não pôde ser consultada (Evolution fora do ar, servidor
 * Evolution inativo, timeout) mantém o último estado conhecido e segue no
 * `data` — é a postura correta para o `GET` da lista, que não pode quebrar
 * por causa de um upstream. Mas quando o operador CLICA em "Verificar
 * agora", "não deu erro" e "eu confirmei" deixam de ser a mesma coisa: com
 * a Evolution inteira fora do ar a resposta seria um `200` idêntico ao de
 * sucesso, e a tela diria em silêncio que verificou. Este contador é o que
 * permite à tela dizer "tentei e não consegui confirmar N de M" — e ele
 * também cobre o caso PARCIAL (3 de 4 confirmadas), que um código de erro
 * HTTP não conseguiria expressar sem mentir sobre as outras 3.
 */
export const reconcileWhatsAppInstancesResponseSchema = listWhatsAppInstancesResponseSchema.extend({
  /** Quantas instâncias desta rodada NÃO puderam ser confirmadas contra a Evolution (o `statusCheckedAt` delas não avançou). `0` = todas confirmadas. */
  unconfirmed: z.number().int().min(0),
});
export type ReconcileWhatsAppInstancesResponse = z.infer<typeof reconcileWhatsAppInstancesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/whatsapp/instances
// ─────────────────────────────────────────────────────────────────────────

export const createWhatsAppInstanceBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  /**
   * 🆕 Fase 4.B — OBRIGATÓRIO para toda instância NOVA (mesmo com a coluna
   * `WhatsAppInstance.evolutionServerId` ainda nullable no banco durante a
   * janela de bootstrap — ver comentário completo no schema Prisma). Toda
   * instância criada a partir desta rodada em diante sabe, desde o
   * nascimento, em qual `EvolutionServer` ela vive; o `null` que resta é só
   * de linhas legadas (criadas ANTES desta feature existir).
   */
  evolutionServerId: idSchema,
  startWarmup: z.boolean().default(true),
});
export type CreateWhatsAppInstanceBody = z.infer<typeof createWhatsAppInstanceBodySchema>;

export const createWhatsAppInstanceResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.literal('qr_pending'),
  evolutionInstanceName: z.string(),
});
export type CreateWhatsAppInstanceResponse = z.infer<typeof createWhatsAppInstanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances/:id/qr
// ─────────────────────────────────────────────────────────────────────────

export const getQrCodeResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('qr_pending'),
    qrCodeBase64: z.string(),
    expiresInSeconds: z.number().int().min(0),
    pairingCode: z.string().optional(),
  }),
  z.object({
    status: z.literal('connected'),
    qrCodeBase64: z.null(),
  }),
]);
export type GetQrCodeResponse = z.infer<typeof getQrCodeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances/:id/status
// ─────────────────────────────────────────────────────────────────────────

/**
 * Leitura PURA do estado de conexão na Evolution
 * (`EvolutionClient.getConnectionState`, `GET /instance/connectionState/:name`)
 * — nunca (re)inicia o pareamento nem emite QR novo. Existe separado de
 * `GetQrCodeResponse` porque aquele endpoint SEMPRE regenera o QR a cada
 * chamada (bug real de produção, 2026-09-23: a tela fazia poll de 2s em
 * `.../qr` e invalidava o QR antes de dar tempo de escanear — ver
 * `apps/web/src/lib/services/whatsapp-instances.ts#getWhatsAppInstanceStatus`).
 * Este é o endpoint seguro para sondar com frequência.
 */
export const getInstanceStatusResponseSchema = z.object({
  status: whatsAppInstanceStatusSchema,
});
export type GetInstanceStatusResponse = z.infer<typeof getInstanceStatusResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/whatsapp/instances/:id
// ─────────────────────────────────────────────────────────────────────────

export const instanceDailyStatSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  sentCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  respondedCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
});
export type InstanceDailyStat = z.infer<typeof instanceDailyStatSchema>;

/** `GET /api/v1/whatsapp/instances/:id` — objeto completo + histórico de 30 dias. */
export const whatsAppInstanceDetailSchema = whatsAppInstanceItemSchema.extend({
  history: z.array(instanceDailyStatSchema),
});
export type WhatsAppInstanceDetail = z.infer<typeof whatsAppInstanceDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Ações
// ─────────────────────────────────────────────────────────────────────────

export const connectInstanceResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('qr_pending'),
});
export type ConnectInstanceResponse = z.infer<typeof connectInstanceResponseSchema>;

export const disconnectInstanceResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal('disconnected'),
  pausedCampaigns: z.array(idSchema),
});
export type DisconnectInstanceResponse = z.infer<typeof disconnectInstanceResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Message — modelo completo (Fase 3+), reaproveitado por lead/campaign quando
// precisarem do detalhe completo de uma mensagem (aqui só o essencial).
// ─────────────────────────────────────────────────────────────────────────

export const messageItemSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  campaignTargetId: idSchema.nullable(),
  instanceId: idSchema,
  direction: messageDirectionSchema,
  body: z.string(),
  providerMessageId: z.string().nullable(),
  status: messageStatusSchema,
  errorCode: z.string().nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  readAt: isoDateTimeSchema.nullable(),
});
export type MessageItem = z.infer<typeof messageItemSchema>;

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/leads/:id/messages — envio unitário (ARQUITETURA §4.9.2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Exatamente UM de `templateId`/`body` (ARQUITETURA §4.9.2 — "enviar os dois
 * ou nenhum é 422"). Deliberadamente SEM `.refine()` de exclusividade aqui:
 * a mensagem/`reason` (`BODY_OR_TEMPLATE_REQUIRED`) é responsabilidade do
 * serviço (`lib/services/messages.ts`), que já vai buscar o template e
 * precisa decidir isso de qualquer forma — duplicar a regra em Zod só
 * arriscaria as duas mensagens divergirem.
 */
export const sendLeadMessageBodySchema = z.object({
  templateId: idSchema.optional(),
  body: z.string().trim().max(4000).optional(),
  instanceId: idSchema.optional(),
  spintaxSeed: z.string().min(1).max(200).optional(),
  confirmOutsideBusinessWindow: z.boolean().default(false),
  allowNonMobile: z.boolean().default(false),
});
export type SendLeadMessageBody = z.infer<typeof sendLeadMessageBodySchema>;

export const sendLeadMessageWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type SendLeadMessageWarning = z.infer<typeof sendLeadMessageWarningSchema>;

export const sendLeadMessageResponseSchema = z.object({
  message: messageItemSchema,
  instance: z.object({
    id: idSchema,
    name: z.string(),
    phoneNumber: z.string().nullable(),
    health: instanceHealthSchema,
  }),
  quota: z.object({
    warmupDay: z.number().int().min(1),
    isWarm: z.boolean(),
    dailyLimit: z.number().int().min(1),
    sentToday: z.number().int().min(0),
    remaining: z.number().int().min(0),
  }),
  renderedFrom: z.object({ templateId: idSchema, spintaxSeed: z.string() }).nullable(),
  warnings: z.array(sendLeadMessageWarningSchema),
});
export type SendLeadMessageResponse = z.infer<typeof sendLeadMessageResponseSchema>;
