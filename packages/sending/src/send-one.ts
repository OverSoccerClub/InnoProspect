/**
 * send-one.ts — `executeSendAttempt`, a sequência protegida extraída de
 * `apps/web/src/lib/services/messages.ts` (ARQUITETURA §6.8.0): leitura de
 * opt-out → `evaluateSendGuard` → write-ahead → o ÚNICO `sendText` → efeitos
 * de erro da Evolution → registro de falha/incerto → avanço do gate de
 * ritmo → avanço de cadência → transição do alvo de campanha e contadores.
 *
 * ⚠️ INVARIANTE QUE O ÓRION AUDITA (§4.9.9 item 5, preservado byte a byte na
 * extração): entre a leitura de opt-out (`deps.prisma.optOut.findUnique`,
 * abaixo) e `evaluateSendGuard` não há nenhum `await`. Entre `evaluateSendGuard`
 * (quando `allow:true`) e `sendText` só existe a transação de write-ahead.
 * `grep -rn "sendText(" apps/ packages/` deve achar exatamente UMA chamada
 * de produção para mensagem de lead: a linha marcada abaixo.
 *
 * Não lança `ApiHttpError` (não pode — `@inno/contracts`/Next não são
 * dependência deste pacote) — devolve `SendAttemptResult` (ARQUITETURA
 * §6.8.0.2). `apps/web` (`lib/services/messages.ts`) traduz para HTTP; o
 * futuro `dispatch-tick.job` (Fase 4.F.4) traduz para estado do alvo de
 * campanha (§6.8.5).
 */
import { MessagingError, type MessagingErrorCode } from '@inno/messaging';
import {
  advanceSendPace,
  checkStatusTransition,
  evaluateSendGuard,
  type AdvanceSendPaceResult,
  type JitterRangeSeconds,
  type LeadStatus,
  type MicroPauseConfig,
  type PaceAdvanceMode,
  type SendGuardFacts,
  type SendWindowConfig,
  MAX_DECISION_TO_SEND_MS as DEFAULT_MAX_DECISION_TO_SEND_MS,
} from '@inno/core';
import type { Prisma, WhatsAppInstance } from '@inno/db';
import { advanceCampaignTargetStatus, haltCampaignsSoleInstanceDisconnected } from './campaign-targets.js';
import { advanceNextSendAllowedAt, paceFieldsForUpdate } from './pace.js';
import { EVOLUTION_ERROR_EFFECT, type EvolutionErrorEffect, type SendAttemptResult } from './outcome.js';
import type { SendAttemptDeps } from './ports.js';

/**
 * 🆕 Fase 4.D (mantido na extração) — contexto opcional passado quando o
 * envio é o disparo de um alvo de campanha (manual, `apps/web/src/lib/
 * services/campaigns.ts`, OU futuro `dispatch-tick.job`, Fase 4.F.4). Passar
 * isto é o que faz `executeSendAttempt` gravar `Message.campaignTargetId`
 * (FK única) e avançar `CampaignTarget.status`/`CampaignInstance.sentCount|
 * failedCount` NA MESMA transação do resultado do envio.
 */
export type CampaignSendContext = {
  targetId: string;
  campaignId: string;
  /**
   * Restringe a resolução AUTOMÁTICA de instância (feita pelo CHAMADOR, não
   * por este pacote — ARQUITETURA §6.8.0.1: "resolução de instância... fica
   * em cada app") às instâncias desta campanha. Não é lido por
   * `executeSendAttempt`; existe aqui só para o chamador ter um único tipo.
   */
  allowedInstanceIds: readonly string[];
};

/** Quem registra `LeadActivity.actor`/`actorUserId` no sucesso — humano no envio manual, `system` no motor (ARQUITETURA §6.8, sem humano nem pedido). */
export type SendAttemptActor = { type: 'user'; userId: string } | { type: 'system' };

