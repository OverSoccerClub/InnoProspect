/**
 * mocks/campaigns.ts — Fase 4.E (ARQUITETURA §4.5). Contra o contrato
 * publicado em `packages/contracts/src/campaign.contract.ts` — inclui o 6º
 * motivo de exclusão (`alreadyTargeted`) e o disparo manual por alvo
 * (`.../targets/:targetId/send`), os dois publicados pelo Vega em paralelo a
 * esta rodada. `PATCH /campaigns/:id` também existe no contrato mas não é
 * consumido por nenhuma tela ainda (fora do escopo desta entrega — ver
 * PENDÊNCIAS do handoff). Detalhe do histórico em `types/campaign.ts`.
 *
 * Import de mão única: importa de `mocks/leads.ts`, `mocks/templates.ts` e
 * `mocks/whatsapp.ts`; nenhum desses três importa daqui — evita ciclo ESM
 * entre módulos de mock com estado mutável (mesma convenção já usada entre
 * `mocks/whatsapp.ts` e `mocks/evolution-servers.ts`).
 */
import { computeCampaignAudience } from '@/lib/campaign-audience';
import { computeCampaignEstimate } from '@/lib/campaign-estimate';
import { deriveCampaignRates, deriveCampaignStats } from '@/lib/campaign-progress';
import { formatDateTime } from '@/lib/format';
import { evaluateSendWindow } from '@/lib/send-window';
import { mulberry32 } from '@/lib/utils';
import type {
  CampaignDetail,
  CampaignInstanceProgress,
  CampaignStatus,
  CampaignSummary,
  CampaignTargetItem,
  CampaignTargetStatus,
  CancelCampaignResponse,
  CreateCampaignRequest,
  CreateCampaignResponse,
  ListCampaignsQuery,
  ListCampaignTargetsQuery,
  PauseCampaignResponse,
  ResumeCampaignRequest,
  ResumeCampaignResponse,
  SendCampaignTargetRequest,
  SendCampaignTargetResponse,
  StartCampaignResponse,
} from '@/types/campaign';
import type { LeadListItem, MessageItem } from '@/types/lead';
import { mockFindLeadsForAudience } from './leads';
import { mockGetTemplate } from './templates';
import { mockConflict, mockNotFound, mockValidationError } from './utils';
import { mockFindInstanceRaw, mockReserveInstanceQuota } from './whatsapp';

/** ARQUITETURA §4.5.4 — teto de sanidade: acima disso, o `POST` recusa (fatiar é responsabilidade de quem chama). */
const CAMPAIGN_MAX_TARGETS = 5000;

const DEFAULT_SEND_WINDOW = { startHour: 9, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] };
const DEFAULT_JITTER = { min: 30, max: 90 };
const DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS = 30;

type MockCampaignTarget = {
  id: string;
  leadId: string;
  leadName: string;
  phoneE164: string;
  attempt: number;
  messagePreview: string | null;
  /** Round-robin fixado na criação — de qual instância ESTE alvo sai quando enviado (`perInstance`, ARQUITETURA §4.5.8). */
  instanceId: string;
  /**
   * Estado final "combinado" (não depende do tempo) para campanhas que não
   * são a demo `live` — computado uma vez no seed, igual a
   * `mocks/searches.ts` para jobs não-live.
   */
  fixedStatus?: CampaignTargetStatus;
  fixedSkipReason?: string | null;
  /** Só usados quando a campanha é `live` — ver `deriveLiveTargetView`. */
  simSendOffsetMs?: number;
  simResolveOffsetMs?: number;
  simFinalStatus?: CampaignTargetStatus;
  /**
   * Disparo MANUAL (`POST .../targets/:targetId/send`, ARQUITETURA §4.5,
   * "🆕 Fase 4.D") — vence `fixedStatus`/simulação por tempo, nas duas
   * situações: sem motor automático (Fase 4.F ainda não existe), é a ÚNICA
   * forma de um alvo `pending` avançar. Sem este campo, disparar
   * manualmente um alvo da campanha-demo `live` não teria efeito nenhum na
   * tela (a simulação por tempo ignoraria a mutação).
   */
  manualStatus?: CampaignTargetStatus;
  manualSentAt?: string;
};

type MockCampaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  templateId: string;
  templateName: string;
  renderedTemplateSnapshot: string | null;
  instanceIds: string[];
  settings: {
    dailyLimitPerInstance: number;
    sendWindow: typeof DEFAULT_SEND_WINDOW;
    jitterSeconds: typeof DEFAULT_JITTER;
    skipRecentlyContactedDays: number;
  };
  targets: MockCampaignTarget[];
  createdAt: string;
  startedAtMs: number | null;
  finishedAt: string | null;
  haltReason: string | null;
  /**
   * `true` só para a campanha de demonstração cujo progresso avança com o
   * tempo real (mesma ideia de `MockJob.live` em `mocks/searches.ts`) — as
   * outras têm `fixedStatus` por alvo, congelado no seed.
   */
  live: boolean;
};

