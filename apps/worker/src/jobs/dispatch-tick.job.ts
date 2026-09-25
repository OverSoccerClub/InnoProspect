/**
 * jobs/dispatch-tick.job.ts — o motor de disparo (ARQUITETURA §6.8.2-§6.8.9,
 * Fase 4.F.4). Primeiro código do projeto que produz efeito IRREVERSÍVEL no
 * mundo sem um humano olhando: cada mensagem enviada é um WhatsApp real no
 * celular de uma pessoa real.
 *
 * O que este arquivo NÃO reimplementa (ARQUITETURA §6.8.0 — "segunda
 * implementação do portão = reprovação do Órion"):
 *   - a sequência protegida (opt-out → `evaluateSendGuard` → write-ahead →
 *     `sendText` → classificação → cadência) é `executeSendAttempt`
 *     (`@inno/sending`). Este job só decide QUEM entra nela (claim + escolha
 *     de instância + render do texto) e o que fazer com o veredito quando
 *     ela devolve `outcome:'blocked'` (§6.8.5 — a tradução em estado do
 *     alvo, que É nova nesta rodada, e não existe em nenhum outro lugar).
 *   - `sent`/`failed`/`uncertain` já avançam `CampaignTarget`/
 *     `CampaignInstance` POR DENTRO de `executeSendAttempt` (via
 *     `campaignContext` — ver `send-one.ts`). Este job só acrescenta o que
 *     `executeSendAttempt` não pode saber: os patamares de
 *     `consecutiveUncertain` (3→fora da rotação, 5→halt), que são política
 *     do MOTOR (rotação, ciclo), não do envio unitário.
 */
import type { Job, Queue } from 'bullmq';
import { prisma as defaultPrisma, type Campaign, type CampaignInstance, type Lead, type PrismaClient, type WhatsAppInstance } from '@inno/db';
import {
  effectiveDailyLimit,
  localDateKey,
  nextBusinessWindowOpensAt,
  nextLocalMidnight,
  isWithinBusinessWindow,
  pickInstanceWeighted,
  renderTemplate,
  resolveCampaignJitter,
  resolveCampaignWindow,
  resolveSendPolicy,
  resolveSpintax,
  type SendWindowConfig,
  firstName,
  type TemplateVariableValues,
} from '@inno/core';
import {
  advanceCampaignTargetStatus,
  executeSendAttempt,
  type BlockedVerdict,
  type SendAttemptResult,
} from '@inno/sending';
import { claimNextCampaignTarget, type ClaimedCampaignTarget } from '../lib/dispatch-claim.js';
import { resolveDispatchConfig, type DispatchConfig } from '../lib/dispatch-config.js';
import { resolveWorkerEvolutionClient } from '../lib/evolution.js';
import { isDispatchEnabled, recordDispatchTickHeartbeat } from '../lib/dispatch-state.js';
import { logger as defaultLogger } from '../observability/logger.js';
import { sendAlert as defaultSendAlert, type AlertEvent } from '../observability/alerts.js';

// ─────────────────────────────────────────────────────────────────────────
// Portas — mesmo espírito de `@inno/sending/ports.ts`: injetáveis para a
// Íris testar sem Postgres/Redis reais.
// ─────────────────────────────────────────────────────────────────────────

export type DispatchTickLogger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

/** `pino` tem a ordem INVERTIDA (`logger.info(fields, message)`) — este adaptador existe para `executeSendAttempt` (que espera a ordem de `apps/web`) e o resto deste arquivo usarem a MESMA porta sem cada chamador se preocupar com a ordem. */
function adaptPinoLogger(pino: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): DispatchTickLogger {
  return {
    info: (message, fields) => pino.info(fields ?? {}, message),
    warn: (message, fields) => pino.warn(fields ?? {}, message),
    error: (message, fields) => pino.error(fields ?? {}, message),
  };
}

export type DispatchTickDeps = {
  prisma: PrismaClient;
  logger: DispatchTickLogger;
  notify: (event: AlertEvent) => void | Promise<void>;
  dispatchQueue: Queue;
  /** Default `() => new Date()` — testes de janela/gate injetam um relógio fixo. */
  now?: () => Date;
  /** Default `Math.random` — testes de rotação ponderada injetam RNG determinístico. */
  rng?: () => number;
};

