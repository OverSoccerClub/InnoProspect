/**
 * dispatch-tick.job.test.ts — o motor de disparo (ARQUITETURA §6.8.2-§6.8.9).
 * `executeSendAttempt` (`@inno/sending`) roda de VERDADE aqui (não mockado) —
 * é a integração real que prova que o tick não reimplementa a sequência
 * protegida. Só `resolveWorkerEvolutionClient` (rede/cifra) e
 * `isDispatchEnabled`/`recordDispatchTickHeartbeat` (Redis) são mockados —
 * ver `[[project-innoprospect]]`: sem Postgres/Redis nesta máquina, o que
 * ESTE arquivo prova é a lógica de decisão; o aceite real da fase é da Íris
 * com Evolution/Postgres de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { MessagingError } from '@inno/messaging';

vi.mock('../observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

const resolveWorkerEvolutionClient = vi.fn();
vi.mock('../lib/evolution.js', () => ({ resolveWorkerEvolutionClient }));

const isDispatchEnabled = vi.fn();
const recordDispatchTickHeartbeat = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/dispatch-state.js', () => ({ isDispatchEnabled, recordDispatchTickHeartbeat }));

const { runDispatchTick, translateBlockedVerdict } = await import('./dispatch-tick.job.js');
const { fakePrismaClient, resetFakeDispatchDb, getFakeDispatchDbState } = await import('../test/fake-dispatch-db.js');
const { DEFAULT_SEND_WINDOW_CONFIG } = await import('@inno/core');

const FAKE_QUEUE = {} as unknown as Queue;

// Quarta-feira, 11h em America/Sao_Paulo (UTC-3) — dentro do piso duro
// (8-20) E da janela comercial padrão (9-18), fora da pausa de almoço.
const OPEN_NOW = new Date('2026-09-30T14:00:00.000Z');
// Mesmo dia, 20h em America/Sao_Paulo — fora da janela comercial (mas ainda
// dentro do piso duro, só para não confundir os dois níveis no teste).
const CLOSED_NOW = new Date('2026-09-30T23:00:00.000Z');

const ENV_KEYS = [
  'APP_TIMEZONE',
  'APP_COMPANY_NAME',
  'DISPATCH_UNCERTAIN_DEGRADE_AT',
  'DISPATCH_UNCERTAIN_HALT_AT',
  'DISPATCH_LEASE_S',
  'DISPATCH_MAX_ATTEMPTS',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

type BaseInstanceFields = {
  id: string;
  name: string;
  status: string;
  isDegraded: boolean;
  consecutiveFailures: number;
  consecutiveUncertain: number;
  warmupDay: number;
  dailyLimitOverride: number | null;
  nextSendAllowedAt: Date | null;
  sendsSinceMicroPause: number;
  evolutionServerId: string | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

function baseInstance(overrides: Partial<BaseInstanceFields> = {}): BaseInstanceFields {
  return {
    id: 'inst-1',
    name: 'Instância 1',
    status: 'connected',
    isDegraded: false,
    consecutiveFailures: 0,
    consecutiveUncertain: 0,
    warmupDay: 30,
    dailyLimitOverride: null,
    nextSendAllowedAt: null,
    sendsSinceMicroPause: 0,
    evolutionServerId: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'camp-1',
    status: 'running',
    startedAt: OPEN_NOW,
    finishedAt: null,
    haltReason: null,
    renderedTemplateSnapshot: 'Oi {{primeiro_nome}}, aqui é a Empresa Teste. Responda SAIR para não receber mais.',
    sendWindowStartHour: 9,
    sendWindowEndHour: 18,
    sendWindowDaysOfWeek: [1, 2, 3, 4, 5],
    jitterMinSeconds: 45,
    jitterMaxSeconds: 180,
    dailyLimitPerInstance: null,
    totalTargets: 1,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    respondedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

function baseLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    name: 'Padaria do João',
    uf: 'SP',
    category: 'padaria',
    website: null,
    phoneE164: '+5511900000001',
    phoneType: 'mobile',
    status: 'new',
    cityName: 'São Paulo',
    ...overrides,
  };
}

function baseTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    campaignId: 'camp-1',
    leadId: 'lead-1',
    phoneE164: '+5511900000001',
    status: 'pending',
    skipReason: null,
    scheduledFor: new Date(0), // sempre "devido"
    attempt: 0,
    sentAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function fakeEvolutionClient(sendTextImpl: (instanceName: string, payload: { to: string; text: string }) => Promise<{ providerMessageId: string }>) {
  return { sendText: vi.fn(sendTextImpl) };
}

function makeDeps(overrides: Partial<{ now: () => Date; notify: (e: unknown) => void | Promise<void> }> = {}) {
  return {
    prisma: fakePrismaClient as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    notify: overrides.notify ?? vi.fn(),
    dispatchQueue: FAKE_QUEUE,
    now: overrides.now ?? (() => OPEN_NOW),
    rng: () => 0.5,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  process.env.APP_TIMEZONE = 'America/Sao_Paulo';
  process.env.APP_COMPANY_NAME = 'Empresa Teste';
  delete process.env.DISPATCH_UNCERTAIN_DEGRADE_AT;
  delete process.env.DISPATCH_UNCERTAIN_HALT_AT;
  delete process.env.DISPATCH_LEASE_S;
  delete process.env.DISPATCH_MAX_ATTEMPTS;
  resetFakeDispatchDb();
  resolveWorkerEvolutionClient.mockReset();
  isDispatchEnabled.mockReset().mockResolvedValue(true);
  recordDispatchTickHeartbeat.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Passo 1 — pausa global e heartbeat
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — passo 1 (pausa global, ARQUITETURA §6.8.9)', () => {
  it('motor pausado: heartbeat É gravado, mas nenhuma campanha é lida', async () => {
    isDispatchEnabled.mockResolvedValue(false);
    const findManySpy = vi.spyOn(fakePrismaClient.campaign, 'findMany');

    await runDispatchTick(makeDeps());

    expect(recordDispatchTickHeartbeat).toHaveBeenCalledTimes(1);
    expect(findManySpy).not.toHaveBeenCalled();
    findManySpy.mockRestore();
  });

  it('motor ligado: heartbeat também é gravado (sempre, incondicional)', async () => {
    isDispatchEnabled.mockResolvedValue(true);
    resetFakeDispatchDb({ campaigns: [] });

    await runDispatchTick(makeDeps());

    expect(recordDispatchTickHeartbeat).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Passo 2.1 — janela da campanha
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — passo 2.1 (janela da campanha)', () => {
  it('janela fechada: reagenda os alvos pendentes devidos para a próxima abertura, NÃO envia', async () => {
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance()],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps({ now: () => CLOSED_NOW }));

    const target = getFakeDispatchDbState().campaignTargets.find((t) => t.id === 'target-1')!;
    expect(target.status).toBe('pending');
    expect(target.scheduledFor!.getTime()).toBeGreaterThan(CLOSED_NOW.getTime());
    expect(resolveWorkerEvolutionClient).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Passo 2.2 — elegibilidade de instância: conexão vs cota/gate
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — passo 2.2 (elegibilidade de instância)', () => {
  it('nenhuma instância CONECTADA: halt da campanha + alerta próprio (causa é conexão)', async () => {
    const notify = vi.fn();
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance({ status: 'disconnected' })],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps({ notify }));

    const campaign = getFakeDispatchDbState().campaigns.find((c) => c.id === 'camp-1')!;
    expect(campaign.status).toBe('halted');
    expect(campaign.haltReason).toContain('Nenhuma instância conectada');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dispatch_campaign_halted_no_connected_instance', campaignId: 'camp-1' }));
  });

  it('instância conectada mas SEM cota (quota/gate): não faz nada neste tick, NÃO halta', async () => {
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance({ warmupDay: 1 })], // teto do dia 1 = 20
      instanceDailyStats: [{ instanceId: 'inst-1', date: new Date('2026-09-30T00:00:00.000Z'), sentCount: 20, failedCount: 0 }],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps());

    const campaign = getFakeDispatchDbState().campaigns.find((c) => c.id === 'camp-1')!;
    expect(campaign.status).toBe('running');
    expect(campaign.haltReason).toBeNull();
    expect(resolveWorkerEvolutionClient).not.toHaveBeenCalled();
  });

  it('instância conectada mas com gate (nextSendAllowedAt no futuro): não faz nada, NÃO halta', async () => {
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance({ nextSendAllowedAt: new Date(OPEN_NOW.getTime() + 60_000) })],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps());

    expect(getFakeDispatchDbState().campaigns[0]!.status).toBe('running');
    expect(resolveWorkerEvolutionClient).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Envio com sucesso — prova que o tick delega para @inno/sending de verdade
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — envio com sucesso', () => {
  it('claim + render + sendText + write-ahead avançam CampaignTarget/CampaignInstance (via executeSendAttempt real)', async () => {
    const client = fakeEvolutionClient(async () => ({ providerMessageId: 'wamid-1' }));
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance()],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps());

    expect(client.sendText).toHaveBeenCalledTimes(1);
    const [, payload] = client.sendText.mock.calls[0]!;
    expect(payload.to).toBe('+5511900000001');
    expect(payload.text).toContain('Padaria'); // {{primeiro_nome}} resolvido (firstName de "Padaria do João")

    const state = getFakeDispatchDbState();
    const target = state.campaignTargets.find((t) => t.id === 'target-1')!;
    expect(target.status).toBe('sent');
    expect(state.campaigns[0]!.sentCount).toBe(1);
    expect(state.campaignInstances[0]!.sentCount).toBe(1);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.campaignTargetId).toBe('target-1');
    expect(state.messages[0]!.providerMessageId).toBe('wamid-1');
  });

  it('campanha sem mais nenhum alvo pending depois do envio → completed', async () => {
    const client = fakeEvolutionClient(async () => ({ providerMessageId: 'wamid-1' }));
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance()],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });

    await runDispatchTick(makeDeps());

    const campaign = getFakeDispatchDbState().campaigns.find((c) => c.id === 'camp-1')!;
    expect(campaign.status).toBe('completed');
    expect(campaign.finishedAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔒 A garantia dura contra duplicidade é o @unique, não o lease (§6.8.2)
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — retomada sem duplicar mensagem', () => {
  it('alvo já tem um Message write-ahead (retomada depois de crash simulado): a 2ª tentativa aborta pelo @unique, sendText NUNCA é chamado de novo', async () => {
    const client = fakeEvolutionClient(async () => ({ providerMessageId: 'wamid-novo' }));
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance()],
      leads: [baseLead()],
      // Alvo ainda "pending" (o writer anterior nunca chegou a avançar o
      // status), mas JÁ existe um Message write-ahead para ele — simula o
      // worker morrendo entre o write-ahead e a atualização de status, e um
      // segundo claim (lease expirado) tentando de novo.
      campaignTargets: [baseTarget({ attempt: 1 })],
      messages: [
        {
          id: 'msg-existente',
          leadId: 'lead-1',
          instanceId: 'inst-1',
          direction: 'outbound',
          body: 'tentativa anterior',
          status: 'queued',
          campaignTargetId: 'target-1',
          providerMessageId: null,
          errorCode: null,
          errorMessage: null,
          sentAt: null,
          createdAt: new Date(0),
        },
      ],
    });

    await runDispatchTick(makeDeps());

    // Não lançou pro chamador (o erro é engolido no nível da campanha,
    // `runDispatchTick` nunca propaga) — e o mais importante:
    expect(client.sendText).not.toHaveBeenCalled();
    expect(getFakeDispatchDbState().messages).toHaveLength(1); // nenhuma 2ª Message criada
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Resultado incerto (§6.8.6) — cota NÃO volta, consecutiveFailures intacto,
// consecutiveUncertain sobe, e os dois patamares (3→degrade, 5→halt).
// ─────────────────────────────────────────────────────────────────────────

describe('runDispatchTick — resultado INCERTO (§6.8.6)', () => {
  function seedForUncertain(consecutiveUncertainBefore: number) {
    resetFakeDispatchDb({
      campaigns: [baseCampaign()],
      campaignInstances: [{ id: 'ci-1', campaignId: 'camp-1', instanceId: 'inst-1', sentCount: 0, failedCount: 0 }],
      whatsAppInstances: [baseInstance({ consecutiveUncertain: consecutiveUncertainBefore, consecutiveFailures: 0 })],
      leads: [baseLead()],
      campaignTargets: [baseTarget()],
    });
  }

  it('TIMEOUT: alvo vira failed/EVOLUTION_SEND_UNCERTAIN, cota do dia NÃO é revertida, consecutiveFailures intacto', async () => {
    const client = fakeEvolutionClient(async () => {
      throw new MessagingError('TIMEOUT', 'sem resposta a tempo');
    });
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    seedForUncertain(0);

    await runDispatchTick(makeDeps());

    const state = getFakeDispatchDbState();
    const target = state.campaignTargets.find((t) => t.id === 'target-1')!;
    expect(target.status).toBe('failed');
    expect(target.skipReason).toBe('EVOLUTION_SEND_UNCERTAIN');
    // Write-ahead incrementou sentCount para 1 (§4.9.5) — incerto NÃO reverte.
    expect(state.instanceDailyStats[0]!.sentCount).toBe(1);
    expect(state.instanceDailyStats[0]!.failedCount).toBe(0);
    const instance = state.whatsAppInstances.find((i) => i.id === 'inst-1')!;
    expect(instance.consecutiveFailures).toBe(0);
    expect(instance.consecutiveUncertain).toBe(1);
  });

  it('≥3 incertos seguidos: instância some da elegibilidade (fora da rotação) + alerta próprio', async () => {
    const notify = vi.fn();
    const client = fakeEvolutionClient(async () => {
      throw new MessagingError('TRANSIENT_ERROR', 'erro transiente');
    });
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    seedForUncertain(2); // este envio será o 3º seguido

    await runDispatchTick(makeDeps({ notify }));

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dispatch_instance_uncertain_degraded', instanceId: 'inst-1', consecutiveUncertain: 3, threshold: 3 }),
    );
    // A campanha NÃO haltou por causa disso (3 é "fora da rotação neste ciclo", não halt) — com um único alvo (que já terminou), ela conclui normalmente.
    expect(getFakeDispatchDbState().campaigns[0]!.status).toBe('completed');
  });

  it('≥5 incertos seguidos: HALT da campanha + alerta campaign_halted', async () => {
    const notify = vi.fn();
    const client = fakeEvolutionClient(async () => {
      throw new MessagingError('TIMEOUT', 'sem resposta a tempo');
    });
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    seedForUncertain(4); // este envio será o 5º seguido

    await runDispatchTick(makeDeps({ notify }));

    const campaign = getFakeDispatchDbState().campaigns[0]!;
    expect(campaign.status).toBe('halted');
    expect(campaign.haltReason).toContain('incerto repetido');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'campaign_halted', campaignIds: ['camp-1'], instanceId: 'inst-1' }));
  });

  it('sucesso ZERA consecutiveUncertain (comportamento de @inno/sending, herdado sem reimplementação)', async () => {
    const client = fakeEvolutionClient(async () => ({ providerMessageId: 'wamid-ok' }));
    resolveWorkerEvolutionClient.mockResolvedValue({ outcome: 'resolved', client });
    seedForUncertain(4);

    await runDispatchTick(makeDeps());

    const instance = getFakeDispatchDbState().whatsAppInstances.find((i) => i.id === 'inst-1')!;
    expect(instance.consecutiveUncertain).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 🔒 §6.8.5 — tradução do veredito do guard em estado do alvo, tabela-dirigida
// ─────────────────────────────────────────────────────────────────────────

describe('translateBlockedVerdict — tabela do §6.8.5, linha a linha', () => {
  const ctx = { now: OPEN_NOW, timezone: 'America/Sao_Paulo', window: DEFAULT_SEND_WINDOW_CONFIG };

  it('OPTED_OUT → skip/opted_out', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'OPTED_OUT', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'skip', skipReason: 'opted_out' });
  });

  it('LEAD_NOT_MOBILE → skip/landline', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'LEAD_NOT_MOBILE', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'skip', skipReason: 'landline' });
  });

  it('LEAD_CONTACT_COOLDOWN → skip/recently_contacted', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'LEAD_CONTACT_COOLDOWN', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'skip', skipReason: 'recently_contacted' });
  });

  it('DUPLICATE_SEND → skip/recently_contacted', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'DUPLICATE_SEND', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'skip', skipReason: 'recently_contacted' });
  });

  it('QUIET_HOURS → reschedule (próxima abertura)', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'QUIET_HOURS', message: 'x' }, ctx);
    expect(result.action).toBe('reschedule');
    expect((result as { scheduledFor: Date }).scheduledFor.getTime()).toBeGreaterThan(ctx.now.getTime());
  });

  it('OUTSIDE_BUSINESS_WINDOW → reschedule, usa nextWindowOpensAt do meta quando presente', () => {
    const metaOpen = new Date(ctx.now.getTime() + 3_600_000).toISOString();
    const result = translateBlockedVerdict(
      { allow: false, reason: 'OUTSIDE_BUSINESS_WINDOW', message: 'x', meta: { nextWindowOpensAt: metaOpen } },
      ctx,
    );
    expect(result).toEqual({ action: 'reschedule', scheduledFor: new Date(metaOpen) });
  });

  it('DAILY_LIMIT_REACHED → reschedule para a abertura do PRÓXIMO dia (não hoje)', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'DAILY_LIMIT_REACHED', message: 'x' }, ctx);
    expect(result.action).toBe('reschedule');
    const scheduledFor = (result as { scheduledFor: Date }).scheduledFor;
    expect(scheduledFor.getTime()).toBeGreaterThan(ctx.now.getTime());
    // Tem que cair no dia seguinte (>=24h de folga a partir de "agora", já que "agora" está em pleno expediente).
    expect(scheduledFor.getTime() - ctx.now.getTime()).toBeGreaterThan(12 * 60 * 60 * 1000);
  });

  it('SEND_PACE_LOCKED → reschedule usando nextSendAllowedAt do meta', () => {
    const nextAllowed = new Date(ctx.now.getTime() + 45_000).toISOString();
    const result = translateBlockedVerdict(
      { allow: false, reason: 'SEND_PACE_LOCKED', message: 'x', meta: { nextSendAllowedAt: nextAllowed } },
      ctx,
    );
    expect(result).toEqual({ action: 'reschedule', scheduledFor: new Date(nextAllowed) });
  });

  it('INSTANCE_NOT_CONNECTED → reschedule para agora (a instância sai da rotação por conta própria)', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'INSTANCE_NOT_CONNECTED', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'reschedule', scheduledFor: ctx.now });
  });

  it('INSTANCE_BANNED → reschedule para agora', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'INSTANCE_BANNED', message: 'x' }, ctx);
    expect(result).toEqual({ action: 'reschedule', scheduledFor: ctx.now });
  });

  it('MISSING_OPTOUT_NOTICE → halt (nunca skip — é erro de configuração, não do alvo)', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'MISSING_OPTOUT_NOTICE', message: 'sem aviso' }, ctx);
    expect(result.action).toBe('halt');
    expect((result as { haltReason: string }).haltReason).toContain('MISSING_OPTOUT_NOTICE');
  });

  it('MISSING_COMPANY_NAME → halt', () => {
    const result = translateBlockedVerdict({ allow: false, reason: 'MISSING_COMPANY_NAME', message: 'sem empresa' }, ctx);
    expect(result.action).toBe('halt');
  });
});