let seq = 100;
let campaigns: MockCampaign[] | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────

function makeFixedTargets(
  count: number,
  instanceIds: string[],
  statusPlan: (index: number) => { status: CampaignTargetStatus; skipReason?: string },
): MockCampaignTarget[] {
  const random = mulberry32(count * 7 + instanceIds.length);
  return Array.from({ length: count }, (_, index) => {
    const { status, skipReason } = statusPlan(index);
    return {
      id: `tgt_seed_${index}_${Math.floor(random() * 1e6)}`,
      leadId: `lead_seed_${index}`,
      leadName: `Empresa Demo ${index + 1}`,
      phoneE164: `+551199988${String(1000 + index).slice(-4)}`,
      attempt: status === 'pending' ? 0 : 1,
      messagePreview: status === 'pending' ? null : 'Olá, tudo bem? Aqui é da nossa empresa...',
      instanceId: instanceIds[index % instanceIds.length]!,
      fixedStatus: status,
      fixedSkipReason: skipReason ?? null,
    };
  });
}

function makeLiveTargets(count: number, instanceIds: string[]): MockCampaignTarget[] {
  const random = mulberry32(count * 13 + 91);
  return Array.from({ length: count }, (_, index) => {
    // Espalha os envios nos primeiros ~50s (jitter simulado) e a resolução
    // (entrega/leitura/resposta/falha) mais 2-8s depois de enviado — dá pra
    // ver a campanha "andar" numa janela curta de observação, sem esperar
    // dias de verdade.
    const sendOffsetMs = Math.floor((index / count) * 50_000) + Math.floor(random() * 3_000);
    const resolveOffsetMs = sendOffsetMs + 2_000 + Math.floor(random() * 6_000);
    const roll = random();
    const finalStatus: CampaignTargetStatus = roll < 0.08 ? 'failed' : roll < 0.35 ? 'responded' : roll < 0.55 ? 'read' : 'delivered';
    return {
      id: `tgt_live_${index}`,
      leadId: `lead_live_${index}`,
      leadName: `Empresa Demo ${index + 1}`,
      phoneE164: `+551198877${String(2000 + index).slice(-4)}`,
      attempt: 0,
      messagePreview: null,
      instanceId: instanceIds[index % instanceIds.length]!,
      simSendOffsetMs: sendOffsetMs,
      simResolveOffsetMs: resolveOffsetMs,
      simFinalStatus: finalStatus,
    };
  });
}