export function defaultDispatchTickDeps(dispatchQueue: Queue): DispatchTickDeps {
  return {
    prisma: defaultPrisma,
    logger: adaptPinoLogger(defaultLogger),
    notify: defaultSendAlert,
    dispatchQueue,
  };
}

type CampaignWithInstances = Campaign & { instances: CampaignInstance[] };

type InstanceGateInfo = {
  instance: WhatsAppInstance;
  sentToday: number;
  dailyLimit: number;
  quotaRemaining: number;
  /** cota > 0 && gate aberto (`nextSendAllowedAt`) && não fora-da-rotação NESTE CICLO (`excludedInstanceIdsThisTick`). NÃO inclui a checagem de conexão — essa é decidida por fora (§6.8.3 passo 2.2, a distinção "causa é conexão" vs "causa é quota/gate"). */
  eligible: boolean;
};

type TickContext = {
  now: Date;
  today: Date;
  timezone: string;
  sendWindow: SendWindowConfig;
  microPause: ReturnType<typeof resolveSendPolicy>['microPause'];
  config: DispatchConfig;
  /**
   * ARQUITETURA §6.8.6 — "≥3 incertos seguidos: a instância sai da rotação
   * NESTE CICLO". É uma exclusão de ESCOPO DO TICK (esta execução de
   * `runDispatchTick`, compartilhada entre TODAS as campanhas processadas
   * nele), não uma exclusão persistida — `consecutiveUncertain` continua
   * gravado no Postgres e cada TICK NOVO reavalia do zero (dá à instância
   * uma nova chance a cada ciclo, em vez de bani-la para sempre até o
   * warmup-roll noturno). É isto que torna o patamar de 5 alcançável: se a
   * exclusão fosse permanente a partir de 3, a mesma instância nunca
   * chegaria a tentar de novo para acumular o 4º/5º incerto.
   */
  excludedInstanceIdsThisTick: Set<string>;
};

// ─────────────────────────────────────────────────────────────────────────
// Ponto de entrada do tick
// ─────────────────────────────────────────────────────────────────────────

/**
 * Executa UM tick (ARQUITETURA §6.8.3, passos 1-3). Idempotente por desenho:
 * repetir a chamada não duplica envio (a garantia é `Message.campaignTargetId
 * @unique`, dentro de `executeSendAttempt`) — só reprocessa o que ainda está
 * elegível.
 */
