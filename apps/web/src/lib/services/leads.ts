/**
 * lib/services/leads.ts — lógica de negócio de `Lead` (ARQUITETURA §4.3).
 *
 * Campo que ainda depende de model de fase futura, com valor neutro
 * documentado:
 *   - filtro `contactedInCampaign`: continua no-op (depende de
 *     `CampaignTarget` sendo populado pelo disparo em massa, Fase 4).
 *
 * ⚠️ `isOptedOut` e `messages`/`lastContactedAt` NÃO são mais desses. A
 * tabela `OptOut` existe desde a Fase 3 e é consultada de verdade aqui — ver
 * `fetchOptedOutPhones`. `Message` existe desde a Fase 3 (o webhook grava
 * inbound, e agora `lib/services/messages.ts` grava outbound) — a ficha do
 * lead (`getLeadDetail`) devolve a timeline real e `lastContactedAt` a partir
 * da última mensagem de SAÍDA, em vez do `[]`/`null` fixos de antes.
 * `listLeads` continua sem consultar `Message` por lead (evitaria N+1 numa
 * listagem paginada) — `lastContactedAt` na LISTAGEM continua `null` até essa
 * decisão de performance ser revisitada (ex.: coluna denormalizada em `Lead`,
 * mesmo padrão já usado para `isOptedOut` antes da Fase 3).
 */
import { prisma, type Lead, type LeadStatus, type Prisma } from '@inno/db';
import { checkStatusTransition } from '@inno/core';
import type { LeadDetail, LeadListItem, ListLeadsQuery, ListLeadsResponse, PatchLeadBody } from '@inno/contracts';
import { badRequest, notFound } from '@/lib/api-handler';
import { logger } from '@/lib/logger';

/**
 * Acima disto, carregar a lista inteira de telefones descadastrados para
 * montar o filtro `optedOut` deixa de ser barato. Não é um limite silencioso:
 * ao ultrapassar, logamos para que a troca por uma junção em SQL (ou uma
 * coluna denormalizada em `Lead`, mantida pelo registro de opt-out) seja uma
 * decisão tomada com dado, e não uma surpresa de performance em produção.
 */
const OPTOUT_FILTER_ALERTA = 20_000;

/**
 * Descobre quais dos telefones informados estão descadastrados — UMA consulta
 * por página, nunca uma por lead (o índice único de `OptOut.phoneE164` cobre
 * o `IN`). Leads sem telefone nunca podem estar na lista.
 */
async function fetchOptedOutPhones(phones: readonly (string | null)[]): Promise<Set<string>> {
  const alvos = [...new Set(phones.filter((p): p is string => Boolean(p)))];
  if (alvos.length === 0) return new Set();

  const encontrados = await prisma.optOut.findMany({
    where: { phoneE164: { in: alvos } },
    select: { phoneE164: true },
  });
  return new Set(encontrados.map((o) => o.phoneE164));
}

function toListItem(
  lead: Lead & { city: { name: string } | null },
  optedOutPhones: ReadonlySet<string>,
  lastContactedAt: string | null = null,
): LeadListItem {
  return {
    id: lead.id,
    name: lead.name,
    phoneE164: lead.phoneE164,
    phoneType: lead.phoneType,
    address: lead.address,
    city: lead.city?.name ?? null,
    uf: lead.uf,
    website: lead.website,
    category: lead.category,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    status: lead.status,
    tags: lead.tags,
    isOptedOut: lead.phoneE164 !== null && optedOutPhones.has(lead.phoneE164),
    lastContactedAt,
    createdAt: lead.createdAt.toISOString(),
  };
}

/**
 * Monta o `where` do Prisma a partir do filtro combinável (AND) de
 * `leadFilterSchema`.
 *
 * `todosOptedOut` é a lista completa de telefones descadastrados, carregada
 * pelo chamador SOMENTE quando o filtro `optedOut` foi usado — `null` quando
 * não foi, para não pagar essa consulta em toda listagem.
 */