export type ExecuteSendAttemptInput = {
  lead: { id: string; status: LeadStatus; phoneE164: string; phoneType: SendGuardFacts['phone']['type'] };
  instance: WhatsAppInstance;
  /** Texto FINAL (já renderizado + spintaxado, ou `body` cru) — renderização é `@inno/core` puro, fica no chamador (ARQUITETURA §6.8.0.1). */
  text: string;
  quota: { sentToday: number };
  /** Mesma granularidade de `InstanceDailyStat.date` (`@db.Date`, fuso `APP_TIMEZONE`) — calculado pelo CHAMADOR (lê env, este pacote não pode). */
  today: Date;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  isColdFirstContact: boolean;
  companyName: string | null;
  overrides: { allowNonMobile: boolean; confirmOutsideBusinessWindow: boolean; ignorePaceLock?: boolean };
  windowConfig: SendWindowConfig;
  duplicateWindowMs: number;
  coldFollowupCooldownMs: number;
  jitterRangeSeconds: JitterRangeSeconds;
  microPauseConfig: MicroPauseConfig;
  /** Default `MAX_DECISION_TO_SEND_MS` (`@inno/core`, 5s) — só para teste. */
  maxDecisionToSendMs?: number;
  /** Default `{ maxWait: 1_000, timeout: 3_000 }` — só para teste. */
  writeAheadTransactionOptions?: { maxWait: number; timeout: number };
  campaignContext?: CampaignSendContext;
  actor: SendAttemptActor;
  /** Só para `LeadActivity.payload.templateId` no sucesso — `null`/`undefined` quando o texto não veio de template. */
  renderedTemplateId?: string | null;
};

/** Kill switch por falhas consecutivas de ENVIO (ARQUITETURA §4.9.5/§6.6, distinto do congelamento por taxa de resposta do §6.2). */
const CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD = 5;

const DEFAULT_WRITE_AHEAD_TRANSACTION_OPTIONS = { maxWait: 1_000, timeout: 3_000 } as const;