export async function runDispatchTick(deps: DispatchTickDeps): Promise<void> {
  // Heartbeat PRIMEIRO, incondicional — prova "o tick de fato rodou este
  // ciclo" mesmo quando pausado (ARQUITETURA §6.8.9/§8.0 regra 4: "parado de
  // propósito" e "quebrado" não podem ser a mesma tela).
  await recordDispatchTickHeartbeat(deps.dispatchQueue);

  // Passo 1 — pausa global (ARQUITETURA §6.8.9).
  const enabled = await isDispatchEnabled(deps.dispatchQueue);
  if (!enabled) {
    deps.logger.info('dispatch-tick: motor pausado — nenhuma campanha processada neste ciclo');
    return;
  }

  const now = deps.now ? deps.now() : new Date();
  const policy = resolveSendPolicy(process.env);
  const config = resolveDispatchConfig(process.env);
  const ctx: TickContext = {
    now,
    today: localDateKey(now, policy.sendWindow.timezone),
    timezone: policy.sendWindow.timezone,
    sendWindow: policy.sendWindow,
    microPause: policy.microPause,
    config,
    excludedInstanceIdsThisTick: new Set(),
  };

  const campaigns = await deps.prisma.campaign.findMany({
    where: { status: 'running' },
    orderBy: { startedAt: 'asc' },
    include: { instances: true },
  });

  for (const campaign of campaigns) {
    try {
      await processCampaign(deps, campaign, ctx, policy.jitterRangeSeconds);
    } catch (err) {
      // Um bug/erro inesperado numa campanha NUNCA pode impedir as outras de
      // processar, nem derrubar o tick (que também escreveria o heartbeat de
      // novo só no PRÓXIMO ciclo, 15s depois — inaceitável).
      deps.logger.error('dispatch-tick: erro inesperado processando campanha — outras campanhas continuam', {
        campaignId: campaign.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function createDispatchTickProcessor(deps: DispatchTickDeps) {
  return async function processDispatchTickJob(_job: Job): Promise<void> {
    await runDispatchTick(deps);
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Por campanha (ARQUITETURA §6.8.3, passo 2)
// ─────────────────────────────────────────────────────────────────────────

/** Teto de segurança de iterações do laço 2.3 por campanha/tick — nunca deveria ser alcançado (o gate/cota naturalmente esgota as instâncias elegíveis bem antes disso); existe só para um bug de elegibilidade nunca virar laço infinito dentro de um único tick. */
const MAX_ITERATIONS_PER_CAMPAIGN_TICK = 2_000;

async function processCampaign(
  deps: DispatchTickDeps,
  campaign: CampaignWithInstances,
  ctx: TickContext,
  envJitterRangeSeconds: { minSeconds: number; maxSeconds: number },
): Promise<void> {
  // Passo 2.1 — janela da campanha aberta agora?
  const window = resolveCampaignWindow(ctx.sendWindow, {
    startHour: campaign.sendWindowStartHour,
    endHour: campaign.sendWindowEndHour,
    daysOfWeek: campaign.sendWindowDaysOfWeek,
  });
  const windowNeverOpens =
    (window.businessWindow.daysOfWeek ?? []).length === 0 || window.businessWindow.startHour >= window.businessWindow.endHour;
  if (windowNeverOpens) {
    // Defesa em profundidade (ARQUITETURA — o `start`/contrato já recusam
    // isto na entrada desde esta rodada; uma linha ANTIGA no banco não pode
    // ficar `running` para sempre sem nunca enviar e sem explicação).
    await haltCampaign(
      deps,
      campaign,
      'A janela de envio configurada para esta campanha nunca abre (interseção vazia com o piso do ambiente) — ajuste os dias/horário e retome.',
    );
    return;
  }
  if (!isWithinBusinessWindow(ctx.now, window)) {
    const nextOpen = nextBusinessWindowOpensAt(ctx.now, window);
    if (nextOpen) {
      await deps.prisma.campaignTarget.updateMany({
        where: { campaignId: campaign.id, status: 'pending', scheduledFor: { lte: ctx.now } },
        data: { scheduledFor: nextOpen },
      });
    } else {
      deps.logger.warn('dispatch-tick: janela da campanha não tem próxima abertura calculável — alvos ficam como estão', { campaignId: campaign.id });
    }
    return;
  }

  const campaignInstanceIds = campaign.instances.map((ci) => ci.instanceId);
  const campaignJitter = resolveCampaignJitter(envJitterRangeSeconds, {
    minSeconds: campaign.jitterMinSeconds,
    maxSeconds: campaign.jitterMaxSeconds,
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS_PER_CAMPAIGN_TICK; iteration++) {
    const gateInfos = await loadInstanceGateInfo(deps.prisma, campaignInstanceIds, ctx, campaign.dailyLimitPerInstance);
    const connected = gateInfos.filter((g) => g.instance.status === 'connected');

    if (connected.length === 0) {
      // Passo 2.2 — vazia, e a causa é CONEXÃO → halt (§6.6). Rede de
      // segurança: a queda de UMA instância já halta sozinha via
      // `haltCampaignsSoleInstanceDisconnected` (webhook/reconciliação/falha
      // de envio) quando ela é a ÚNICA da campanha — este caminho cobre o
      // caso de MÚLTIPLAS instâncias que caíram em momentos diferentes (cada
      // queda individual não era "a única", mas agora nenhuma sobrou).
      await haltCampaign(deps, campaign, 'Nenhuma instância conectada disponível para esta campanha.', 'no_connected_instance');
      return;
    }

    const eligible = connected.filter((g) => g.eligible);
    if (eligible.length === 0) {
      // Passo 2.2 — vazia, e a causa é COTA/GATE → nada a fazer neste tick.
      // Mesmo assim, confere conclusão: pode não sobrar NENHUM alvo `pending`
      // (ex.: o último foi processado no tick anterior e ninguém checou
      // ainda) — sem isto, a campanha ficaria `running` para sempre.
      await maybeCompleteCampaign(deps, campaign, ctx.now);
      return;
    }

    const leaseUntil = new Date(ctx.now.getTime() + ctx.config.leaseSeconds * 1000);
    const target = await claimNextCampaignTarget(deps.prisma, campaign.id, leaseUntil);
    if (!target) {
      // Acabaram alvos elegíveis (devidos agora) — pode ser porque a
      // campanha TERMINOU (0 pending) ou porque os restantes estão
      // agendados para o futuro (ex.: reagendados por §6.8.5). A checagem
      // abaixo distingue os dois casos por `COUNT(*) WHERE status='pending'`.
      await maybeCompleteCampaign(deps, campaign, ctx.now);
      return;
    }

    const affinityInstanceId = await lastMessageInstanceId(deps.prisma, target.leadId, campaignInstanceIds);
    const chosen = resolveInstanceForTarget(eligible, affinityInstanceId, deps.rng);
    if (!chosen) {
      // Passo 2.3.b, nenhuma elegível DEPOIS do claim (corrida rara — outra
      // escrita mudou o gate entre o topo do laço e agora). Solta o alvo
      // imediatamente (não espera o lease de 120s) e tenta de novo no mesmo
      // tick a partir do topo do laço.
      await deps.prisma.campaignTarget.update({ where: { id: target.id }, data: { scheduledFor: ctx.now } });
      continue;
    }

    const outcome = await handleOneTarget(deps, campaign, target, chosen, ctx, window, campaignJitter, campaignInstanceIds);
    if (outcome === 'halt') return;
  }

  deps.logger.warn('dispatch-tick: campanha atingiu o teto de iterações por tick — continua no próximo ciclo', {
    campaignId: campaign.id,
    maxIterations: MAX_ITERATIONS_PER_CAMPAIGN_TICK,
  });

  await maybeCompleteCampaign(deps, campaign, ctx.now);
}

async function maybeCompleteCampaign(deps: DispatchTickDeps, campaign: CampaignWithInstances, now: Date): Promise<void> {
  const pendingCount = await deps.prisma.campaignTarget.count({ where: { campaignId: campaign.id, status: 'pending' } });
  if (pendingCount > 0) return;

  const result = await deps.prisma.campaign.updateMany({
    where: { id: campaign.id, status: 'running' },
    data: { status: 'completed', finishedAt: now },
  });
  if (result.count > 0) {
    deps.logger.info('dispatch-tick: campanha concluída — nenhum alvo pending restante', { campaignId: campaign.id });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Elegibilidade de instância (ARQUITETURA §6.8.3 passo 2.2, §6.8.10)
// ─────────────────────────────────────────────────────────────────────────

async function loadInstanceGateInfo(
  prisma: PrismaClient,
  instanceIds: string[],
  ctx: TickContext,
  campaignDailyLimitOverride: number | null,
): Promise<InstanceGateInfo[]> {
  if (instanceIds.length === 0) return [];

  const [instances, stats] = await Promise.all([
    prisma.whatsAppInstance.findMany({ where: { id: { in: instanceIds } } }),
    prisma.instanceDailyStat.findMany({ where: { instanceId: { in: instanceIds }, date: ctx.today } }),
  ]);
  const statByInstance = new Map(stats.map((s) => [s.instanceId, s.sentCount]));

  return instances.map((instance) => {
    const tableLimit = effectiveDailyLimit(instance.warmupDay, instance.dailyLimitOverride);
    // ARQUITETURA §6.8.10 — a campanha só ESTREITA a cota (`min`, nunca alarga).
    const dailyLimit = campaignDailyLimitOverride !== null ? Math.min(tableLimit, campaignDailyLimitOverride) : tableLimit;
    const sentToday = statByInstance.get(instance.id) ?? 0;
    const quotaRemaining = Math.max(0, dailyLimit - sentToday);
    const gateOpen = instance.nextSendAllowedAt === null || instance.nextSendAllowedAt.getTime() <= ctx.now.getTime();
    // ARQUITETURA §6.8.6 — exclusão de ESCOPO DO TICK (não persistida), ver
    // comentário de `excludedInstanceIdsThisTick` em `TickContext`.
    const notExcludedThisTick = !ctx.excludedInstanceIdsThisTick.has(instance.id);

    return { instance, sentToday, dailyLimit, quotaRemaining, eligible: quotaRemaining > 0 && gateOpen && notExcludedThisTick };
  });
}

async function lastMessageInstanceId(prisma: PrismaClient, leadId: string, campaignInstanceIds: string[]): Promise<string | null> {
  if (campaignInstanceIds.length === 0) return null;
  const message = await prisma.message.findFirst({
    where: { leadId, instanceId: { in: campaignInstanceIds } },
    orderBy: { createdAt: 'desc' },
    select: { instanceId: true },
  });
  return message?.instanceId ?? null;
}

/**
 * ARQUITETURA §6.8.4 — afinidade lead→instância PRIMEIRO (se elegível AGORA);
 * senão round-robin ponderado por cota restante (`pickInstanceWeighted`,
 * `@inno/core`). `null` só quando `eligible` está vazio (não deveria
 * acontecer aqui — o chamador já garantiu `eligible.length > 0` antes de
 * chamar; é defesa contra regressão, não caminho esperado).
 */
function resolveInstanceForTarget(
  eligible: InstanceGateInfo[],
  affinityInstanceId: string | null,
  rng?: () => number,
): InstanceGateInfo | null {
  if (affinityInstanceId) {
    const affinity = eligible.find((g) => g.instance.id === affinityInstanceId);
    if (affinity) return affinity;
  }

  const picked = pickInstanceWeighted(
    eligible.map((g) => ({ instanceId: g.instance.id, quotaRemaining: g.quotaRemaining, isDegraded: g.instance.isDegraded })),
    rng,
  );
  if (!picked) return null;
  return eligible.find((g) => g.instance.id === picked.instanceId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// 1 alvo (ARQUITETURA §6.8.3, passos 2.3.c-i)
// ─────────────────────────────────────────────────────────────────────────

/** Duplicado de propósito de `apps/web/src/lib/services/campaigns.ts#buildLeadTemplateValues` (regra 4, `convention-api-routes-fase1`: módulos de serviço não importam função privada um do outro — `apps/worker` nem PODERIA importar de `apps/web`, §2). */
function buildLeadTemplateValues(lead: Pick<Lead, 'name' | 'uf' | 'category' | 'website' | 'phoneE164'> & { city: { name: string } | null }): TemplateVariableValues {
  return {
    nome: lead.name,
    primeiro_nome: firstName(lead.name),
    cidade: lead.city?.name,
    uf: lead.uf,
    categoria: lead.category ?? undefined,
    site: lead.website ?? undefined,
    telefone: lead.phoneE164 ?? undefined,
    minha_empresa: process.env.APP_COMPANY_NAME || undefined,
  };
}

async function handleOneTarget(
  deps: DispatchTickDeps,
  campaign: CampaignWithInstances,
  target: ClaimedCampaignTarget,
  gateInfo: InstanceGateInfo,
  ctx: TickContext,
  window: SendWindowConfig,
  campaignJitter: { minSeconds: number; maxSeconds: number },
  campaignInstanceIds: string[],
): Promise<'continue' | 'halt'> {
  // §6.8.2 — "acima disso, o alvo vira failed/max_attempts no claim seguinte".
  if (target.attempt > ctx.config.maxAttempts) {
    await deps.prisma.$transaction((tx) => advanceCampaignTargetStatus(tx, target.id, 'failed', { skipReason: 'max_attempts' }));
    deps.logger.warn('dispatch-tick: alvo excedeu DISPATCH_MAX_ATTEMPTS — marcado failed', {
      campaignId: campaign.id,
      targetId: target.id,
      attempt: target.attempt,
    });
    return 'continue';
  }

  const lead = await deps.prisma.lead.findUnique({ where: { id: target.leadId }, include: { city: { select: { name: true } } } });
  if (!lead) {
    // Defensivo — Lead apagado (retenção/LGPD, §7.3) enquanto o alvo ainda `pending`.
    await deps.prisma.$transaction((tx) => advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason: 'lead_not_found' }));
    deps.logger.error('dispatch-tick: lead do alvo não encontrado — pulando (dado inconsistente)', {
      campaignId: campaign.id,
      targetId: target.id,
      leadId: target.leadId,
    });
    return 'continue';
  }

  if (!campaign.renderedTemplateSnapshot) {
    // Defensivo — toda campanha `running` passou pelo `start`, que congela o snapshot.
    await haltCampaign(deps, campaign, 'Campanha sem template congelado (renderedTemplateSnapshot ausente) — inconsistência interna, contate o suporte.');
    return 'halt';
  }

  const values = buildLeadTemplateValues(lead);
  const rendered = renderTemplate(campaign.renderedTemplateSnapshot, values);
  const finalText = resolveSpintax(rendered, { seed: target.id });

  const evoResult = await resolveWorkerEvolutionClient({ prisma: deps.prisma, env: process.env }, gateInfo.instance);
  if (evoResult.outcome !== 'resolved') {
    // Servidor ausente/inativo — não é o `status` da INSTÂNCIA (que pode
    // estar `connected`), mas ela não consegue enviar agora de qualquer
    // forma. Reagenda pra já (a PRÓXIMA instância elegível assume no laço) —
    // a instância em si só sai da rotação se ISTO se repetir a ponto de o
    // operador notar via log; não há contador dedicado para isto na 4.F.4.
    await deps.prisma.campaignTarget.update({ where: { id: target.id }, data: { scheduledFor: ctx.now } });
    deps.logger.error('dispatch-tick: não foi possível resolver o servidor Evolution da instância — alvo reagendado', {
      campaignId: campaign.id,
      instanceId: gateInfo.instance.id,
      outcome: evoResult.outcome,
    });
    return 'continue';
  }

  const [lastOutbound, lastInbound] = await Promise.all([
    deps.prisma.message.findFirst({ where: { leadId: lead.id, direction: 'outbound' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    deps.prisma.message.findFirst({ where: { leadId: lead.id, direction: 'inbound' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);

  const result = await executeSendAttempt(
    { prisma: deps.prisma, evolutionClient: evoResult.client, logger: deps.logger, notify: deps.notify, now: deps.now, rng: deps.rng },
    {
      lead: { id: lead.id, status: lead.status, phoneE164: target.phoneE164, phoneType: lead.phoneType },
      instance: gateInfo.instance,
      text: finalText,
      quota: { sentToday: gateInfo.sentToday },
      today: ctx.today,
      lastOutboundAt: lastOutbound?.createdAt ?? null,
      lastInboundAt: lastInbound?.createdAt ?? null,
      isColdFirstContact: lastOutbound === null,
      companyName: process.env.APP_COMPANY_NAME || null,
      // Motor: NUNCA concede os overrides que existem para um humano decidir
      // na hora (ARQUITETURA §6.1/§6.8.3) — se algum destes bloquear, é a
      // tabela do §6.8.5 que decide o destino do alvo, não uma flag "true".
      overrides: { allowNonMobile: false, confirmOutsideBusinessWindow: false, ignorePaceLock: false },
      windowConfig: window,
      duplicateWindowMs: ctx.config.duplicateWindowMs,
      coldFollowupCooldownMs: ctx.config.coldFollowupCooldownMs,
      jitterRangeSeconds: campaignJitter,
      microPauseConfig: ctx.microPause,
      campaignContext: { targetId: target.id, campaignId: campaign.id, allowedInstanceIds: campaignInstanceIds },
      actor: { type: 'system' },
      renderedTemplateId: null,
    },
  );

  logSendAttempt(deps, campaign, target, gateInfo, result);

  switch (result.outcome) {
    case 'sent':
    case 'expired':
    case 'failed':
      // 'sent'/'failed' já avançaram CampaignTarget/CampaignInstance DENTRO
      // de `executeSendAttempt` (campaignContext). 'expired' deixa o alvo
      // `pending` de propósito (retry natural depois do lease) — nada a
      // fazer aqui nos três casos.
      return 'continue';
    case 'uncertain': {
      const thresholdOutcome = await handleUncertainThresholds(deps, campaign, gateInfo.instance, ctx);
      return thresholdOutcome === 'halt' ? 'halt' : 'continue';
    }
    case 'blocked': {
      const decision = translateBlockedVerdict(result.verdict, { now: ctx.now, timezone: ctx.timezone, window });
      if (decision.action === 'skip') {
        await deps.prisma.$transaction((tx) => advanceCampaignTargetStatus(tx, target.id, 'skipped', { skipReason: decision.skipReason }));
        return 'continue';
      }
      if (decision.action === 'reschedule') {
        await deps.prisma.campaignTarget.update({ where: { id: target.id }, data: { scheduledFor: decision.scheduledFor } });
        return 'continue';
      }
      await haltCampaign(deps, campaign, decision.haltReason);
      return 'halt';
    }
    default: {
      // `never` — um `outcome` novo em `@inno/sending` PARA de compilar aqui
      // (ARQUITETURA §6.8.0.2: "o switch de cada lado é exaustivo em TIPO").
      const exhaustiveCheck: never = result;
      throw new Error(`dispatch-tick: outcome de executeSendAttempt não tratado: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Observabilidade mínima (ARQUITETURA §6.8.8) — NUNCA o texto da mensagem nem o telefone completo. */
function logSendAttempt(
  deps: DispatchTickDeps,
  campaign: CampaignWithInstances,
  target: ClaimedCampaignTarget,
  gateInfo: InstanceGateInfo,
  result: SendAttemptResult,
): void {
  const base = { campaignId: campaign.id, targetId: target.id, instanceId: gateInfo.instance.id, outcome: result.outcome };
  if (result.outcome === 'sent') {
    deps.logger.info('dispatch-tick: envio processado', { ...base, jitterMs: result.pace.jitterMs });
    return;
  }
  if (result.outcome === 'blocked') {
    deps.logger.info('dispatch-tick: envio processado', { ...base, reason: result.verdict.reason });
    return;
  }
  if (result.outcome === 'failed' || result.outcome === 'uncertain') {
    deps.logger.info('dispatch-tick: envio processado', { ...base, reason: result.reason });
    return;
  }
  deps.logger.info('dispatch-tick: envio processado', base);
}

// ─────────────────────────────────────────────────────────────────────────
// 🔒 Tradução do veredito do guard em estado do alvo (ARQUITETURA §6.8.5)
// ─────────────────────────────────────────────────────────────────────────

type GuardTranslation =
  | { action: 'skip'; skipReason: string }
  | { action: 'reschedule'; scheduledFor: Date }
  | { action: 'halt'; haltReason: string };

function metaDateOrNull(meta: Record<string, unknown> | undefined, key: string): Date | null {
  const value = meta?.[key];
  return typeof value === 'string' ? new Date(value) : null;
}

/**
 * A tabela do §6.8.5, linha a linha. `verdict.reason` é `SendBlockReason`
 * (`@inno/core`) — o `switch` é exaustivo em TIPO (`exhaustiveCheck: never`):
 * um `reason` novo no guard quebra a COMPILAÇÃO aqui, nunca vira decisão
 * improvisada dentro do job.
 */
export function translateBlockedVerdict(verdict: BlockedVerdict, ctx: { now: Date; timezone: string; window: SendWindowConfig }): GuardTranslation {
  switch (verdict.reason) {
    case 'OPTED_OUT':
      return { action: 'skip', skipReason: 'opted_out' };
    case 'LEAD_NOT_MOBILE':
      return { action: 'skip', skipReason: 'landline' };
    case 'LEAD_CONTACT_COOLDOWN':
    case 'DUPLICATE_SEND':
      return { action: 'skip', skipReason: 'recently_contacted' };
    case 'QUIET_HOURS':
    case 'OUTSIDE_BUSINESS_WINDOW': {
      const fromMeta = metaDateOrNull(verdict.meta, 'nextWindowOpensAt');
      const fallback = nextBusinessWindowOpensAt(ctx.now, ctx.window) ?? new Date(ctx.now.getTime() + 60 * 60 * 1000);
      return { action: 'reschedule', scheduledFor: fromMeta ?? fallback };
    }
    case 'DAILY_LIMIT_REACHED': {
      const midnight = nextLocalMidnight(ctx.now, ctx.timezone);
      const tomorrowOpen = nextBusinessWindowOpensAt(midnight, ctx.window) ?? midnight;
      return { action: 'reschedule', scheduledFor: tomorrowOpen };
    }
    case 'SEND_PACE_LOCKED': {
      const fromMeta = metaDateOrNull(verdict.meta, 'nextSendAllowedAt');
      return { action: 'reschedule', scheduledFor: fromMeta ?? ctx.now };
    }
    case 'INSTANCE_NOT_CONNECTED':
    case 'INSTANCE_BANNED':
      return { action: 'reschedule', scheduledFor: ctx.now };
    case 'MISSING_OPTOUT_NOTICE':
    case 'MISSING_COMPANY_NAME':
      return {
        action: 'halt',
        haltReason: `Conteúdo inválido detectado durante o envio (${verdict.reason}) — isto deveria ter sido bloqueado no início da campanha (start). Contate o suporte. ${verdict.message}`,
      };
    default: {
      const exhaustiveCheck: never = verdict.reason;
      throw new Error(`dispatch-tick: reason de guard sem tradução na tabela §6.8.5: ${exhaustiveCheck}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Halts (ARQUITETURA §6.6/§6.8.6) e patamares de `consecutiveUncertain`
// ─────────────────────────────────────────────────────────────────────────

async function haltCampaign(
  deps: DispatchTickDeps,
  campaign: CampaignWithInstances,
  haltReason: string,
  cause: 'no_connected_instance' | 'other' = 'other',
  instanceId?: string,
): Promise<void> {
  const result = await deps.prisma.campaign.updateMany({ where: { id: campaign.id, status: 'running' }, data: { status: 'halted', haltReason } });
  if (result.count === 0) return; // já não estava `running` (outra rota já mudou) — não duplica alerta

  deps.logger.error('dispatch-tick: campanha HALTADA', { campaignId: campaign.id, haltReason, cause });

  if (cause === 'no_connected_instance') {
    void deps.notify({ kind: 'dispatch_campaign_halted_no_connected_instance', campaignId: campaign.id });
    return;
  }
  void deps.notify({ kind: 'campaign_halted', campaignIds: [campaign.id], instanceId: instanceId ?? campaign.instances[0]?.instanceId ?? '' });
}

/**
 * ARQUITETURA §6.8.6 — os dois patamares de `consecutiveUncertain`.
 * `executeSendAttempt` já incrementou o contador (dentro de
 * `recordSendUncertain`); esta função só LÊ o valor fresco e decide o
 * efeito de ROTAÇÃO/CICLO, que é política do motor, não do envio unitário.
 */
async function handleUncertainThresholds(
  deps: DispatchTickDeps,
  campaign: CampaignWithInstances,
  instanceBeforeAttempt: WhatsAppInstance,
  ctx: TickContext,
): Promise<'ok' | 'degrade' | 'halt'> {
  const fresh = await deps.prisma.whatsAppInstance.findUnique({ where: { id: instanceBeforeAttempt.id } });
  const count = fresh?.consecutiveUncertain ?? instanceBeforeAttempt.consecutiveUncertain + 1;

  if (count >= ctx.config.uncertainHaltAt) {
    await haltCampaign(
      deps,
      campaign,
      `Resultado de envio incerto repetido nesta instância (${count}x seguidas) — confira no WhatsApp o que realmente saiu antes de retomar.`,
      'other',
      instanceBeforeAttempt.id,
    );
    return 'halt';
  }
  if (count >= ctx.config.uncertainDegradeAt) {
    // Exclusão de ESCOPO DO TICK — ver comentário de
    // `excludedInstanceIdsThisTick` em `TickContext`. Não persiste: o
    // próximo tick relê `consecutiveUncertain` do Postgres do zero.
    ctx.excludedInstanceIdsThisTick.add(instanceBeforeAttempt.id);
    deps.logger.warn('dispatch-tick: instância fora da rotação neste ciclo — resultados incertos consecutivos', {
      instanceId: instanceBeforeAttempt.id,
      consecutiveUncertain: count,
    });
    void deps.notify({
      kind: 'dispatch_instance_uncertain_degraded',
      instanceId: instanceBeforeAttempt.id,
      instanceName: instanceBeforeAttempt.name,
      consecutiveUncertain: count,
      threshold: ctx.config.uncertainDegradeAt,
    });
    return 'degrade';
  }
  return 'ok';
}