function buildWhere(
  filter: ListLeadsQuery,
  options: { includeStatus: boolean; todosOptedOut: readonly string[] | null },
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};

  if (options.includeStatus && filter.status?.length) where.status = { in: filter.status };
  if (filter.uf?.length) where.uf = { in: filter.uf };
  if (filter.cityIbgeCode?.length) where.cityId = { in: filter.cityIbgeCode };
  if (filter.category?.length) where.category = { in: filter.category };
  if (filter.searchJobId) where.searchJobId = filter.searchJobId;
  if (filter.phoneType) where.phoneType = filter.phoneType;
  if (filter.minRating !== undefined) where.rating = { gte: filter.minRating };
  if (filter.tags?.length) where.tags = { hasSome: filter.tags };
  if (filter.hasWebsite !== undefined) where.website = filter.hasWebsite ? { not: null } : null;
  if (filter.hasPhone !== undefined) where.phoneE164 = filter.hasPhone ? { not: null } : null;
  if (filter.createdFrom || filter.createdTo) {
    where.createdAt = {
      ...(filter.createdFrom ? { gte: new Date(filter.createdFrom) } : {}),
      ...(filter.createdTo ? { lte: new Date(filter.createdTo) } : {}),
    };
  }
  if (filter.q) {
    where.OR = [
      { name: { contains: filter.q, mode: 'insensitive' } },
      { address: { contains: filter.q, mode: 'insensitive' } },
      { phoneRaw: { contains: filter.q } },
      { phoneE164: { contains: filter.q } },
    ];
  }
  // `optedOut`: a chave do descadastro é o TELEFONE, não o lead — o mesmo
  // número pode ter sido coletado como leads diferentes, e todos precisam
  // aparecer como descadastrados. Por isso o filtro é por `phoneE164`, e não
  // por uma relação com `OptOut.leadId` (que é opcional e só registra o lead
  // de origem). Lead sem telefone nunca está descadastrado: entra no `false`
  // e fica fora do `true`.
  if (filter.optedOut !== undefined && options.todosOptedOut) {
    const lista = [...options.todosOptedOut];
    where.phoneE164 = filter.optedOut ? { in: lista } : { notIn: lista };
  }

  // `contactedInCampaign`: continua no-op — depende de `Message`/
  // `CampaignTarget` serem populados pelo disparo, que é a Fase 4.

  return where;
}

/**
 * Carrega todos os telefones descadastrados, para o filtro `optedOut`.
 * Só é chamado quando o filtro foi de fato usado.
 */
async function fetchTodosOptedOut(): Promise<string[]> {
  const linhas = await prisma.optOut.findMany({ select: { phoneE164: true } });
  if (linhas.length > OPTOUT_FILTER_ALERTA) {
    logger.warn('leads.filtro_optedout.lista_grande', {
      total: linhas.length,
      limite: OPTOUT_FILTER_ALERTA,
      dica: 'Trocar o filtro por junção em SQL ou coluna denormalizada em Lead.',
    });
  }
  return linhas.map((l) => l.phoneE164);
}

const EMPTY_STATUS_COUNTS: Record<LeadStatus, number> = {
  new: 0,
  validated: 0,
  contacted: 0,
  responded: 0,
  negotiating: 0,
  won: 0,
  discarded: 0,
};

export async function listLeads(filter: ListLeadsQuery): Promise<ListLeadsResponse> {
  const todosOptedOut = filter.optedOut !== undefined ? await fetchTodosOptedOut() : null;

  const whereWithStatus = buildWhere(filter, { includeStatus: true, todosOptedOut });
  // Facets (contagem por status + total) refletem o filtro SEM o próprio
  // `status` — é isso que permite a UI mostrar "quantos há em cada aba" sem
  // o número da aba selecionada colapsar para ela mesma.
  const whereForFacets = buildWhere(filter, { includeStatus: false, todosOptedOut });

  const orderBy: Prisma.LeadOrderByWithRelationInput[] = [
    { [filter.sort.field]: filter.sort.direction } as Prisma.LeadOrderByWithRelationInput,
    { id: 'asc' },
  ];

  const [total, rows, statusGroups] = await Promise.all([
    prisma.lead.count({ where: whereWithStatus }),
    prisma.lead.findMany({
      where: whereWithStatus,
      include: { city: { select: { name: true } } },
      orderBy,
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    }),
    prisma.lead.groupBy({ by: ['status'], where: whereForFacets, _count: { _all: true } }),
  ]);

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  const byStatus: Record<LeadStatus, number> = { ...EMPTY_STATUS_COUNTS };
  let facetsTotal = 0;
  for (const group of statusGroups) {
    byStatus[group.status] = group._count._all;
    facetsTotal += group._count._all;
  }

  // Uma consulta para a página inteira — não uma por lead.
  const optedOutPhones = await fetchOptedOutPhones(page.map((lead) => lead.phoneE164));

  return {
    data: page.map((lead) => toListItem(lead, optedOutPhones)),
    page: { cursor: filter.cursor ?? null, nextCursor, limit: filter.limit, total },
    facets: { byStatus, total: facetsTotal },
  };
}