export async function executeSendAttempt(deps: SendAttemptDeps, input: ExecuteSendAttemptInput): Promise<SendAttemptResult> {
  const now = deps.now ?? (() => new Date());
  const { lead, instance, campaignContext } = input;

  // G11 — ⚠️ ÚLTIMA leitura de banco antes da decisão. Nenhum `await` entre
  // esta linha e a chamada de `evaluateSendGuard` abaixo.
  const optOutRow = await deps.prisma.optOut.findUnique({ where: { phoneE164: lead.phoneE164 } });
  const guardNow = now();

  const facts: SendGuardFacts = {
    now: guardNow,
    phone: { e164: lead.phoneE164, type: lead.phoneType },
    instance: {
      status: instance.status,
      isDegraded: instance.isDegraded,
      warmupDay: instance.warmupDay,
      dailyLimitOverride: instance.dailyLimitOverride,
      // SEMPRE `null` explícito quando não há gate ainda, NUNCA omitido —
      // campo omitido (`undefined`) deixaria G9c inerte.
      nextSendAllowedAt: instance.nextSendAllowedAt ?? null,
    },
    quota: { sentToday: input.quota.sentToday },
    optOut: { exists: optOutRow !== null, checkedAt: guardNow },
    lastOutboundAt: input.lastOutboundAt,
    lastInboundAt: input.lastInboundAt,
    isColdFirstContact: input.isColdFirstContact,
    text: input.text,
    companyName: input.companyName,
    overrides: {
      allowNonMobile: input.overrides.allowNonMobile,
      confirmOutsideBusinessWindow: input.overrides.confirmOutsideBusinessWindow,
      ignorePaceLock: input.overrides.ignorePaceLock,
    },
  };

  const verdict = evaluateSendGuard(facts, {
    windowConfig: input.windowConfig,
    duplicateWindowMs: input.duplicateWindowMs,
    coldFollowupCooldownMs: input.coldFollowupCooldownMs,
  });

  if (!verdict.allow) {
    return { outcome: 'blocked', verdict, optOutCreatedAt: optOutRow?.createdAt ?? null };
  }

  // Se o guard de fato honrou `ignorePaceLock` (warning
  // `PACE_LOCK_BYPASSED_FOR_REPLY`), o avanço da cadência usa o modo
  // `'floor'` (só o piso do jitter, sem tocar a micro-pausa). Fora desse
  // caso, é `'full'`.
  const paceMode: PaceAdvanceMode = verdict.warnings.some((w) => w.code === 'PACE_LOCK_BYPASSED_FOR_REPLY') ? 'floor' : 'full';

  // ── Write-ahead (ARQUITETURA §4.9.5, transação 1) — a ÚNICA escrita entre o guard e a rede. ──
  const reservedMessage = await deps.prisma.$transaction(
    async (tx) => {
      const created = await tx.message.create({
        data: {
          leadId: lead.id,
          instanceId: instance.id,
          direction: 'outbound',
          body: input.text,
          status: 'queued',
          campaignTargetId: campaignContext?.targetId,
        },
      });
      await tx.instanceDailyStat.upsert({
        where: { instanceId_date: { instanceId: instance.id, date: input.today } },
        create: { instanceId: instance.id, date: input.today, sentCount: 1 },
        update: { sentCount: { increment: 1 } },
      });
      return created;
    },
    input.writeAheadTransactionOptions ?? DEFAULT_WRITE_AHEAD_TRANSACTION_OPTIONS,
  );

  // ⚠️ Teto entre a decisão (`guardNow`) e o envio real — medido AQUI,
  // imediatamente antes de `sendText`, depois do write-ahead. Se a transação
  // atrasou e a decisão já passou do teto, falha FECHADO: desfaz a reserva
  // por completo (sabemos que nada foi enviado) e devolve `outcome:'expired'`.
  const maxDecisionToSendMs = input.maxDecisionToSendMs ?? DEFAULT_MAX_DECISION_TO_SEND_MS;
  const decisionAgeMs = now().getTime() - guardNow.getTime();
  if (decisionAgeMs > maxDecisionToSendMs) {
    await deps.prisma.$transaction((tx) =>
      revertExpiredReservation(tx, {
        messageId: reservedMessage.id,
        instanceId: instance.id,
        instanceDate: input.today,
        hasCampaignTarget: Boolean(campaignContext),
      }),
    );
    deps.logger.warn('executeSendAttempt: decisão expirou antes do envio (write-ahead demorou demais)', {
      leadId: lead.id,
      instanceId: instance.id,
      decisionAgeMs,
    });
    return { outcome: 'expired', messageId: reservedMessage.id };
  }

  let sentAt: Date;
  let providerMessageId: string;
  try {
    // ⚠️ ÚNICO call site de produção de `sendText` para mensagem de lead.
    const sendResult = await deps.evolutionClient.sendText(instance.evolutionInstanceName, { to: lead.phoneE164, text: input.text });
    providerMessageId = sendResult.providerMessageId;
    sentAt = now();
  } catch (err) {
    const paceResult = advanceSendPace({
      now: now(),
      sendsSinceMicroPause: instance.sendsSinceMicroPause,
      mode: paceMode,
      jitterRangeSeconds: input.jitterRangeSeconds,
      microPause: input.microPauseConfig,
      rng: deps.rng,
    });
    return handleSendFailure(deps, err, {
      messageId: reservedMessage.id,
      instanceId: instance.id,
      instanceName: instance.name,
      instanceDate: input.today,
      previousStatus: instance.status,
      paceMode,
      paceResult,
      campaignContext,
    });
  }

  const paceResult = advanceSendPace({
    now: sentAt,
    sendsSinceMicroPause: instance.sendsSinceMicroPause,
    mode: paceMode,
    jitterRangeSeconds: input.jitterRangeSeconds,
    microPause: input.microPauseConfig,
    rng: deps.rng,
  });

  // ── Transação 2a (sucesso, ARQUITETURA §4.9.5) ──
  await deps.prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: reservedMessage.id }, data: { status: 'sent', providerMessageId, sentAt } });
    await tx.whatsAppInstance.update({
      where: { id: instance.id },
      data: { consecutiveFailures: 0, consecutiveUncertain: 0, ...paceFieldsForUpdate(paceMode, paceResult) },
    });
    await advanceNextSendAllowedAt(tx, instance.id, paceResult.nextSendAllowedAt);
    await advanceLeadToContacted(tx, lead.id, lead.status);
    if (campaignContext) {
      await advanceCampaignTargetStatus(tx, campaignContext.targetId, 'sent', { sentAt });
      await tx.campaignInstance.update({
        where: { campaignId_instanceId: { campaignId: campaignContext.campaignId, instanceId: instance.id } },
        data: { sentCount: { increment: 1 } },
      });
    }
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: 'message_sent',
        payload: {
          messageId: reservedMessage.id,
          instanceId: instance.id,
          templateId: input.renderedTemplateId ?? null,
          confirmOutsideBusinessWindow: input.overrides.confirmOutsideBusinessWindow,
          allowNonMobile: input.overrides.allowNonMobile,
        },
        actor: input.actor.type,
        actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
      },
    });
  });

  // Observabilidade mínima da cadência (ARQUITETURA §6.8.8) — nunca dado
  // sensível, só o que explica um gap grande na timeline do número.
  deps.logger.info('mensagem enviada', {
    leadId: lead.id,
    instanceId: instance.id,
    messageId: reservedMessage.id,
    isColdFirstContact: input.isColdFirstContact,
    paceMode,
    jitterMs: paceResult.jitterMs,
    microPauseTriggered: paceResult.microPauseTriggered,
    nextSendAllowedAt: paceResult.nextSendAllowedAt.toISOString(),
  });

  return { outcome: 'sent', messageId: reservedMessage.id, providerMessageId, sentAt, pace: paceResult, warnings: verdict.warnings };
}

