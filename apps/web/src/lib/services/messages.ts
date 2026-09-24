/**
 * lib/services/messages.ts — envio unitário de mensagem
 * (`POST /api/v1/leads/:id/messages`, ARQUITETURA §4.9). Implementa os
 * portões G0-G11 na ordem normativa de §4.9.3: G0 (sessão) é o
 * `api-handler.ts`; G1-G3, a resolução de instância/afinidade e a
 * renderização de template ficam aqui (dependem de Prisma/Next); G4-G11 (a
 * "sequência protegida": opt-out → guard → write-ahead → `sendText` →
 * contabilidade) vivem em `@inno/sending` (ARQUITETURA §6.8.0, extraído na
 * Fase 4.F.1 para ser compartilhado com o futuro `dispatch-tick.job`,
 * `apps/worker`, Fase 4.F.4 — worker e web não podem se chamar por HTTP nem
 * importar um do outro, §2).
 *
 * `sendLeadMessage` é agora o CHAMADOR fino que resolve o que só `apps/web`
 * sabe resolver (sessão/rate-limit, lead, template, instância, cliente
 * Evolution do servidor certo) e traduz o `SendAttemptResult` devolvido por
 * `executeSendAttempt` em HTTP (`throwForBlockedVerdict`/
 * `mapSendErrorToApiError` abaixo, sem uma linha de LÓGICA alterada — só o
 * dado de entrada mudou de "erro lançado" para "campo do resultado").
 *
 * ⚠️ PONTO QUE O ÓRION AUDITA (§4.9.9 item 5): `grep -rn "sendText(" apps/
 * packages/` deve achar exatamente UMA chamada de produção para mensagem de
 * lead — está em `packages/sending/src/send-one.ts`, não mais aqui.
 */
import { prisma, type Lead, type WhatsAppInstance } from '@inno/db';
import {
  deriveInstanceHealth,
  effectiveDailyLimit,
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
  MIN_JITTER_FLOOR_SECONDS,
  type JitterRangeSeconds,
  type MicroPauseConfig,
  type SendWindowConfig,
  type TemplateVariableValues,
} from '@inno/core';
import type { SendLeadMessageBody, SendLeadMessageResponse, SendLeadMessageWarning } from '@inno/contracts';
import { badRequest, conflict, notFound, rateLimited, upstreamError } from '@/lib/api-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { getEvolutionClientForInstance } from '@/lib/evolution';
import { sendAlert } from '@/lib/alerts';
import { logger } from '@/lib/logger';
import {
  executeSendAttempt,
  EVOLUTION_ERROR_EFFECT,
  type BlockedVerdict,
  type CampaignSendContext,
  type SendAttemptResult,
} from '@inno/sending';

/**
 * 🆕 Fase 4.D, tipo agora definido em `@inno/sending` (Fase 4.F.1) — reexport
 * para quem já importava daqui não precisar mudar (nenhum call site externo
 * importava o TIPO por nome antes desta rodada; mantido por segurança).
 */
export type { CampaignSendContext };

const APP_TIMEZONE = () => process.env.APP_TIMEZONE || DEFAULT_SEND_WINDOW_CONFIG.timezone;

// ─────────────────────────────────────────────────────────────────────────
// Configuração — lida da env AQUI (a camada de serviço), nunca dentro de
// `@inno/core`/`@inno/sending` (que ficam puros/testáveis sem
// `process.env`, ver comentário em `packages/core/src/whatsapp/send-window.ts`
// e `packages/sending/src/ports.ts`).
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

/** 🆕 Fase 4.C — Cooldown de 2º contato frio (G9b, ARQUITETURA §4.9.10/§10 `COLD_FOLLOWUP_COOLDOWN_H`). */
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

/** Mesma granularidade de `InstanceDailyStat.date` (`@db.Date`, fuso `APP_TIMEZONE`). Duplicado de propósito de `lib/services/whatsapp-instances.ts#todayDateKey` (ver `convention-api-routes-fase1`, regra 4) — E o futuro `dispatch-tick.job` vai ter a SUA PRÓPRIA cópia (ARQUITETURA §6.8.0.4: risco explícito de fuso divergente entre web/worker, não deste pacote). */
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

