/**
 * lib/services/leads.ts — lógica de negócio de `Lead` (ARQUITETURA §4.3).
 *
 * Campos que dependem de models de fases futuras (ainda não existem no
 * schema da Fase 1 — ver comentário de escopo em
 * `packages/db/prisma/schema.prisma`) ficam com valor neutro documentado:
 *   - `isOptedOut` / filtro `optedOut`: sempre `false` (sem `OptOut`, Fase 3).
 *   - `lastContactedAt` / filtro `contactedInCampaign`: sempre `null`/no-op
 *     (sem `Message`/`CampaignTarget`, Fases 3-4).
 *   - `LeadDetail.messages`: sempre `[]` (sem `Message`, Fase 3).
 */
import { prisma, type Lead, type LeadStatus, type Prisma } from '@inno/db';
import { checkStatusTransition } from '@inno/core';
import type { LeadDetail, LeadListItem, ListLeadsQuery, ListLeadsResponse, PatchLeadBody } from '@inno/contracts';
import { badRequest, notFound } from '@/lib/api-handler';

function toListItem(lead: Lead & { city: { name: string } | null }): LeadListItem {
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
    isOptedOut: false,
    lastContactedAt: null,
    createdAt: lead.createdAt.toISOString(),
  };
}

/** Monta o `where` do Prisma a partir do filtro combinável (AND) de `leadFilterSchema`. */
function buildWhere(filter: ListLeadsQuery, options: { includeStatus: boolean }): Prisma.LeadWhereInput {
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
  // `optedOut`/`contactedInCampaign`: sem tabela correspondente na Fase 1
  // (ver cabeçalho do arquivo) — não filtram nada ainda, de propósito.

  return where;
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
  const whereWithStatus = buildWhere(filter, { includeStatus: true });
  // Facets (contagem por status + total) refletem o filtro SEM o próprio
  // `status` — é isso que permite a UI mostrar "quantos há em cada aba" sem
  // o número da aba selecionada colapsar para ela mesma.
  const whereForFacets = buildWhere(filter, { includeStatus: false });

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

  return {
    data: page.map(toListItem),
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

  return {
    ...toListItem(lead),
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
    messages: [], // sem `Message` na Fase 1 (Fase 3)
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