/**
 * Avança `Lead.status` até `contacted`. A FSM (`checkStatusTransition`,
 * `@inno/core`) só aceita passos sequenciais — `new` precisa passar por
 * `validated` antes de chegar a `contacted` — por isso o laço, em vez de um
 * `update` direto para `contacted`.
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

async function handleSendFailure(
  deps: SendAttemptDeps,
  err: unknown,
  ctx: {
    messageId: string;
    instanceId: string;
    instanceName: string | null;
    instanceDate: Date;
    previousStatus: string;
    paceMode: PaceAdvanceMode;
    paceResult: AdvanceSendPaceResult;
    campaignContext?: CampaignSendContext;
  },
): Promise<SendAttemptResult> {
  const messagingError = err instanceof MessagingError ? err : null;
  const code: MessagingErrorCode = messagingError?.code ?? 'UNKNOWN';
  const effect = EVOLUTION_ERROR_EFFECT[code];
  // Texto para GRAVAR (Message.errorMessage/log) — cai no `err.message`/
  // `String(err)` cru quando não é um `MessagingError` (raro: `sendText`
  // sempre lança `MessagingError`, isto é defesa de segunda linha).
  const errorMessage = messagingError?.message ?? (err instanceof Error ? err.message : String(err));
  // Texto para o HUMANO (resultado devolvido — vira a resposta HTTP do envio
  // manual) — mesma regra de antes da extração: `MessagingError.message`
  // quando existe, senão um texto GENÉRICO (nunca `String(err)` cru).
  const resultMessage = messagingError?.message ?? 'Falha ao enviar a mensagem. Tente novamente em instantes.';

  deps.logger.error('falha ao enviar mensagem via Evolution API', {
    messageId: ctx.messageId,
    instanceId: ctx.instanceId,
    code,
    outcome: effect.outcome,
  });

  // Alerta de saúde da Evolution API — todo `MessagingError` EXCETO
  // `INVALID_NUMBER`, que é um problema do NÚMERO DO LEAD, não da API/
  // instância (e cujo `message` ecoa o telefone — mais um motivo pra nunca
  // entrar aqui). `code` (não `errorMessage`) é o único dado que vai pro
  // alerta.
  if (messagingError && messagingError.code !== 'INVALID_NUMBER') {
    void deps.notify({ kind: 'evolution_api_error', action: 'enviar mensagem', code: messagingError.code });
  }

  if (effect.outcome === 'uncertain') {
    await deps.prisma.$transaction((tx) =>
      recordSendUncertain(tx, {
        messageId: ctx.messageId,
        instanceId: ctx.instanceId,
        effect,
        errorMessage,
        paceMode: ctx.paceMode,
        paceResult: ctx.paceResult,
        campaignContext: ctx.campaignContext,
      }),
    );
    return { outcome: 'uncertain', messageId: ctx.messageId, code, reason: 'EVOLUTION_SEND_UNCERTAIN', message: resultMessage };
  }

  await deps.prisma.$transaction((tx) =>
    recordSendFailure(deps, tx, {
      messageId: ctx.messageId,
      instanceId: ctx.instanceId,
      instanceName: ctx.instanceName,
      instanceDate: ctx.instanceDate,
      previousStatus: ctx.previousStatus,
      effect,
      errorMessage,
      paceMode: ctx.paceMode,
      paceResult: ctx.paceResult,
      campaignContext: ctx.campaignContext,
    }),
  );
  return { outcome: 'failed', messageId: ctx.messageId, code, reason: effect.reason, message: resultMessage };
}

/**
 * Transação 2b — CONFIRMADA falha (ARQUITETURA §4.9.5): compensa a reserva
 * do write-ahead por completo (sentCount volta, failedCount sobe) porque
 * sabemos que a mensagem NÃO saiu.
 */
