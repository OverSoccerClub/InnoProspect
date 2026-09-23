/**
 * lib/services/messages.ts — envio unitário de mensagem
 * (`POST /api/v1/leads/:id/messages`, ARQUITETURA §4.9). Implementa os
 * portões G0-G11 na ordem normativa de §4.9.3: G0 (sessão) é o
 * `api-handler.ts`; G1-G3 e a resolução de instância/afinidade ficam aqui
 * (dependem de Prisma); G4-G11 são `evaluateSendGuard` (`@inno/core`, puro).
 *
 * ⚠️ PONTO QUE O ÓRION AUDITA (§4.9.9 item 5): a consulta de opt-out
 * (`prisma.optOut.findUnique` por `phoneE164`) é a ÚLTIMA leitura de banco
 * antes de `evaluateSendGuard`, que por sua vez é chamado NA MESMA função
 * (`sendLeadMessage`, abaixo) que chama `EvolutionClient.sendText()`. Entre a
 * consulta de opt-out e `evaluateSendGuard` não há nenhum `await`. Entre
 * `evaluateSendGuard` (quando `allow:true`) e `sendText` só existe a
 * transação de write-ahead (§4.9.5) — é INTENCIONAL e ÚNICA, não uma segunda
 * leitura de opt-out nem qualquer outra consulta "solta". `grep -rn
 * "sendText(" apps/ packages/` deve achar exatamente UMA chamada de produção
 * para mensagem de lead: a linha marcada abaixo.
 */
import { prisma, type Lead, type Prisma, type WhatsAppInstance } from '@inno/db';
import { MessagingError, type MessagingErrorCode } from '@inno/messaging';
import {
  advanceSendPace,
  checkStatusTransition,
  deriveInstanceHealth,
  effectiveDailyLimit,
  evaluateSendGuard,
  firstName,
  isWarmupDayWarm,
  nextLocalMidnight,
  parseSpintax,
  renderTemplate,
  resolveSpintax,
  validateTemplateVariables,
  DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS,
  DEFAULT_JITTER_RANGE_SECONDS,
  DEFAULT_MICRO_PAUSE_CONFIG,
  DEFAULT_SEND_WINDOW_CONFIG,
  MAX_DECISION_TO_SEND_MS,
  MIN_JITTER_FLOOR_SECONDS,
  type AdvanceSendPaceResult,
  type JitterRangeSeconds,
  type LeadStatus,
  type MicroPauseConfig,
  type PaceAdvanceMode,
  type SendGuardFacts,
  type SendGuardVerdict,
  type SendWindowConfig,
  type TemplateVariableValues,
} from '@inno/core';
import type { SendLeadMessageBody, SendLeadMessageResponse, SendLeadMessageWarning } from '@inno/contracts';
import { badRequest, conflict, notFound, rateLimited, upstreamError } from '@/lib/api-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { getEvolutionClient } from '@/lib/evolution';
import { haltCampaignsSoleInstanceDisconnected } from '@/lib/services/campaign-targets';
import { sendAlert } from '@/lib/alerts';
import { logger } from '@/lib/logger';

const APP_TIMEZONE = () => process.env.APP_TIMEZONE || DEFAULT_SEND_WINDOW_CONFIG.timezone;

/** Kill switch por falhas consecutivas de ENVIO (ARQUITETURA §4.9.5/§6.6, distinto do congelamento por taxa de resposta do §6.2). */
const CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD = 5;

/**
 * Teto explícito na transação de write-ahead (achado do Órion, revisão de
 * 2026-09-22) — sem isto, uma transação presa (lock/banco sob carga) podia
 * segurar a decisão do guard por tempo indefinido antes de `sendText`.
 * `maxWait`: quanto esperar por um "slot" de transação livre. `timeout`:
 * quanto a transação em si pode rodar. Os dois somados ficam dentro do teto
 * `MAX_DECISION_TO_SEND_MS` (5s, `@inno/core`), com margem para o resto do
 * trabalho síncrono da função.
 */
const WRITE_AHEAD_TRANSACTION_OPTIONS = { maxWait: 1_000, timeout: 3_000 } as const;

// ─────────────────────────────────────────────────────────────────────────
// Configuração — lida da env AQUI (a camada de serviço), nunca dentro de
// `@inno/core` (que fica puro/testável sem `process.env`, ver comentário em
// `packages/core/src/whatsapp/send-window.ts`).
// ─────────────────────────────────────────────────────────────────────────

/** Piso duro (G5) só pode ser ESTREITADO pela env (ARQUITETURA §10) — nunca alargado além de 08–20. */
function quietHoursFromEnv(): SendWindowConfig['quietHours'] {
  const base = DEFAULT_SEND_WINDOW_CONFIG.quietHours;
  const envStart = Number.parseInt(process.env.DISPATCH_QUIET_HOURS_START ?? '', 10);
  const envEnd = Number.parseInt(process.env.DISPATCH_QUIET_HOURS_END ?? '', 10);
  return {
    startHour: Number.isFinite(envStart) ? Math.max(envStart, base.startHour) : base.startHour,
    endHour: Number.isFinite(envEnd) ? Math.min(envEnd, base.endHour) : base.endHour,
  };
}

/** Janela comercial (G6, mole no manual) — configurável dentro do piso duro (ARQUITETURA §6.3). Pausa de almoço não tem env própria hoje (gap documentado, dívida pequena) — fica no padrão de `DEFAULT_SEND_WINDOW_CONFIG`. */
function businessWindowFromEnv(): SendWindowConfig['businessWindow'] {
  const base = DEFAULT_SEND_WINDOW_CONFIG.businessWindow;
  const envStart = Number.parseInt(process.env.DISPATCH_WINDOW_START ?? '', 10);
  const envEnd = Number.parseInt(process.env.DISPATCH_WINDOW_END ?? '', 10);
  return {
    startHour: Number.isFinite(envStart) ? envStart : base.startHour,
    endHour: Number.isFinite(envEnd) ? envEnd : base.endHour,
    lunchBreak: base.lunchBreak,
  };
}

function sendWindowConfigFromEnv(): SendWindowConfig {
  return {
    timezone: APP_TIMEZONE(),
    quietHours: quietHoursFromEnv(),
    businessWindow: businessWindowFromEnv(),
  };
}