function seedIfNeeded() {
  if (campaigns) return;
  const now = Date.now();

  campaigns = [
    {
      id: 'camp_draft_demo',
      name: 'Clínicas odontológicas — SP (rascunho)',
      status: 'draft',
      templateId: 'tpl_1',
      templateName: 'Primeiro contato — genérico',
      renderedTemplateSnapshot: null,
      instanceIds: ['wa_1'],
      settings: {
        dailyLimitPerInstance: 300,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeFixedTargets(18, ['wa_1'], () => ({ status: 'pending' })),
      createdAt: new Date(now - 3_600_000).toISOString(),
      startedAtMs: null,
      finishedAt: null,
      haltReason: null,
      live: false,
    },
    {
      id: 'camp_running_demo',
      name: 'Escritórios de advocacia — MG',
      status: 'running',
      templateId: 'tpl_1',
      templateName: 'Primeiro contato — genérico',
      renderedTemplateSnapshot:
        '{Olá|Oi|Bom dia}, tudo bem? Aqui é da {{minha_empresa}}. {Vi que|Notei que} a {{nome}} {atende|trabalha} em {{cidade}}...\n\nSe preferir não receber mais mensagens, responda SAIR.',
      instanceIds: ['wa_1', 'wa_2'],
      settings: {
        dailyLimitPerInstance: 250,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeLiveTargets(42, ['wa_1', 'wa_2']),
      createdAt: new Date(now - 300_000).toISOString(),
      startedAtMs: now - 20_000,
      finishedAt: null,
      haltReason: null,
      live: true,
    },
    {
      id: 'camp_paused_demo',
      name: 'Pet shops — RJ',
      status: 'paused',
      templateId: 'tpl_2',
      templateName: 'Follow-up sem resposta',
      renderedTemplateSnapshot: 'Oi, passando para saber se você viu minha mensagem anterior. Se preferir não receber mais mensagens, responda SAIR.',
      instanceIds: ['wa_1'],
      settings: {
        dailyLimitPerInstance: 200,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeFixedTargets(30, ['wa_1'], (i) => {
        if (i < 12) return { status: 'delivered' };
        if (i < 14) return { status: 'failed' };
        return { status: 'pending' };
      }),
      createdAt: new Date(now - 86_400_000).toISOString(),
      startedAtMs: now - 80_000_000,
      finishedAt: null,
      haltReason: null,
      live: false,
    },
    {
      id: 'camp_halted_demo',
      name: 'Academias — MG (interrompida)',
      status: 'halted',
      templateId: 'tpl_1',
      templateName: 'Primeiro contato — genérico',
      renderedTemplateSnapshot: 'Olá, tudo bem? Aqui é da nossa empresa...\n\nSe preferir não receber mais mensagens, responda SAIR.',
      // `wa_3` está desconectada no seed de `mocks/whatsapp.ts` — retomar
      // esta campanha deve continuar recusando com `INSTANCE_NOT_CONNECTED`
      // até alguém reconectar o número de verdade, mesmo com `acknowledgeHalt`.
      instanceIds: ['wa_3'],
      settings: {
        dailyLimitPerInstance: 40,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeFixedTargets(20, ['wa_3'], (i) => {
        if (i < 5) return { status: 'delivered' };
        return { status: 'pending' };
      }),
      createdAt: new Date(now - 172_800_000).toISOString(),
      startedAtMs: now - 170_000_000,
      finishedAt: null,
      haltReason: 'A instância "Backup — desconectado" caiu no meio do envio. Revise a conexão antes de retomar.',
      live: false,
    },
    {
      id: 'camp_completed_demo',
      name: 'Salões de beleza — SP',
      status: 'completed',
      templateId: 'tpl_2',
      templateName: 'Follow-up sem resposta',
      renderedTemplateSnapshot: 'Oi, passando para saber se você viu minha mensagem anterior. Se preferir não receber mais mensagens, responda SAIR.',
      instanceIds: ['wa_1'],
      settings: {
        dailyLimitPerInstance: 300,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeFixedTargets(25, ['wa_1'], (i) => {
        if (i < 20) return { status: 'read' as CampaignTargetStatus };
        if (i < 23) return { status: 'responded' as CampaignTargetStatus };
        return { status: 'failed' as CampaignTargetStatus };
      }),
      createdAt: new Date(now - 7 * 86_400_000).toISOString(),
      startedAtMs: now - 6 * 86_400_000,
      finishedAt: new Date(now - 5 * 86_400_000).toISOString(),
      haltReason: null,
      live: false,
    },
    {
      id: 'camp_cancelled_demo',
      name: 'Lojas de roupas — RJ (cancelada)',
      status: 'cancelled',
      templateId: 'tpl_1',
      templateName: 'Primeiro contato — genérico',
      renderedTemplateSnapshot: 'Olá! Aqui é da nossa empresa...\n\nSe preferir não receber mais mensagens, responda SAIR.',
      instanceIds: ['wa_1'],
      settings: {
        dailyLimitPerInstance: 300,
        sendWindow: DEFAULT_SEND_WINDOW,
        jitterSeconds: DEFAULT_JITTER,
        skipRecentlyContactedDays: DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
      },
      targets: makeFixedTargets(15, ['wa_1'], (i) => {
        if (i < 4) return { status: 'delivered' as CampaignTargetStatus };
        return { status: 'skipped' as CampaignTargetStatus, skipReason: 'campaign_cancelled' };
      }),
      createdAt: new Date(now - 10 * 86_400_000).toISOString(),
      startedAtMs: now - 9 * 86_400_000,
      finishedAt: new Date(now - 9 * 86_400_000 + 3_600_000).toISOString(),
      haltReason: null,
      live: false,
    },
  ];
}

function getCampaigns(): MockCampaign[] {
  seedIfNeeded();
  return campaigns!;
}

// ─────────────────────────────────────────────────────────────────────────
// Derivação de status ao vivo — mesma ideia de `mocks/searches.ts`
// (`computeSummary`/elapsed): NUNCA muta o array armazenado a cada leitura,
// só deriva o estado ATUAL a partir do tempo decorrido desde `startedAtMs`.
// A única mutação real é a transição final campanha `running` → `completed`
// quando todos os alvos já resolveram (ver `syncLiveCompletion`).
// ─────────────────────────────────────────────────────────────────────────

function deriveTargetStatus(target: MockCampaignTarget, campaign: MockCampaign): { status: CampaignTargetStatus; scheduledFor: string | null; sentAt: string | null } {
  if (target.manualStatus) {
    return { status: target.manualStatus, scheduledFor: null, sentAt: target.manualSentAt ?? nowIso() };
  }
  if (!campaign.live || campaign.startedAtMs === null) {
    return {
      status: target.fixedStatus ?? 'pending',
      scheduledFor:
        (target.fixedStatus ?? 'pending') === 'pending' && (campaign.status === 'running' || campaign.status === 'scheduled')
          ? campaign.createdAt
          : null,
      sentAt: (target.fixedStatus ?? 'pending') === 'pending' ? null : campaign.createdAt,
    };
  }

  const elapsed = Date.now() - campaign.startedAtMs;
  const sendOffset = target.simSendOffsetMs ?? 0;
  const resolveOffset = target.simResolveOffsetMs ?? 0;

  if (elapsed < sendOffset) {
    return { status: 'pending', scheduledFor: new Date(campaign.startedAtMs + sendOffset).toISOString(), sentAt: null };
  }
  const sentAt = new Date(campaign.startedAtMs + sendOffset).toISOString();
  if (elapsed < resolveOffset) {
    return { status: 'sent', scheduledFor: null, sentAt };
  }
  return { status: target.simFinalStatus ?? 'delivered', scheduledFor: null, sentAt };
}

function toTargetItem(target: MockCampaignTarget, campaign: MockCampaign): CampaignTargetItem {
  const { status, scheduledFor, sentAt } = deriveTargetStatus(target, campaign);
  return {
    id: target.id,
    leadId: target.leadId,
    leadName: target.leadName,
    phoneE164: target.phoneE164,
    status,
    skipReason: status === 'skipped' ? target.fixedSkipReason ?? null : null,
    attempt: status === 'pending' ? 0 : Math.max(1, target.attempt),
    scheduledFor,
    sentAt,
    messagePreview: status === 'pending' ? null : target.messagePreview ?? 'Prévia não disponível.',
  };
}

/** Campanha `live` cujos alvos já resolveram todos (nenhum pending/sent restante) vira `completed` — mutação real, única deste arquivo. */
function syncLiveCompletion(campaign: MockCampaign): void {
  if (!campaign.live || campaign.status !== 'running') return;
  const items = campaign.targets.map((t) => toTargetItem(t, campaign));
  const stillInFlight = items.some((t) => t.status === 'pending' || t.status === 'sent');
  if (!stillInFlight) {
    campaign.status = 'completed';
    campaign.finishedAt = nowIso();
  }
}

function computePerInstance(campaign: MockCampaign, items: CampaignTargetItem[]): CampaignInstanceProgress[] {
  return campaign.instanceIds.map((instanceId) => {
    const raw = mockFindInstanceRaw(instanceId);
    const assigned = campaign.targets.filter((t) => t.instanceId === instanceId);
    const assignedItems = assigned.map((t) => items.find((i) => i.id === t.id)!);
    const sent = assignedItems.filter((i) => i.status === 'sent' || i.status === 'delivered' || i.status === 'read' || i.status === 'responded').length;
    const failed = assignedItems.filter((i) => i.status === 'failed').length;
    const dailyLimit = campaign.settings.dailyLimitPerInstance || raw?.warmup.dailyLimit || 0;
    return {
      instanceId,
      name: raw?.name ?? instanceId,
      sent,
      failed,
      quotaRemaining: Math.max(0, dailyLimit - sent),
      status: raw?.status ?? 'disconnected',
    };
  });
}

function toSummary(campaign: MockCampaign): CampaignSummary {
  syncLiveCompletion(campaign);
  const items = campaign.targets.map((t) => toTargetItem(t, campaign));
  const stats = deriveCampaignStats(items);
  const rates = deriveCampaignRates(stats);
  const pendingScheduled = items.filter((i) => i.status === 'pending' && i.scheduledFor).map((i) => i.scheduledFor as string);
  const nextSendAt =
    (campaign.status === 'running' || campaign.status === 'scheduled') && pendingScheduled.length > 0
      ? pendingScheduled.sort()[0]!
      : null;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    templateName: campaign.templateName,
    instanceCount: campaign.instanceIds.length,
    stats,
    rates,
    haltReason: campaign.haltReason,
    createdAt: campaign.createdAt,
    startedAt: campaign.startedAtMs !== null ? new Date(campaign.startedAtMs).toISOString() : null,
    finishedAt: campaign.finishedAt,
    nextSendAt,
  };
}

function toDetail(campaign: MockCampaign): CampaignDetail {
  syncLiveCompletion(campaign);
  const items = campaign.targets.map((t) => toTargetItem(t, campaign));
  return {
    ...toSummary(campaign),
    settings: campaign.settings,
    renderedTemplateSnapshot: campaign.renderedTemplateSnapshot,
    perInstance: computePerInstance(campaign, items),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/campaigns
// ─────────────────────────────────────────────────────────────────────────

function encodeCursor(index: number): string {
  return btoa(String(index));
}
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    return Number(atob(cursor)) || 0;
  } catch {
    return 0;
  }
}

export function mockListCampaigns(params: ListCampaignsQuery) {
  let all = getCampaigns().map(toSummary).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (params.status) all = all.filter((c) => c.status === params.status);
  if (params.q) {
    const q = params.q.toLowerCase();
    all = all.filter((c) => c.name.toLowerCase().includes(q) || c.templateName.toLowerCase().includes(q));
  }
  const limit = Math.min(100, params.limit ?? 25);
  const start = decodeCursor(params.cursor);
  const page = all.slice(start, start + limit);
  const nextIndex = start + limit;
  return {
    data: page,
    page: { cursor: params.cursor ?? null, nextCursor: nextIndex < all.length ? encodeCursor(nextIndex) : null, limit, total: all.length },
  };
}

export function mockGetCampaign(id: string): CampaignDetail {
  const campaign = getCampaigns().find((c) => c.id === id);
  if (!campaign) mockNotFound(`Campanha "${id}" não encontrada.`, 'CAMPAIGN_NOT_FOUND');
  return toDetail(campaign);
}

export function mockListCampaignTargets(id: string, params: ListCampaignTargetsQuery) {
  const campaign = getCampaigns().find((c) => c.id === id);
  if (!campaign) mockNotFound(`Campanha "${id}" não encontrada.`, 'CAMPAIGN_NOT_FOUND');
  syncLiveCompletion(campaign);

  let items = campaign.targets.map((t) => toTargetItem(t, campaign));
  if (params.status) items = items.filter((i) => i.status === params.status);

  const limit = Math.min(100, params.limit ?? 25);
  const start = decodeCursor(params.cursor);
  const page = items.slice(start, start + limit);
  const nextIndex = start + limit;
  return {
    data: page,
    page: { cursor: params.cursor ?? null, nextCursor: nextIndex < items.length ? encodeCursor(nextIndex) : null, limit, total: items.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns
// ─────────────────────────────────────────────────────────────────────────

function requireTemplate(id: string) {
  const template = (() => {
    try {
      return mockGetTemplate(id);
    } catch {
      return null;
    }
  })();
  if (!template) mockNotFound(`Template "${id}" não encontrado.`, 'TEMPLATE_NOT_FOUND');
  return template;
}

function requireInstances(ids: string[]) {
  const missing = ids.filter((id) => !mockFindInstanceRaw(id));
  if (missing.length > 0) {
    mockNotFound(`Instância(s) não encontrada(s): ${missing.join(', ')}.`, 'INSTANCE_NOT_FOUND');
  }
}

/** Status "não terminal" — os mesmos 5 do diagrama de ARQUITETURA §4.5.1 em que um alvo `pending` ainda pode existir. */
const ACTIVE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['draft', 'scheduled', 'running', 'paused', 'halted'];

/**
 * 6º motivo de exclusão (ARQUITETURA §4.5.4 item 6) — precisa do resto do
 * "banco" (todas as outras campanhas), por isso vive no mock, não em
 * `lib/campaign-audience.ts` (que é puro e não conhece outras campanhas).
 * Remove de `eligibleLeads` quem já é alvo `pending` de outra campanha ainda
 * não terminal, para não abordar a mesma pessoa duas vezes a frio.
 */
function excludeAlreadyTargeted(eligibleLeads: LeadListItem[], excludeCampaignId: string | null) {
  const targetedPhones = new Set<string>();
  for (const other of getCampaigns()) {
    if (other.id === excludeCampaignId || !ACTIVE_CAMPAIGN_STATUSES.includes(other.status)) continue;
    for (const target of other.targets) {
      const item = toTargetItem(target, other);
      if (item.status === 'pending') targetedPhones.add(item.phoneE164);
    }
  }

  const remaining: LeadListItem[] = [];
  let alreadyTargeted = 0;
  for (const lead of eligibleLeads) {
    if (lead.phoneE164 && targetedPhones.has(lead.phoneE164)) alreadyTargeted += 1;
    else remaining.push(lead);
  }
  return { eligibleLeads: remaining, alreadyTargeted };
}

/**
 * Prévia de audiência SEM criar nada — não existe `/campaigns/preview` no
 * contrato publicado ainda (ver `types/campaign.ts`); isto roda só em modo
 * mock (`lib/api/campaigns.ts#previewCampaignAudience` devolve `null` fora
 * dele) e existe para a tela de montagem poder recalcular "quantos entram"
 * a cada mexida no filtro, ANTES do operador se comprometer a criar. Mesma
 * conta do `POST` de verdade (incluindo o 6º motivo, `alreadyTargeted` —
 * aqui o mock TEM acesso ao resto das campanhas, diferente do `lib`
 * puro), só que sem materializar `CampaignTarget` nenhum.
 */
export function mockPreviewCampaignAudience(
  audience: CreateCampaignRequest['audience'],
  skipRecentlyContactedDays = DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS,
) {
  const matchedLeads = mockFindLeadsForAudience(
    audience.mode === 'ids' ? { mode: 'ids', leadIds: audience.leadIds } : { mode: 'filter', filter: audience.filter },
  );
  const { summary, eligibleLeads } = computeCampaignAudience({ leads: matchedLeads, skipRecentlyContactedDays });
  const { alreadyTargeted } = excludeAlreadyTargeted(eligibleLeads, null);
  summary.excluded.alreadyTargeted = alreadyTargeted;
  summary.eligible -= alreadyTargeted;
  return summary;
}

export function mockCreateCampaign(input: CreateCampaignRequest): CreateCampaignResponse {
  const name = input.name.trim();
  if (name.length < 3) mockValidationError('name', 'O nome da campanha precisa ter pelo menos 3 caracteres.');
  if (input.instanceIds.length === 0) mockValidationError('instanceIds', 'Escolha pelo menos uma instância de WhatsApp.');

  const template = requireTemplate(input.templateId);
  requireInstances(input.instanceIds);

  const skipRecentlyContactedDays = input.settings?.skipRecentlyContactedDays ?? DEFAULT_SKIP_RECENTLY_CONTACTED_DAYS;
  const matchedLeads = mockFindLeadsForAudience(
    input.audience.mode === 'ids' ? { mode: 'ids', leadIds: input.audience.leadIds } : { mode: 'filter', filter: input.audience.filter },
  );
  const { summary, eligibleLeads } = computeCampaignAudience({ leads: matchedLeads, skipRecentlyContactedDays });

  // 6º motivo (ARQUITETURA §4.5.4 item 6, `alreadyTargeted`) — só o mock
  // (com acesso ao resto do "banco") pode computar isto de verdade;
  // `computeCampaignAudience` (lib puro) sempre devolve 0 aqui de propósito
  // (ver cabeçalho de `lib/campaign-audience.ts`).
  const { eligibleLeads: finalEligible, alreadyTargeted } = excludeAlreadyTargeted(eligibleLeads, null);
  summary.excluded.alreadyTargeted = alreadyTargeted;
  summary.eligible = finalEligible.length;

  if (summary.eligible === 0) {
    mockConflict('EMPTY_AUDIENCE', 'Nenhum lead elegível sobrou depois dos filtros de exclusão — reveja o público antes de criar a campanha.');
  }
  if (summary.eligible > CAMPAIGN_MAX_TARGETS) {
    mockConflict(
      'AUDIENCE_TOO_LARGE',
      `${summary.eligible} leads elegíveis passa do limite de ${CAMPAIGN_MAX_TARGETS} por campanha — filtre em lotes menores.`,
    );
  }

  const instances = input.instanceIds.map((id) => mockFindInstanceRaw(id)!);
  const resolvedDailyLimit = input.settings?.dailyLimitPerInstance ?? Math.min(...instances.map((i) => i.warmup.dailyLimit));
  const settings = {
    dailyLimitPerInstance: resolvedDailyLimit,
    sendWindow: input.settings?.sendWindow ?? DEFAULT_SEND_WINDOW,
    jitterSeconds: input.settings?.jitterSeconds ?? DEFAULT_JITTER,
    skipRecentlyContactedDays,
  };
  const estimate = computeCampaignEstimate(
    summary.eligible,
    instances.map((i) => ({ dailyLimit: resolvedDailyLimit || i.warmup.dailyLimit })),
  );

  const id = `camp_${seq++}`;
  const now = Date.now();
  const targets: MockCampaignTarget[] = finalEligible.map((lead, index) => ({
    id: `tgt_${seq++}`,
    leadId: lead.id,
    leadName: lead.name,
    phoneE164: lead.phoneE164!,
    attempt: 0,
    messagePreview: null,
    instanceId: input.instanceIds[index % input.instanceIds.length]!,
    fixedStatus: 'pending',
    fixedSkipReason: null,
  }));

  const campaign: MockCampaign = {
    id,
    name,
    status: 'draft',
    templateId: template.id,
    templateName: template.name,
    renderedTemplateSnapshot: null,
    instanceIds: input.instanceIds,
    settings,
    targets,
    createdAt: new Date(now).toISOString(),
    startedAtMs: null,
    finishedAt: null,
    haltReason: null,
    live: false,
  };
  getCampaigns().unshift(campaign);

  return {
    id,
    name,
    status: 'draft',
    templateId: template.id,
    instanceIds: input.instanceIds,
    audience: summary,
    settings,
    estimate,
    createdAt: campaign.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns/:id/{action} (ARQUITETURA §4.5.9)
// ─────────────────────────────────────────────────────────────────────────

function requireCampaign(id: string): MockCampaign {
  const campaign = getCampaigns().find((c) => c.id === id);
  if (!campaign) mockNotFound(`Campanha "${id}" não encontrada.`, 'CAMPAIGN_NOT_FOUND');
  syncLiveCompletion(campaign);
  return campaign;
}

function requireConnectedInstances(campaign: MockCampaign) {
  const disconnected = campaign.instanceIds
    .map((id) => mockFindInstanceRaw(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.status !== 'connected');
  if (disconnected.length > 0) {
    mockConflict(
      'INSTANCE_NOT_CONNECTED',
      `${disconnected.length} instância(s) não está(ão) conectada(s): ${disconnected.map((i) => i.name).join(', ')}. Conecte-as (ou remova da campanha) antes de continuar.`,
      { details: disconnected.map((i) => ({ path: i.id, message: i.lastError ?? 'Instância não está conectada.' })) },
    );
  }
}

export function mockStartCampaign(id: string): StartCampaignResponse {
  const campaign = requireCampaign(id);
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    mockConflict('INVALID_CAMPAIGN_TRANSITION', `Campanha está "${campaign.status}" — só é possível iniciar a partir de rascunho ou agendada.`);
  }
  requireConnectedInstances(campaign);

  const pendingCount = campaign.targets.length;
  if (pendingCount === 0) {
    mockConflict('EMPTY_AUDIENCE', 'Esta campanha não tem nenhum alvo — não há para quem enviar.');
  }
  // Validação de variação de spintax (ARQUITETURA §4.5.9 item 4): abaixo de
  // 10 variações com mais de 50 alvos é bloqueio, não aviso.
  const template = (() => {
    try {
      return mockGetTemplate(campaign.templateId);
    } catch {
      return null;
    }
  })();
  if (template && template.spintaxVariations < 10 && pendingCount > 50) {
    mockConflict(
      'INSUFFICIENT_TEXT_VARIATION',
      `O template gera só ${template.spintaxVariations} variação(ões) de texto para ${pendingCount} alvos — risco de bloqueio. Adicione mais alternativas com {a|b} antes de iniciar.`,
    );
  }

  const now = Date.now();
  campaign.status = 'running';
  campaign.startedAtMs = now;
  campaign.live = false; // campanhas iniciadas manualmente pela tela usam estado fixo (sem motor de disparo nesta rodada — ver PENDÊNCIAS do handoff).
  campaign.targets = campaign.targets.map((t) => ({ ...t, fixedStatus: 'pending' as CampaignTargetStatus }));
  campaign.renderedTemplateSnapshot = template?.body ?? campaign.renderedTemplateSnapshot;

  const firstSendAt = new Date(now).toISOString();
  return { ok: true, status: 'running', firstSendAt };
}

export function mockPauseCampaign(id: string): PauseCampaignResponse {
  const campaign = requireCampaign(id);
  if (campaign.status !== 'running') {
    mockConflict('INVALID_CAMPAIGN_TRANSITION', `Campanha está "${campaign.status}" — só é possível pausar uma campanha em andamento.`);
  }
  campaign.status = 'paused';
  campaign.live = false;
  const items = campaign.targets.map((t) => toTargetItem(t, campaign));
  const pendingTargets = items.filter((i) => i.status === 'pending').length;
  return { ok: true, status: 'paused', pendingTargets };
}

export function mockResumeCampaign(id: string, body: ResumeCampaignRequest): ResumeCampaignResponse {
  const campaign = requireCampaign(id);
  if (campaign.status !== 'paused' && campaign.status !== 'halted') {
    mockConflict('INVALID_CAMPAIGN_TRANSITION', `Campanha está "${campaign.status}" — só é possível retomar uma campanha pausada ou interrompida.`);
  }
  if (campaign.status === 'halted' && !body.acknowledgeHalt) {
    mockConflict('HALT_NOT_ACKNOWLEDGED', 'Confirme que já revisou o motivo da parada automática antes de retomar.', {
      details: [{ path: 'haltReason', message: campaign.haltReason ?? 'Motivo não registrado.' }],
    });
  }
  requireConnectedInstances(campaign);

  campaign.status = 'running';
  campaign.haltReason = null;
  return { ok: true, status: 'running' };
}

export function mockCancelCampaign(id: string): CancelCampaignResponse {
  const campaign = requireCampaign(id);
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    mockConflict('INVALID_CAMPAIGN_TRANSITION', `Campanha está "${campaign.status}" — não é possível cancelar uma campanha já terminada.`);
  }
  const items = campaign.targets.map((t) => toTargetItem(t, campaign));
  const cancelledTargets = items.filter((i) => i.status === 'pending' || i.status === 'sent').length;
  campaign.targets = campaign.targets.map((t) => {
    const item = items.find((i) => i.id === t.id)!;
    if (item.status === 'pending' || item.status === 'sent') {
      return { ...t, fixedStatus: 'skipped' as CampaignTargetStatus, fixedSkipReason: 'campaign_cancelled' };
    }
    return { ...t, fixedStatus: item.status };
  });
  campaign.status = 'cancelled';
  campaign.live = false;
  campaign.finishedAt = nowIso();
  return { ok: true, cancelledTargets };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/campaigns/:id/targets/:targetId/send — 🆕 Fase 4.D, disparo
// MANUAL alvo-a-alvo (ARQUITETURA: "nenhum laço automático nesta rodada — o
// motor é a Fase 4.F"). É como o operador "aperta o play" num alvo: sem
// isto, uma campanha `running` não move um único alvo sozinha.
//
// Simplificação assumida (documentar no handoff): o gate real de envio
// (`lib/services/messages.ts`, Vega) tem MUITO mais checagem — descadastro
// consultado a menos de 5s do envio, cooldown por lead, `SEND_PACE_LOCKED`
// por instância etc. Replicar tudo aqui duplicaria lógica de negócio pesada
// no frontend (proibido — ver protocolo da Lyra). Este mock cobre só o que
// a TELA precisa exercitar: campanha rodando, alvo pendente, janela de
// horário (§4.9.6, mesmo `lib/send-window.ts` do envio unitário) e cota da
// instância — o resto é responsabilidade do backend real.
// ─────────────────────────────────────────────────────────────────────────

export function mockSendCampaignTarget(campaignId: string, targetId: string, body: SendCampaignTargetRequest): SendCampaignTargetResponse {
  const campaign = requireCampaign(campaignId);
  if (campaign.status !== 'running') {
    mockConflict('CAMPAIGN_NOT_RUNNING', `Campanha está "${campaign.status}" — só é possível disparar manualmente com a campanha em andamento.`);
  }

  const target = campaign.targets.find((t) => t.id === targetId);
  if (!target) mockNotFound(`Alvo "${targetId}" não encontrado nesta campanha.`, 'TARGET_NOT_FOUND');

  const currentStatus = toTargetItem(target, campaign).status;
  if (currentStatus !== 'pending') {
    mockConflict('TARGET_NOT_PENDING', `Este alvo já está "${currentStatus}" — só é possível disparar um alvo que ainda está na fila.`);
  }

  // Piso legal + janela comercial (ARQUITETURA §4.9.6) — mesmo gate do envio
  // unitário. Sem `confirmOutsideBusinessWindow` aqui de propósito:
  // `sendCampaignTargetBodySchema` só aceita `instanceId` — a janela já é
  // configurável em `campaign.settings.sendWindow`, então este botão só
  // avisa e bloqueia, nunca oferece "forçar mesmo assim".
  const verdict = evaluateSendWindow(new Date());
  if (verdict.level === 'quiet_hours') {
    mockConflict(
      'QUIET_HOURS',
      `Fora do horário permitido para envio (08h–20h, exceto domingo). Libera automaticamente às ${formatDateTime(verdict.nextOpensAt.toISOString())}.`,
    );
  }
  if (verdict.level === 'outside_business') {
    mockConflict(
      'OUTSIDE_BUSINESS_WINDOW',
      `Fora da janela comercial configurada para esta campanha. Abre de novo às ${formatDateTime(verdict.nextOpensAt.toISOString())}.`,
    );
  }

  const candidateIds = body.instanceId ? [body.instanceId] : campaign.instanceIds;
  const instance = candidateIds
    .map((instanceId) => mockFindInstanceRaw(instanceId))
    .find((i) => i && campaign.instanceIds.includes(i.id) && i.status === 'connected' && i.today.remaining > 0);

  if (!instance) {
    mockConflict(
      'INSTANCE_NOT_CONNECTED',
      'Nenhuma instância desta campanha está conectada com cota disponível agora — conecte uma instância ou espere a cota renovar.',
    );
  }

  mockReserveInstanceQuota(instance.id);
  const now = nowIso();
  target.manualStatus = 'sent';
  target.manualSentAt = now;
  target.attempt += 1;
  target.instanceId = instance.id;
  target.messagePreview = campaign.renderedTemplateSnapshot ?? 'Mensagem enviada.';

  const message: MessageItem = {
    id: `msg_${seq++}`,
    leadId: target.leadId,
    campaignTargetId: target.id,
    instanceId: instance.id,
    direction: 'outbound',
    body: campaign.renderedTemplateSnapshot ?? target.messagePreview,
    providerMessageId: `mock_provider_${seq}`,
    status: 'sent',
    errorCode: null,
    sentAt: now,
    deliveredAt: null,
    readAt: null,
  };

  return {
    message,
    instance: { id: instance.id, name: instance.name, phoneNumber: instance.phoneNumber, health: instance.health },
    quota: {
      warmupDay: instance.warmup.day,
      isWarm: instance.warmup.isWarm,
      dailyLimit: instance.warmup.dailyLimit,
      sentToday: instance.today.sent,
      remaining: instance.today.remaining,
    },
    renderedFrom: null,
    warnings: [],
  };
}