async function recordSendFailure(
  deps: SendAttemptDeps,
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    instanceId: string;
    instanceName: string | null;
    instanceDate: Date;
    effect: EvolutionErrorEffect;
    errorMessage: string;
    previousStatus: string;
    paceMode: PaceAdvanceMode;
    paceResult: AdvanceSendPaceResult;
    campaignContext?: CampaignSendContext;
  },
): Promise<void> {
  const { messageId, instanceId, instanceName, instanceDate, effect, errorMessage, previousStatus, paceMode, paceResult, campaignContext } = params;

  await tx.message.update({ where: { id: messageId }, data: { status: 'failed', errorCode: effect.reason, errorMessage } });

  await tx.instanceDailyStat.update({
    where: { instanceId_date: { instanceId, date: instanceDate } },
    data: { sentCount: { decrement: 1 }, failedCount: { increment: 1 } },
  });

  if (campaignContext) {
    await advanceCampaignTargetStatus(tx, campaignContext.targetId, 'failed', { skipReason: effect.reason });
    await tx.campaignInstance.update({
      where: { campaignId_instanceId: { campaignId: campaignContext.campaignId, instanceId } },
      data: { failedCount: { increment: 1 } },
    });
  }

  // `nextSendAllowedAt` é avançado SEPARADAMENTE, de forma monotônica — ver `pace.ts`.
  const updated = await tx.whatsAppInstance.update({
    where: { id: instanceId },
    data: {
      ...paceFieldsForUpdate(paceMode, paceResult),
      ...(effect.incrementConsecutiveFailures ? { consecutiveFailures: { increment: 1 } } : {}),
      ...(effect.disconnectInstance ? { status: 'disconnected', lastErrorAt: new Date(), lastErrorMessage: errorMessage } : {}),
    },
  });
  await advanceNextSendAllowedAt(tx, instanceId, paceResult.nextSendAllowedAt);

  if (effect.incrementConsecutiveFailures || effect.disconnectInstance) {
    if (effect.incrementConsecutiveFailures && updated.consecutiveFailures >= CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD && !updated.isDegraded) {
      await tx.whatsAppInstance.update({ where: { id: instanceId }, data: { isDegraded: true } });
      void deps.notify({
        kind: 'instance_degraded',
        instanceId,
        instanceName,
        consecutiveFailures: updated.consecutiveFailures,
        threshold: CONSECUTIVE_FAILURE_DEGRADE_THRESHOLD,
      });
    }

    if (effect.disconnectInstance) {
      // Mensagem PRÓPRIA (`effect.reason`, vocabulário fechado nosso — nunca `errorMessage` cru da Evolution).
      if (previousStatus !== 'disconnected') {
        void deps.notify({
          kind: 'instance_disconnected',
          instanceId,
          instanceName,
          reason: 'disconnected',
          message: `Instância desconectada durante uma tentativa de envio (código: ${effect.reason}).`,
        });
      }
      await haltCampaignsSoleInstanceDisconnected(tx, instanceId, `Instância desconectada durante envio: ${errorMessage}`, deps.notify);
    }
  }

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({
      data: { leadId: message.leadId, type: 'message_failed', payload: { messageId, errorCode: effect.reason, errorMessage }, actor: 'system' },
    });
  }
}