function duplicateWindowMsFromEnv(): number {
  const seconds = Number.parseInt(process.env.MANUAL_SEND_DUPLICATE_WINDOW_S ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

function manualSendRatePerMinFromEnv(): number {
  const value = Number.parseInt(process.env.MANUAL_SEND_RATE_PER_MIN ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

/**
 * 🆕 Fase 4.C — Cooldown de 2º contato frio (G9b, ARQUITETURA §4.9.10/§10
 * `COLD_FOLLOWUP_COOLDOWN_H`). Sem esta leitura, `evaluateSendGuard` caía no
 * default de `@inno/core` (24h, igual) — mas silenciosamente, sem honrar o
 * env documentado, mesmo padrão dos outros `*FromEnv` deste arquivo.
 */
function coldFollowupCooldownMsFromEnv(): number {
  const hours = Number.parseInt(process.env.COLD_FOLLOWUP_COOLDOWN_H ?? '', 10);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_COLD_FOLLOWUP_COOLDOWN_MS;
}

/** 🆕 Fase 4.C — piso de 30s (`MIN_JITTER_FLOOR_SECONDS`) nunca contornável pela env, mesmo espírito de `quietHoursFromEnv` (ARQUITETURA §6.3: "configurável, mín. 30s"). */
function jitterRangeSecondsFromEnv(): JitterRangeSeconds {
  const base = DEFAULT_JITTER_RANGE_SECONDS;
  const envMin = Number.parseInt(process.env.DISPATCH_JITTER_MIN_S ?? '', 10);
  const envMax = Number.parseInt(process.env.DISPATCH_JITTER_MAX_S ?? '', 10);
  const minSeconds = Number.isFinite(envMin) ? Math.max(envMin, MIN_JITTER_FLOOR_SECONDS) : base.minSeconds;
  const maxSeconds = Number.isFinite(envMax) && envMax > minSeconds ? envMax : base.maxSeconds;
  return { minSeconds, maxSeconds };
}

/** 🆕 Fase 4.C — `DISPATCH_MICRO_PAUSE_*` (ARQUITETURA §10). Valor inválido/fora de ordem cai no default de `@inno/core`, nunca em NaN silencioso. */
function microPauseConfigFromEnv(): MicroPauseConfig {
  const base = DEFAULT_MICRO_PAUSE_CONFIG;
  const envEveryMin = Number.parseInt(process.env.DISPATCH_MICRO_PAUSE_EVERY_MIN ?? '', 10);
  const envEveryMax = Number.parseInt(process.env.DISPATCH_MICRO_PAUSE_EVERY_MAX ?? '', 10);
  const envPauseMin = Number.parseInt(process.env.DISPATCH_MICRO_PAUSE_MIN_S ?? '', 10);
  const envPauseMax = Number.parseInt(process.env.DISPATCH_MICRO_PAUSE_MAX_S ?? '', 10);

  const everyMin = Number.isFinite(envEveryMin) && envEveryMin > 0 ? envEveryMin : base.everyMin;
  const everyMax = Number.isFinite(envEveryMax) && envEveryMax >= everyMin ? envEveryMax : base.everyMax;
  const pauseMinSeconds = Number.isFinite(envPauseMin) && envPauseMin > 0 ? envPauseMin : base.pauseMinSeconds;
  const pauseMaxSeconds = Number.isFinite(envPauseMax) && envPauseMax >= pauseMinSeconds ? envPauseMax : base.pauseMaxSeconds;

  return { everyMin, everyMax, pauseMinSeconds, pauseMaxSeconds };
}

/**
 * Campos de `WhatsAppInstance` que TODO envio (sucesso, falha confirmada OU
 * incerto — ARQUITETURA §6.8.7 "depois de TODO envio") escreve para avançar a
 * cadência, computados PURAMENTE a partir do `AdvanceSendPaceResult`
 * (`@inno/core`), sem 2ª leitura de banco.
 *
 * ⚠️ `sendsSinceMicroPause` usa `{ increment: 1 }` — NUNCA o valor absoluto
 * que `advanceSendPace` calculou — para o incremento em si continuar atômico
 * no Postgres mesmo se a leitura que alimentou `advanceSendPace` (feita ao
 * resolver a instância, antes do `sendText`) já estivesse um passo atrás de
 * outra escrita concorrente (ver memória do Cronos,
 * `gate-nullable-e-contadores-concorrentes`: "sempre incremento atômico em
 * SQL, nunca read-modify-write em JS"). Só a DECISÃO de disparar a
 * micro-pausa (o sorteio em `shouldTriggerMicroPause`) pode ficar levemente
 * desatualizada sob concorrência real — nunca o contador persistido, que
 * nunca perde um incremento. Reset para `0` (micro-pausa disparou) é SET
 * incondicional, sem essa janela.
 */
function paceFieldsForUpdate(
  mode: PaceAdvanceMode,
  result: AdvanceSendPaceResult,
): Pick<Prisma.WhatsAppInstanceUpdateInput, 'nextSendAllowedAt' | 'sendsSinceMicroPause'> {
  if (mode === 'floor') {
    // Resposta a conversa aberta (`ignorePaceLock` honrado) não toca o
    // contador de micro-pausa — decisão da Fase 4.B, `packages/core/whatsapp/jitter.ts`.
    return { nextSendAllowedAt: result.nextSendAllowedAt };
  }
  return {
    nextSendAllowedAt: result.nextSendAllowedAt,
    sendsSinceMicroPause: result.microPauseTriggered ? 0 : { increment: 1 },
  };
}

/** Mesma granularidade de `InstanceDailyStat.date` (`@db.Date`, fuso `APP_TIMEZONE`). Duplicado de propósito de `lib/services/whatsapp-instances.ts#todayDateKey` — mesma regra de "duplicar em vez de importar entre módulos de serviço não relacionados" já usada no monorepo (ver `convention-api-routes-fase1`, regra 4). */
function todayDateKey(): Date {
  const tz = APP_TIMEZONE();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${ymd}T00:00:00.000Z`);
}

function localDateKeyString(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ─────────────────────────────────────────────────────────────────────────
// G2 — payload (Zod já validou forma; aqui a regra de negócio + `reason`)
// ─────────────────────────────────────────────────────────────────────────

function validatePayloadShape(body: SendLeadMessageBody): { templateId: string } | { rawBody: string } {
  const hasTemplate = Boolean(body.templateId);
  const hasBody = Boolean(body.body && body.body.length > 0);

  if (hasTemplate === hasBody) {
    badRequest(
      'Informe exatamente um entre "templateId" e "body".',
      [{ path: 'templateId', message: 'Informe templateId OU body, nunca os dois nem nenhum.' }],
      'BODY_OR_TEMPLATE_REQUIRED',
    );
  }
  if (hasBody && body.body!.length > 4000) {
    badRequest('O texto da mensagem excede o limite de 4000 caracteres.', [{ path: 'body', message: 'Máximo de 4000 caracteres.' }], 'BODY_TOO_LONG');
  }
  return hasTemplate ? { templateId: body.templateId! } : { rawBody: body.body!.trim() };
}

/** Revalidação defensiva do corpo do template no momento do envio (ele já foi validado na criação/edição — `templates.ts#validateBody` — mas um template inválido não deveria conseguir enviar de qualquer forma). */
function validateTemplateBodyOrThrow(templateBody: string): void {
  const variableCheck = validateTemplateVariables(templateBody);
  if (!variableCheck.valid) {
    badRequest(
      `Este template usa variável(is) desconhecida(s): ${variableCheck.unknownVariables.join(', ')}.`,
      variableCheck.unknownVariables.map((v) => ({ path: 'templateId', message: `Variável desconhecida: {{${v}}}` })),
      'UNKNOWN_VARIABLE',
    );
  }
  const spintaxCheck = parseSpintax(templateBody);
  if (!spintaxCheck.valid) {
    badRequest(`Sintaxe de spintax inválida no template: ${spintaxCheck.error.message}`, [{ path: 'templateId', message: spintaxCheck.error.message }], 'INVALID_SPINTAX');
  }
}

/** Valores de variável a partir do Lead — duplicado de propósito de `templates.ts#buildLeadPreviewValues` (mesmo princípio da regra 4 de `convention-api-routes-fase1`: módulos de serviço não importam função privada um do outro). */
function buildLeadTemplateValues(lead: Lead & { city: { name: string } | null }): TemplateVariableValues {
  return {
    nome: lead.name,
    primeiro_nome: firstName(lead.name),
    cidade: lead.city?.name,
    uf: lead.uf,
    categoria: lead.category ?? undefined,
    site: lead.website ?? undefined,
    telefone: lead.phoneE164 ?? undefined,
    // `minha_empresa` — dívida D9 (ARQUITETURA §9.2): lido de env, sem model
    // de configuração. Sem ele, `renderTemplate` produz string vazia, e G10
    // (`hasCompanyNameMention`) bloqueia com `409 MISSING_COMPANY_NAME` no
    // primeiro contato frio — comportamento correto, não um bug.
    minha_empresa: process.env.APP_COMPANY_NAME || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Resolução de instância (ARQUITETURA §4.9.4 — afinidade → maior cota → nenhuma elegível)
// ─────────────────────────────────────────────────────────────────────────

type InstanceCandidate = { instance: WhatsAppInstance; sentToday: number; dailyLimit: number; remaining: number };

async function loadInstanceCandidates(): Promise<InstanceCandidate[]> {
  const instances = await prisma.whatsAppInstance.findMany();
  if (instances.length === 0) return [];

  const today = todayDateKey();
  const stats = await prisma.instanceDailyStat.findMany({
    where: { instanceId: { in: instances.map((i) => i.id) }, date: today },
  });
  const statByInstance = new Map(stats.map((s) => [s.instanceId, s.sentCount]));

  return instances.map((instance) => {
    const dailyLimit = effectiveDailyLimit(instance.warmupDay, instance.dailyLimitOverride);
    const sentToday = statByInstance.get(instance.id) ?? 0;
    return { instance, sentToday, dailyLimit, remaining: dailyLimit - sentToday };
  });
}

function describeInstanceUnavailability(candidate: InstanceCandidate): string {
  if (candidate.instance.status !== 'connected') {
    return `${candidate.instance.name}: não está conectada (status: ${candidate.instance.status}).`;
  }
  return `${candidate.instance.name}: cota diária esgotada (${candidate.sentToday}/${candidate.dailyLimit}).`;
}

async function resolveInstanceForSend(leadId: string, requestedInstanceId: string | undefined): Promise<InstanceCandidate> {
  if (requestedInstanceId) {
    const instance = await prisma.whatsAppInstance.findUnique({ where: { id: requestedInstanceId } });
    if (!instance) notFound('Instância de WhatsApp não encontrada.', 'INSTANCE_NOT_FOUND');
    const today = todayDateKey();
    const stat = await prisma.instanceDailyStat.findUnique({ where: { instanceId_date: { instanceId: instance.id, date: today } } });
    const dailyLimit = effectiveDailyLimit(instance.warmupDay, instance.dailyLimitOverride);
    const sentToday = stat?.sentCount ?? 0;
    return { instance, sentToday, dailyLimit, remaining: dailyLimit - sentToday };
  }

  const [lastMessageWithInstance, allCandidates] = await Promise.all([
    prisma.message.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' }, select: { instanceId: true } }),
    loadInstanceCandidates(),
  ]);

  const eligible = allCandidates.filter((c) => c.instance.status === 'connected' && c.remaining > 0);

  if (eligible.length === 0) {
    conflict(
      'Nenhuma instância de WhatsApp conectada e com cota disponível para enviar agora.',
      allCandidates.map((c) => ({ path: c.instance.id, message: describeInstanceUnavailability(c) })),
      'INSTANCE_NOT_CONNECTED',
    );
  }

  // Afinidade lead→instância (ARQUITETURA §4.9.4/§6.5): mesma instância da
  // última mensagem (qualquer direção), SE ainda estiver elegível.
  if (lastMessageWithInstance?.instanceId) {
    const affinity = eligible.find((c) => c.instance.id === lastMessageWithInstance.instanceId);
    if (affinity) return affinity;
  }

  eligible.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return Number(a.instance.isDegraded) - Number(b.instance.isDegraded);
  });
  return eligible[0]!;
}

// ─────────────────────────────────────────────────────────────────────────
// Mapa de erro da Evolution → resposta + efeito colateral (ARQUITETURA §4.9.5 — MessagingErrorCode já existe em packages/messaging, não inventar vocabulário novo)
// ─────────────────────────────────────────────────────────────────────────

type EvolutionErrorEffect = {
  httpStatus: 409 | 502;
  reason: string;
  /**
   * `'uncertain'` (achado do Órion, revisão de 2026-09-22) — a Evolution
   * pode ter recebido e processado o envio ANTES do erro chegar até nós
   * (timeout nosso, ou 5xx que só aparece depois de processar). Só se
   * aplica a `TIMEOUT`/`TRANSIENT_ERROR`: os outros códigos (4xx que a
   * Evolution devolve ANTES de sequer tentar enviar — instância
   * desconectada, número inválido, auth, rate limit) são `'failed'` de
   * verdade, com compensação de cota normal.
   */
  outcome: 'failed' | 'uncertain';
  /** `false` para `INVALID_NUMBER`/`AUTH_ERROR` (ARQUITETURA §4.9.5: "não é falha da instância"/"erro de configuração nossa") e para `outcome:'uncertain'` (não é uma falha CONFIRMADA da instância). */
  incrementConsecutiveFailures: boolean;
  /** `true` só para `INSTANCE_DISCONNECTED`/`INSTANCE_NOT_FOUND` — a instância "sumiu" do lado da Evolution. */
  disconnectInstance: boolean;
};

const EVOLUTION_ERROR_EFFECT: Record<MessagingErrorCode, EvolutionErrorEffect> = {
  INSTANCE_DISCONNECTED: { httpStatus: 409, reason: 'INSTANCE_NOT_CONNECTED', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: true },
  INSTANCE_NOT_FOUND: { httpStatus: 409, reason: 'INSTANCE_MISSING_UPSTREAM', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: true },
  INVALID_NUMBER: { httpStatus: 409, reason: 'NUMBER_HAS_NO_WHATSAPP', outcome: 'failed', incrementConsecutiveFailures: false, disconnectInstance: false },
  AUTH_ERROR: { httpStatus: 502, reason: 'EVOLUTION_AUTH', outcome: 'failed', incrementConsecutiveFailures: false, disconnectInstance: false },
  RATE_LIMITED: { httpStatus: 502, reason: 'EVOLUTION_RATE_LIMITED', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
  // ⚠️ TRANSIENT_ERROR/TIMEOUT são 'uncertain', não 'failed' — ver comentário
  // do type acima e o handoff do Órion (2026-09-22). `sendText` roda com
  // `retryable: false` (packages/messaging) exatamente por isto: nunca
  // reenviamos automaticamente um desses dois, então o único jeito de saber
  // se saiu é o operador checar a conversa ou esperar o webhook de status.
  TRANSIENT_ERROR: { httpStatus: 502, reason: 'EVOLUTION_SEND_UNCERTAIN', outcome: 'uncertain', incrementConsecutiveFailures: false, disconnectInstance: false },
  TIMEOUT: { httpStatus: 502, reason: 'EVOLUTION_SEND_UNCERTAIN', outcome: 'uncertain', incrementConsecutiveFailures: false, disconnectInstance: false },
  VALIDATION_ERROR: { httpStatus: 502, reason: 'EVOLUTION_UNKNOWN', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
  UNKNOWN: { httpStatus: 502, reason: 'EVOLUTION_UNKNOWN', outcome: 'failed', incrementConsecutiveFailures: true, disconnectInstance: false },
};

/**
 * Transação 2b — CONFIRMADA falha (ARQUITETURA §4.9.5): compensa a reserva
 * do write-ahead por completo (sentCount volta, failedCount sobe) porque
 * sabemos que a mensagem NÃO saiu (a Evolution rejeitou antes de processar).
 *
 * `previousStatus`/`instanceName` (capturados em `sendLeadMessage` ANTES da
 * tentativa de envio, via `candidate.instance`) evitam alertar
 * `instance_disconnected` de novo quando a instância JÁ estava desconectada
 * — mesmo cuidado do webhook (`webhook.ts#handleConnectionUpdate`). Na
 * prática, o G7 do guard (`evaluateSendGuard`, `@inno/core`) já bloqueia com
 * `409 INSTANCE_NOT_CONNECTED` qualquer tentativa SEQUENCIAL contra uma
 * instância que já está `disconnected` no banco (nunca chega a `sendText`
 * nem a esta função) — então esta checagem é defesa de segunda linha para a
 * corrida entre 2 requisições CONCORRENTES que leram `status: 'connected'`
 * antes de qualquer uma das duas commitar a mudança (não elimina o duplo
 * alerta nesse caso raro, só reduz a janela).
 */
async function recordSendFailure(
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    instanceId: string;
    instanceName: string | null;
    instanceDate: Date;
    effect: EvolutionErrorEffect;
    errorMessage: string;
    previousStatus: string;
    /** 🆕 Fase 4.C — a cadência avança mesmo em falha CONFIRMADA (§6.8.7: "depois de TODO envio"). */
    paceUpdate: Pick<Prisma.WhatsAppInstanceUpdateInput, 'nextSendAllowedAt' | 'sendsSinceMicroPause'>;
  },
): Promise<void> {
  const { messageId, instanceId, instanceName, instanceDate, effect, errorMessage, previousStatus, paceUpdate } = params;

  await tx.message.update({
    where: { id: messageId },
    data: { status: 'failed', errorCode: effect.reason, errorMessage },
  });

  await tx.instanceDailyStat.update({
    where: { instanceId_date: { instanceId, date: instanceDate } },
    data: { sentCount: { decrement: 1 }, failedCount: { increment: 1 } },
  });

  // ⚠️ Este `update` roda SEMPRE agora (antes só rodava quando a falha
  // afetava `consecutiveFailures`/`status`) — a cadência (`paceUpdate`)
  // precisa avançar em toda falha confirmada, não só nas que punem a
  // instância. `consecutiveFailures`/desconexão continuam condicionais.
  const updated = await tx.whatsAppInstance.update({
    where: { id: instanceId },
    data: {
      ...paceUpdate,
      ...(effect.incrementConsecutiveFailures ? { consecutiveFailures: { increment: 1 } } : {}),
      ...(effect.disconnectInstance
        ? { status: 'disconnected', lastErrorAt: new Date(), lastErrorMessage: errorMessage }
        : {}),
    },
  });

  if (effect.incrementConsecutiveFailures || effect.disconnectInstance) {
    if (effect.incrementConsecutiveFailures && updated.consecutiveFailures >= CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD && !updated.isDegraded) {
      await tx.whatsAppInstance.update({ where: { id: instanceId }, data: { isDegraded: true } });
      void sendAlert({
        kind: 'instance_degraded',
        instanceId,
        instanceName,
        consecutiveFailures: updated.consecutiveFailures,
        threshold: CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD,
      });
    }

    if (effect.disconnectInstance) {
      // Mensagem PRÓPRIA (`effect.reason`, vocabulário fechado nosso — nunca
      // `errorMessage` cru da Evolution, ver regra 4 em `lib/alerts.ts`).
      if (previousStatus !== 'disconnected') {
        void sendAlert({
          kind: 'instance_disconnected',
          instanceId,
          instanceName,
          reason: 'disconnected',
          message: `Instância desconectada durante uma tentativa de envio (código: ${effect.reason}).`,
        });
      }
      await haltCampaignsSoleInstanceDisconnected(tx, instanceId, `Instância desconectada durante envio manual: ${errorMessage}`);
    }
  }

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({
      data: {
        leadId: message.leadId,
        type: 'message_failed',
        payload: { messageId, errorCode: effect.reason, errorMessage },
        actor: 'system',
      },
    });
  }
}

/**
 * Transação 2b — resultado INCERTO (achado do Órion, revisão de
 * 2026-09-22): `TIMEOUT`/`TRANSIENT_ERROR` no envio não garantem que a
 * mensagem não saiu. Por isso, ao contrário de `recordSendFailure`:
 *   - NÃO decrementa `sentCount` — a cota fica debitada como se tivesse
 *     saído, porque PODE ter saído (§4.9.5: "a cota erra sempre para menos,
 *     nunca para mais" — aqui o mesmo princípio vira "nunca devolve cota que
 *     talvez tenha sido gasta de verdade").
 *   - NÃO incrementa `failedCount` (não é uma falha confirmada) nem
 *     `consecutiveFailures`/`isDegraded` da instância (puniria a instância
 *     por um problema que pode ter sido só lentidão de rede).
 *   - `Message.status` vira `failed` (o enum não tem um valor "incerto" —
 *     `packages/db` é território do Cronos, não alterei o schema; relatado
 *     no handoff) mas `errorCode='EVOLUTION_SEND_UNCERTAIN'` e a mensagem
 *     deixam explícito que o resultado é desconhecido, não uma rejeição.
 */
async function recordSendUncertain(
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    instanceId: string;
    effect: EvolutionErrorEffect;
    errorMessage: string;
    /** 🆕 Fase 4.C — a cadência avança mesmo em resultado incerto (§6.8.7: "depois de TODO envio", é o caso mais importante — a mensagem pode ter saído). */
    paceUpdate: Pick<Prisma.WhatsAppInstanceUpdateInput, 'nextSendAllowedAt' | 'sendsSinceMicroPause'>;
  },
): Promise<void> {
  const { messageId, instanceId, effect, errorMessage, paceUpdate } = params;
  const humanMessage = `Resultado incerto — a mensagem PODE ter sido entregue antes da falha de comunicação. Verifique a conversa antes de reenviar. (${errorMessage})`;

  await tx.message.update({
    where: { id: messageId },
    data: { status: 'failed', errorCode: effect.reason, errorMessage: humanMessage },
  });

  // 🆕 Fase 4.C — `consecutiveUncertain` (distinto de `consecutiveFailures`,
  // ver comentário do campo no schema) sobe em incerto e só zera em SUCESSO
  // confirmado — nunca em falha confirmada normal. Junto com `paceUpdate`
  // porque os dois são o mesmo `update` na mesma linha (Cronos: "incremento
  // atômico, nunca read-modify-write em JS").
  await tx.whatsAppInstance.update({
    where: { id: instanceId },
    data: { ...paceUpdate, consecutiveUncertain: { increment: 1 } },
  });

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({
      data: {
        leadId: message.leadId,
        type: 'message_uncertain',
        payload: { messageId, errorCode: effect.reason, errorMessage },
        actor: 'system',
      },
    });
  }
}

/**
 * Desfaz a reserva do write-ahead quando a decisão do guard expirou ANTES
 * de `sendText` ser chamado (achado do Órion, revisão de 2026-09-22) — ao
 * contrário de `recordSendUncertain`, aqui a compensação é COMPLETA (igual a
 * `recordSendFailure`): sabemos com certeza que nada foi enviado, porque
 * `sendText` nunca chegou a ser chamado. Não conta como falha de ENVIO
 * (não houve tentativa de envio) — só desfaz a reserva de cota.
 */
async function revertExpiredReservation(
  tx: Prisma.TransactionClient,
  params: { messageId: string; instanceId: string; instanceDate: Date },
): Promise<void> {
  const { messageId, instanceId, instanceDate } = params;
  const errorMessage = 'A decisão de envio expirou antes de a mensagem ser efetivamente enviada (write-ahead demorou demais).';

  await tx.message.update({
    where: { id: messageId },
    data: { status: 'failed', errorCode: 'SEND_WINDOW_EXPIRED', errorMessage },
  });
  await tx.instanceDailyStat.update({
    where: { instanceId_date: { instanceId, date: instanceDate } },
    data: { sentCount: { decrement: 1 } },
  });

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({
      data: { leadId: message.leadId, type: 'message_send_expired', payload: { messageId }, actor: 'system' },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Ponto de entrada
// ─────────────────────────────────────────────────────────────────────────

export async function sendLeadMessage(
  leadId: string,
  input: SendLeadMessageBody,
  actor: { id: string; role: string },
): Promise<SendLeadMessageResponse> {
  // Rate limit por USUÁRIO (ARQUITETURA §10 `MANUAL_SEND_RATE_PER_MIN`) — antes
  // de qualquer leitura de banco, mesmo espírito do rate limit por IP do
  // `apiRoute` (`lib/rate-limit.ts`), mas aqui a chave é o operador logado,
  // não o IP (rota autenticada).
  const rateLimit = checkRateLimit(`manual-send:${actor.id}`, 60_000, manualSendRatePerMinFromEnv());
  if (!rateLimit.allowed) {
    rateLimited('Muitos envios em pouco tempo. Aguarde um instante e tente novamente.', 'MANUAL_SEND_RATE_LIMIT');
  }

  // G2 — payload (forma já validada por Zod; aqui a regra "exatamente um" + reason)
  const payloadChoice = validatePayloadShape(input);

  // G1 — lead existe
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { city: { select: { name: true } } } });
  if (!lead) notFound('Lead não encontrado.', 'LEAD_NOT_FOUND');

  // G3 — lead tem telefone
  if (!lead.phoneE164) {
    conflict('Este lead não tem um telefone válido cadastrado.', undefined, 'LEAD_HAS_NO_PHONE');
  }
  const phoneE164 = lead.phoneE164;

  // Monta o texto final ANTES de resolver instância/quota — é só CPU (render + spintax), não conta como I/O relevante ao invariante de opt-out.
  let finalText: string;
  let renderedFrom: SendLeadMessageResponse['renderedFrom'] = null;

  if ('templateId' in payloadChoice) {
    const template = await prisma.messageTemplate.findUnique({ where: { id: payloadChoice.templateId } });
    if (!template) notFound('Template não encontrado.');
    validateTemplateBodyOrThrow(template.body);

    const values = buildLeadTemplateValues(lead);
    const timezone = APP_TIMEZONE();
    const spintaxSeed = input.spintaxSeed ?? `${lead.id}:${template.id}:${localDateKeyString(new Date(), timezone)}`;
    const rendered = renderTemplate(template.body, values);
    finalText = resolveSpintax(rendered, { seed: spintaxSeed });
    renderedFrom = { templateId: template.id, spintaxSeed };
  } else {
    // `body` cru — NÃO passa por render de variáveis (ARQUITETURA §4.9.4: "existe para o operador responder uma conversa").
    finalText = payloadChoice.rawBody;
  }

  // G4/G7/G8 — dados de telefone/instância/cota
  const phoneType = lead.phoneType;
  const candidate = await resolveInstanceForSend(lead.id, input.instanceId);
  const { instance } = candidate;

  // G9 — última mensagem de saída (qualquer instância) + G10 — 1º contato
  // frio + 🆕 Fase 4.C — última mensagem de ENTRADA (G9b/`lastInboundAt`).
  // Em `Promise.all` (não em série) — ainda estamos ANTES da leitura de
  // opt-out, então não quebra o invariante "nenhum `await` entre a consulta
  // de opt-out e `evaluateSendGuard`" (esse invariante é só sobre o QUE VEM
  // DEPOIS do opt-out, não sobre tudo que vem antes).
  const [lastOutbound, lastInbound] = await Promise.all([
    prisma.message.findFirst({
      where: { leadId: lead.id, direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      where: { leadId: lead.id, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const isColdFirstContact = lastOutbound === null;

  // G11 — ⚠️ ÚLTIMA leitura de banco antes da decisão. Nenhum `await` entre
  // esta linha e a chamada de `evaluateSendGuard` abaixo.
  const optOutRow = await prisma.optOut.findUnique({ where: { phoneE164 } });
  const guardNow = new Date();
  const coldFollowupCooldownMs = coldFollowupCooldownMsFromEnv();

  const facts: SendGuardFacts = {
    now: guardNow,
    phone: { e164: phoneE164, type: phoneType },
    instance: {
      status: instance.status,
      isDegraded: instance.isDegraded,
      warmupDay: instance.warmupDay,
      dailyLimitOverride: instance.dailyLimitOverride,
      // 🆕 Fase 4.C (G9c) — SEMPRE `null` explícito quando não há gate ainda,
      // NUNCA omitido: campo omitido (`undefined`) deixaria G9c inerte (é a
      // semântica de "chamador não ligado" documentada em `send-guard.ts`) —
      // exatamente a armadilha registrada na memória desta rodada anterior.
      nextSendAllowedAt: instance.nextSendAllowedAt ?? null,
    },
    quota: { sentToday: candidate.sentToday },
    optOut: { exists: optOutRow !== null, checkedAt: guardNow },
    lastOutboundAt: lastOutbound?.createdAt ?? null,
    // 🆕 Fase 4.C (G9b) — mesmo cuidado: `null` explícito, nunca omitido.
    lastInboundAt: lastInbound?.createdAt ?? null,
    isColdFirstContact,
    text: finalText,
    companyName: process.env.APP_COMPANY_NAME || null,
    overrides: {
      allowNonMobile: input.allowNonMobile,
      confirmOutsideBusinessWindow: input.confirmOutsideBusinessWindow,
      // 🆕 Fase 4.C — decisão registrada no handoff do Vega: o envio MANUAL é
      // sempre um humano na tela, então este serviço sempre PEDE o desvio.
      // Quem decide se ele VALE é só o guard (G9c em `send-guard.ts`), que o
      // anula sempre que `isColdFirstContact === true` — por isso é seguro
      // pedir incondicionalmente aqui: 1º contato frio continua travado
      // (o motor e o manual usam a MESMA trava), e só a resposta a uma
      // conversa já aberta de fato passa direto.
      ignorePaceLock: true,
    },
  };

  const verdict = evaluateSendGuard(facts, {
    windowConfig: sendWindowConfigFromEnv(),
    duplicateWindowMs: duplicateWindowMsFromEnv(),
    coldFollowupCooldownMs,
  });

  if (!verdict.allow) {
    throwForBlockedVerdict(verdict, { optOutCreatedAt: optOutRow?.createdAt ?? null, timezone: APP_TIMEZONE(), coldFollowupCooldownMs });
  }

  // 🆕 Fase 4.C — se o guard de fato honrou `ignorePaceLock` (warning
  // `PACE_LOCK_BYPASSED_FOR_REPLY`), o avanço da cadência usa o modo
  // `'floor'` (só o piso do jitter, sem tocar a micro-pausa — ARQUITETURA
  // §4.9.10, tabela "as duas cadências"). Fora desse caso (envio normal,
  // seja 1º contato frio ou resposta que não bateu no gate), é `'full'`.
  const paceMode: PaceAdvanceMode = verdict.warnings.some((w) => w.code === 'PACE_LOCK_BYPASSED_FOR_REPLY') ? 'floor' : 'full';
  const jitterRangeSeconds = jitterRangeSecondsFromEnv();
  const microPauseConfig = microPauseConfigFromEnv();

  // ── Write-ahead (ARQUITETURA §4.9.5, transação 1) — a ÚNICA escrita entre o guard e a rede. ──
  // `timeout`/`maxWait` explícitos (achado do Órion, revisão de 2026-09-22):
  // se o banco estiver sob carga/lock, a transação falha rápido em vez de
  // segurar a decisão do guard por tempo indefinido — é o que sustenta o
  // teto abaixo (`MAX_DECISION_TO_SEND_MS`) ter margem real para agir.
  const today = todayDateKey();
  const reservedMessage = await prisma.$transaction(
    async (tx) => {
      const created = await tx.message.create({
        data: { leadId: lead.id, instanceId: instance.id, direction: 'outbound', body: finalText, status: 'queued' },
      });
      await tx.instanceDailyStat.upsert({
        where: { instanceId_date: { instanceId: instance.id, date: today } },
        create: { instanceId: instance.id, date: today, sentCount: 1 },
        update: { sentCount: { increment: 1 } },
      });
      return created;
    },
    WRITE_AHEAD_TRANSACTION_OPTIONS,
  );

  // ⚠️ Teto entre a decisão (`guardNow`) e o envio real (achado do Órion,
  // revisão de 2026-09-22): mede-se AQUI, imediatamente antes de `sendText`,
  // depois do write-ahead — não antes. Se o write-ahead atrasou (lock, banco
  // sob carga) e a decisão já passou do teto, falha FECHADO: desfaz a
  // reserva (devolve a cota por completo — aqui SABEMOS que nada foi
  // enviado, `sendText` nem foi chamado) e devolve um erro retentável. Isto
  // NÃO é uma segunda leitura de opt-out nem um novo `evaluateSendGuard` —
  // é só um relógio, sem I/O — então não quebra o invariante de "nenhuma
  // leitura entre a decisão e `sendText`" que o Órion audita.
  const decisionAgeMs = Date.now() - guardNow.getTime();
  if (decisionAgeMs > MAX_DECISION_TO_SEND_MS) {
    await prisma.$transaction((tx) => revertExpiredReservation(tx, { messageId: reservedMessage.id, instanceId: instance.id, instanceDate: today }));
    logger.warn('sendLeadMessage: decisão expirou antes do envio (write-ahead demorou demais)', {
      leadId: lead.id,
      instanceId: instance.id,
      decisionAgeMs,
    });
    conflict('O sistema demorou para processar o envio e a decisão anterior expirou. Tente novamente.', undefined, 'SEND_WINDOW_EXPIRED');
  }

  let sentAt: Date;
  let providerMessageId: string;
  try {
    // ⚠️ ÚNICO call site de produção de `sendText` para mensagem de lead
    // (ARQUITETURA §4.9.9 item 5 — Órion audita com `grep -rn "sendText(" apps/ packages/`).
    const sendResult = await getEvolutionClient().sendText(instance.evolutionInstanceName, { to: phoneE164, text: finalText });
    providerMessageId = sendResult.providerMessageId;
    sentAt = new Date();
  } catch (err) {
    // 🆕 Fase 4.C — a cadência avança para falha CONFIRMADA e para resultado
    // INCERTO igual (ARQUITETURA §6.8.7: "depois de TODO envio, sucesso,
    // falha ou incerto") — só NÃO avança quando `sendText` nem chegou a ser
    // chamado (ex.: `SEND_WINDOW_EXPIRED` acima, antes deste `try`).
    const paceResult = advanceSendPace({
      now: new Date(),
      sendsSinceMicroPause: instance.sendsSinceMicroPause,
      mode: paceMode,
      jitterRangeSeconds,
      microPause: microPauseConfig,
    });
    await handleSendFailure(err, {
      messageId: reservedMessage.id,
      instanceId: instance.id,
      instanceName: instance.name,
      instanceDate: today,
      previousStatus: instance.status,
      paceUpdate: paceFieldsForUpdate(paceMode, paceResult),
    });
    throw mapSendErrorToApiError(err);
  }

  // 🆕 Fase 4.C — cadência avança também no SUCESSO, com `sentAt` (o instante
  // real do envio) em vez de `new Date()` de novo.
  const paceResult = advanceSendPace({
    now: sentAt,
    sendsSinceMicroPause: instance.sendsSinceMicroPause,
    mode: paceMode,
    jitterRangeSeconds,
    microPause: microPauseConfig,
  });

  // ── Transação 2a (sucesso, ARQUITETURA §4.9.5) ──
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: reservedMessage.id }, data: { status: 'sent', providerMessageId, sentAt } });
    await tx.whatsAppInstance.update({
      where: { id: instance.id },
      // `consecutiveUncertain: 0` — zerado por SUCESSO confirmado (comentário
      // do campo no schema); `consecutiveFailures: 0` já existia antes desta
      // rodada.
      data: { consecutiveFailures: 0, consecutiveUncertain: 0, ...paceFieldsForUpdate(paceMode, paceResult) },
    });
    await advanceLeadToContacted(tx, lead.id, lead.status);
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'message_sent',
        payload: {
          messageId: reservedMessage.id,
          instanceId: instance.id,
          templateId: renderedFrom?.templateId ?? null,
          confirmOutsideBusinessWindow: input.confirmOutsideBusinessWindow,
          allowNonMobile: input.allowNonMobile,
        },
        actor: 'user',
        actorUserId: actor.id,
      },
    });
  });

  // Observabilidade mínima da cadência (ARQUITETURA §6.8.8) — nunca dado
  // sensível, só o que explica um gap grande na timeline do número.
  logger.info('mensagem enviada', {
    leadId: lead.id,
    instanceId: instance.id,
    messageId: reservedMessage.id,
    isColdFirstContact,
    paceMode,
    jitterMs: paceResult.jitterMs,
    microPauseTriggered: paceResult.microPauseTriggered,
    nextSendAllowedAt: paceResult.nextSendAllowedAt.toISOString(),
  });

  const dailyLimitAfter = candidate.dailyLimit;
  const sentTodayAfter = candidate.sentToday + 1;

  return {
    message: {
      id: reservedMessage.id,
      leadId: lead.id,
      campaignTargetId: null,
      instanceId: instance.id,
      direction: 'outbound',
      body: finalText,
      providerMessageId,
      status: 'sent',
      errorCode: null,
      sentAt: sentAt.toISOString(),
      deliveredAt: null,
      readAt: null,
    },
    instance: {
      id: instance.id,
      name: instance.name,
      phoneNumber: instance.phoneNumber,
      health: deriveInstanceHealth({ status: instance.status, isDegraded: instance.isDegraded, warmupDay: instance.warmupDay }),
    },
    quota: {
      warmupDay: instance.warmupDay,
      isWarm: isWarmupDayWarm(instance.warmupDay),
      dailyLimit: dailyLimitAfter,
      sentToday: sentTodayAfter,
      remaining: Math.max(0, dailyLimitAfter - sentTodayAfter),
    },
    renderedFrom,
    warnings: verdict.warnings as SendLeadMessageWarning[],
  };
}

/**
 * Avança `Lead.status` até `contacted` (ARQUITETURA §4.9.5). A FSM
 * (`checkStatusTransition`, `@inno/core`) só aceita passos sequenciais —
 * `new` precisa passar por `validated` antes de chegar a `contacted` — por
 * isso o laço, em vez de um `update` direto para `contacted`.
 */
async function advanceLeadToContacted(tx: Prisma.TransactionClient, leadId: string, currentStatus: LeadStatus): Promise<void> {
  const steps: LeadStatus[] = currentStatus === 'new' ? ['validated', 'contacted'] : currentStatus === 'validated' ? ['contacted'] : [];
  let from = currentStatus;
  for (const to of steps) {
    if (!checkStatusTransition(from, to, 'system').allowed) return; // defensivo — não deveria acontecer dado o `steps` acima
    await tx.lead.update({ where: { id: leadId }, data: { status: to } });
    from = to;
  }
}

function throwForBlockedVerdict(
  verdict: Extract<SendGuardVerdict, { allow: false }>,
  ctx: { optOutCreatedAt: Date | null; timezone: string; coldFollowupCooldownMs: number },
): never {
  const { reason, message, meta } = verdict;

  if (reason === 'OPTED_OUT') {
    conflict(message, ctx.optOutCreatedAt ? [{ path: 'optedOutAt', message: ctx.optOutCreatedAt.toISOString() }] : undefined, reason);
  }
  if (reason === 'DAILY_LIMIT_REACHED') {
    conflict(message, [{ path: 'resetsAt', message: nextLocalMidnight(new Date(), ctx.timezone).toISOString() }], reason);
  }
  if ((reason === 'QUIET_HOURS' || reason === 'OUTSIDE_BUSINESS_WINDOW') && meta?.nextWindowOpensAt) {
    conflict(message, [{ path: 'nextWindowOpensAt', message: String(meta.nextWindowOpensAt) }], reason);
  }
  // 🆕 Fase 4.C — requisito de produto do dono: quem bate no gate precisa
  // saber QUANDO pode enviar de novo, não só que está bloqueado. O guard já
  // devolve `nextSendAllowedAt` em `meta` (ISO) — só repassamos para
  // `details[]`, mesma convenção "path = nome do campo, message = valor ISO"
  // que `nextWindowOpensAt`/`resetsAt` já usam acima (ver `common.ts`).
  if (reason === 'SEND_PACE_LOCKED' && meta?.nextSendAllowedAt) {
    conflict(message, [{ path: 'nextSendAllowedAt', message: String(meta.nextSendAllowedAt) }], reason);
  }
  // 🆕 Fase 4.C — mesmo requisito para o cooldown de 2º contato frio. O guard
  // só devolve `lastOutboundAt` em `meta` (não computa quando o cooldown
  // expira — não sabe `coldFollowupCooldownMs`, que é lido da env aqui, na
  // camada de serviço); por isso quem soma é este arquivo, não `@inno/core`.
  if (reason === 'LEAD_CONTACT_COOLDOWN' && meta?.lastOutboundAt) {
    const resetsAt = new Date(new Date(String(meta.lastOutboundAt)).getTime() + ctx.coldFollowupCooldownMs);
    conflict(message, [{ path: 'resetsAt', message: resetsAt.toISOString() }], reason);
  }
  conflict(message, undefined, reason);
}

async function handleSendFailure(
  err: unknown,
  ctx: {
    messageId: string;
    instanceId: string;
    instanceName: string | null;
    instanceDate: Date;
    previousStatus: string;
    /** 🆕 Fase 4.C */
    paceUpdate: Pick<Prisma.WhatsAppInstanceUpdateInput, 'nextSendAllowedAt' | 'sendsSinceMicroPause'>;
  },
): Promise<void> {
  const messagingError = err instanceof MessagingError ? err : null;
  const effect = messagingError ? EVOLUTION_ERROR_EFFECT[messagingError.code] : EVOLUTION_ERROR_EFFECT.UNKNOWN;
  const errorMessage = messagingError?.message ?? (err instanceof Error ? err.message : String(err));

  logger.error('falha ao enviar mensagem via Evolution API', {
    messageId: ctx.messageId,
    instanceId: ctx.instanceId,
    code: messagingError?.code ?? 'UNKNOWN',
    outcome: effect.outcome,
  });

  // Alerta de saúde da Evolution API — todo `MessagingError` EXCETO
  // `INVALID_NUMBER`, que é um problema do NÚMERO DO LEAD, não da API/
  // instância (e cujo `message`, único caso do vocabulário, ecoa o telefone
  // — ver `evolution-client.ts` — mais um motivo pra nunca entrar aqui).
  // `code` (não `errorMessage`) é o único dado que vai pro alerta, e
  // `sendAlert` deduplica por `code` — não flooda mesmo sob reenvio.
  if (messagingError && messagingError.code !== 'INVALID_NUMBER') {
    void sendAlert({ kind: 'evolution_api_error', action: 'enviar mensagem', code: messagingError.code });
  }

  if (effect.outcome === 'uncertain') {
    await prisma.$transaction((tx) =>
      recordSendUncertain(tx, { messageId: ctx.messageId, instanceId: ctx.instanceId, effect, errorMessage, paceUpdate: ctx.paceUpdate }),
    );
    return;
  }
  await prisma.$transaction((tx) =>
    recordSendFailure(tx, {
      messageId: ctx.messageId,
      instanceId: ctx.instanceId,
      instanceName: ctx.instanceName,
      instanceDate: ctx.instanceDate,
      previousStatus: ctx.previousStatus,
      effect,
      errorMessage,
      paceUpdate: ctx.paceUpdate,
    }),
  );
}

/** Nunca `500` para falha da Evolution (ARQUITETURA §4.9.5) — sempre `409` (nosso, regra de negócio) ou `502 UPSTREAM_ERROR` (defeito do provedor). */
function mapSendErrorToApiError(err: unknown): never {
  const messagingError = err instanceof MessagingError ? err : null;
  const effect = messagingError ? EVOLUTION_ERROR_EFFECT[messagingError.code] : EVOLUTION_ERROR_EFFECT.UNKNOWN;
  const message = messagingError?.message ?? 'Falha ao enviar a mensagem. Tente novamente em instantes.';

  if (effect.httpStatus === 409) {
    conflict(message, undefined, effect.reason);
  }
  upstreamError(message, effect.reason);
}