export async function getLeadDetail(id: string): Promise<LeadDetail> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      city: { select: { name: true } },
      activities: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!lead) notFound('Lead não encontrado.');

  // Uma única consulta para a ficha (não é a listagem — sem risco de N+1):
  // toda mensagem (entrada e saída) deste lead, mais antiga primeiro, para a
  // timeline renderizar na ordem de uma conversa.
  const [optedOutPhones, messages] = await Promise.all([
    fetchOptedOutPhones([lead.phoneE164]),
    prisma.message.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, direction: true, body: true, status: true, errorCode: true, sentAt: true, deliveredAt: true, readAt: true, createdAt: true },
    }),
  ]);

  // `lastContactedAt` = a mensagem de SAÍDA mais recente (ARQUITETURA §4.3
  // `LeadListItem.lastContactedAt`). Usa `sentAt` quando existe (envio
  // confirmado); cai para `createdAt` numa `queued`/`failed` sem `sentAt` —
  // ainda é o momento em que TENTAMOS contatar, mais correto que `null`.
  let lastContactedAt: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.direction === 'outbound') {
      lastContactedAt = (message.sentAt ?? message.createdAt).toISOString();
      break;
    }
  }

  return {
    ...toListItem(lead, optedOutPhones, lastContactedAt),
    notes: lead.notes,
    latitude: lead.latitude,
    longitude: lead.longitude,
    source: {
      type: lead.sourceType,
      url: lead.sourceUrl,
      collectedAt: lead.collectedAt.toISOString(),
      searchJobId: lead.searchJobId,
    },
    firstSeenAt: lead.firstSeenAt.toISOString(),
    lastSeenAt: lead.lastSeenAt.toISOString(),
    activities: lead.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      payload: (activity.payload as Record<string, unknown> | null) ?? null,
      actor: activity.actor,
      createdAt: activity.createdAt.toISOString(),
    })),
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      status: message.status,
      sentAt: message.sentAt?.toISOString() ?? null,
      deliveredAt: message.deliveredAt?.toISOString() ?? null,
      readAt: message.readAt?.toISOString() ?? null,
      // Só em falha: é o que permite à tela separar "pode ter saído"
      // (EVOLUTION_SEND_UNCERTAIN) de "não saiu". Ver leadMessageItemSchema.
      errorCode: message.status === 'failed' ? message.errorCode : null,
    })),
  };
}

export async function patchLead(id: string, patch: PatchLeadBody, actorUserId: string): Promise<LeadDetail> {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) notFound('Lead não encontrado.');

  if (patch.status !== undefined && patch.status !== lead.status) {
    const result = checkStatusTransition(lead.status, patch.status, 'human');
    if (!result.allowed) {
      badRequest(result.reason, [{ path: 'status', message: result.reason }]);
    }
  }

  const data: Prisma.LeadUpdateInput = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.tags !== undefined) data.tags = patch.tags;
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.phoneE164 !== undefined) data.phoneE164 = patch.phoneE164;
  if (patch.website !== undefined) data.website = patch.website;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data });

    if (patch.status !== undefined && patch.status !== lead.status) {
      await tx.leadActivity.create({
        data: {
          leadId: id,
          type: 'status_changed',
          payload: { from: lead.status, to: patch.status },
          actor: 'user',
          actorUserId,
        },
      });
    }
    if (patch.notes !== undefined && patch.notes !== lead.notes) {
      await tx.leadActivity.create({
        data: { leadId: id, type: 'note_added', payload: { notes: patch.notes }, actor: 'user', actorUserId },
      });
    }
  });

  return getLeadDetail(id);
}