/**
 * Transação 2b — resultado INCERTO: `TIMEOUT`/`TRANSIENT_ERROR` no envio não
 * garantem que a mensagem não saiu. NÃO decrementa `sentCount` (pode ter
 * saído), NÃO incrementa `failedCount`/`consecutiveFailures`/`isDegraded`
 * (não é falha confirmada da instância). `consecutiveUncertain` sobe
 * (distinto de `consecutiveFailures`).
 */
async function recordSendUncertain(
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    instanceId: string;
    effect: EvolutionErrorEffect;
    errorMessage: string;
    paceMode: PaceAdvanceMode;
    paceResult: AdvanceSendPaceResult;
    campaignContext?: CampaignSendContext;
  },
): Promise<void> {
  const { messageId, instanceId, effect, errorMessage, paceMode, paceResult, campaignContext } = params;
  const humanMessage = `Resultado incerto — a mensagem PODE ter sido entregue antes da falha de comunicação. Verifique a conversa antes de reenviar. (${errorMessage})`;

  await tx.message.update({ where: { id: messageId }, data: { status: 'failed', errorCode: effect.reason, errorMessage: humanMessage } });

  if (campaignContext) {
    await advanceCampaignTargetStatus(tx, campaignContext.targetId, 'failed', { skipReason: effect.reason });
    await tx.campaignInstance.update({
      where: { campaignId_instanceId: { campaignId: campaignContext.campaignId, instanceId } },
      data: { failedCount: { increment: 1 } },
    });
  }

  await tx.whatsAppInstance.update({
    where: { id: instanceId },
    data: { ...paceFieldsForUpdate(paceMode, paceResult), consecutiveUncertain: { increment: 1 } },
  });
  await advanceNextSendAllowedAt(tx, instanceId, paceResult.nextSendAllowedAt);

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({
      data: { leadId: message.leadId, type: 'message_uncertain', payload: { messageId, errorCode: effect.reason, errorMessage }, actor: 'system' },
    });
  }
}

/**
 * Desfaz a reserva do write-ahead quando a decisão do guard expirou ANTES de
 * `sendText` ser chamado — a compensação é COMPLETA (sabemos com certeza que
 * nada foi enviado, porque `sendText` nunca chegou a ser chamado).
 */
async function revertExpiredReservation(
  tx: Prisma.TransactionClient,
  params: { messageId: string; instanceId: string; instanceDate: Date; hasCampaignTarget?: boolean },
): Promise<void> {
  const { messageId, instanceId, instanceDate, hasCampaignTarget } = params;
  const errorMessage = 'A decisão de envio expirou antes de a mensagem ser efetivamente enviada (write-ahead demorou demais).';

  await tx.message.update({
    where: { id: messageId },
    data: {
      status: 'failed',
      errorCode: 'SEND_WINDOW_EXPIRED',
      errorMessage,
      // Desvincula do alvo de campanha (`campaignTargetId` é `@unique`): não
      // houve TENTATIVA de envio, então o alvo continua `pending` e precisa
      // poder gerar uma NOVA `Message` num retry.
      ...(hasCampaignTarget ? { campaignTargetId: null } : {}),
    },
  });
  await tx.instanceDailyStat.update({
    where: { instanceId_date: { instanceId, date: instanceDate } },
    data: { sentCount: { decrement: 1 } },
  });

  const message = await tx.message.findUnique({ where: { id: messageId } });
  if (message) {
    await tx.leadActivity.create({ data: { leadId: message.leadId, type: 'message_send_expired', payload: { messageId }, actor: 'system' } });
  }
}