async function loadInstanceCandidates(allowedInstanceIds?: readonly string[]): Promise<InstanceCandidate[]> {
  const instances = await prisma.whatsAppInstance.findMany(
    allowedInstanceIds ? { where: { id: { in: [...allowedInstanceIds] } } } : undefined,
  );
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

async function resolveInstanceForSend(
  leadId: string,
  requestedInstanceId: string | undefined,
  allowedInstanceIds?: readonly string[],
): Promise<InstanceCandidate> {
  if (requestedInstanceId) {
    // 🆕 Fase 4.D — disparo manual de campanha só pode escolher UMA das
    // instâncias que o operador colocou na campanha (`POST /campaigns`),
    // nunca qualquer instância do sistema.
    if (allowedInstanceIds && !allowedInstanceIds.includes(requestedInstanceId)) {
      conflict('Esta instância não faz parte da campanha.', [{ path: 'instanceId', message: requestedInstanceId }], 'INSTANCE_NOT_IN_CAMPAIGN');
    }
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
    loadInstanceCandidates(allowedInstanceIds),
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
// Ponto de entrada
// ─────────────────────────────────────────────────────────────────────────

export async function sendLeadMessage(
  leadId: string,
  input: SendLeadMessageBody,
  actor: { id: string; role: string },
  /** 🆕 Fase 4.D — só presente quando `lib/services/campaigns.ts#sendCampaignTargetMessage` chama isto para o disparo manual de um alvo. */
  campaignContext?: CampaignSendContext,
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
  const candidate = await resolveInstanceForSend(lead.id, input.instanceId, campaignContext?.allowedInstanceIds);
  const { instance } = candidate;

  // 🆕 Fase 4.B — resolve o cliente Evolution do SERVIDOR desta instância
  // ANTES da sequência protegida — política do CHAMADOR (ARQUITETURA
  // §6.8.0.1/§6.8.0.3), nunca de `@inno/sending`. Resolver aqui também evita
  // reservar cota para um envio que nem vai conseguir achar QUAL servidor
  // chamar — falha rápido, sem gastar write-ahead.
  const evolutionClient = await getEvolutionClientForInstance(instance);

  // G9 — última mensagem de saída (qualquer instância) + G10 — 1º contato
  // frio + 🆕 Fase 4.C — última mensagem de ENTRADA (G9b/`lastInboundAt`).
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

  const coldFollowupCooldownMs = coldFollowupCooldownMsFromEnv();

  // ── A sequência protegida (ARQUITETURA §6.8.0) — opt-out → guard →
  // write-ahead → sendText → contabilidade → cadência. Vive em
  // `@inno/sending`; este arquivo só monta as portas/entradas e traduz o
  // resultado abaixo. ──
  const result = await executeSendAttempt(
    {
      prisma,
      evolutionClient,
      logger,
      notify: sendAlert,
    },
    {
      lead: { id: lead.id, status: lead.status, phoneE164, phoneType },
      instance,
      text: finalText,
      quota: { sentToday: candidate.sentToday },
      today: todayDateKey(),
      lastOutboundAt: lastOutbound?.createdAt ?? null,
      lastInboundAt: lastInbound?.createdAt ?? null,
      isColdFirstContact,
      companyName: process.env.APP_COMPANY_NAME || null,
      overrides: {
        allowNonMobile: input.allowNonMobile,
        confirmOutsideBusinessWindow: input.confirmOutsideBusinessWindow,
        // 🆕 Fase 4.C — decisão registrada no handoff do Vega: o envio MANUAL é
        // sempre um humano na tela, então este serviço sempre PEDE o desvio.
        // Quem decide se ele VALE é só o guard (G9c em `send-guard.ts`), que o
        // anula sempre que `isColdFirstContact === true` — por isso é seguro
        // pedir incondicionalmente aqui.
        ignorePaceLock: true,
      },
      windowConfig: sendWindowConfigFromEnv(),
      duplicateWindowMs: duplicateWindowMsFromEnv(),
      coldFollowupCooldownMs,
      jitterRangeSeconds: jitterRangeSecondsFromEnv(),
      microPauseConfig: microPauseConfigFromEnv(),
      campaignContext,
      actor: { type: 'user', userId: actor.id },
      renderedTemplateId: renderedFrom?.templateId ?? null,
    },
  );

  // ── Tradução do `SendAttemptResult` em HTTP (ARQUITETURA §6.8.0.1:
  // "vocabulário HTTP fica em apps/web") — `if`s em sequência (não
  // `switch`), de propósito: `throwForBlockedVerdict`/`conflict`/
  // `mapSendErrorToApiError` são tipados `: never`, e o TypeScript ESTREITA
  // `result` para `{outcome:'sent'}` depois deles sem precisar de nenhuma
  // asserção — o mesmo padrão que `if (!lead) notFound(...)` já usa em toda
  // rota deste arquivo. Se um `outcome` novo nascer em `@inno/sending`, o uso
  // de `result` abaixo (`result.messageId`/`.providerMessageId`/...) para de
  // compilar — não vira decisão improvisada.
  if (result.outcome === 'blocked') {
    throwForBlockedVerdict(result.verdict, { optOutCreatedAt: result.optOutCreatedAt, timezone: APP_TIMEZONE(), coldFollowupCooldownMs });
  }
  if (result.outcome === 'expired') {
    conflict('O sistema demorou para processar o envio e a decisão anterior expirou. Tente novamente.', undefined, 'SEND_WINDOW_EXPIRED');
  }
  if (result.outcome === 'failed' || result.outcome === 'uncertain') {
    mapSendErrorToApiError(result);
  }
  const sent = result;

  const dailyLimitAfter = candidate.dailyLimit;
  const sentTodayAfter = candidate.sentToday + 1;

  return {
    message: {
      id: sent.messageId,
      leadId: lead.id,
      campaignTargetId: campaignContext?.targetId ?? null,
      instanceId: instance.id,
      direction: 'outbound',
      body: finalText,
      providerMessageId: sent.providerMessageId,
      status: 'sent',
      errorCode: null,
      sentAt: sent.sentAt.toISOString(),
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
    warnings: sent.warnings as SendLeadMessageWarning[],
  };
}

function throwForBlockedVerdict(
  verdict: BlockedVerdict,
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
  // saber QUANDO pode enviar de novo, não só que está bloqueado.
  if (reason === 'SEND_PACE_LOCKED' && meta?.nextSendAllowedAt) {
    conflict(message, [{ path: 'nextSendAllowedAt', message: String(meta.nextSendAllowedAt) }], reason);
  }
  // 🆕 Fase 4.C — mesmo requisito para o cooldown de 2º contato frio.
  if (reason === 'LEAD_CONTACT_COOLDOWN' && meta?.lastOutboundAt) {
    const resetsAt = new Date(new Date(String(meta.lastOutboundAt)).getTime() + ctx.coldFollowupCooldownMs);
    conflict(message, [{ path: 'resetsAt', message: resetsAt.toISOString() }], reason);
  }
  conflict(message, undefined, reason);
}

/** Nunca `500` para falha da Evolution (ARQUITETURA §4.9.5) — sempre `409` (nosso, regra de negócio) ou `502 UPSTREAM_ERROR` (defeito do provedor). `EVOLUTION_ERROR_EFFECT` (ÚNICA fonte, `@inno/sending`) decide qual dos dois. */
function mapSendErrorToApiError(result: Extract<SendAttemptResult, { outcome: 'failed' | 'uncertain' }>): never {
  const effect = EVOLUTION_ERROR_EFFECT[result.code];

  if (effect.httpStatus === 409) {
    conflict(result.message, undefined, result.reason);
  }
  upstreamError(result.message, result.reason);
}
