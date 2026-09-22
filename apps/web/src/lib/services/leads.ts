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
 *
 * `GET /leads/export` (2026-09-22, uso próprio): `resolveLeadWhere` reusa a
 * MESMA `buildWhere` de `listLeads` — o export nunca reimplementa o filtro.
 * `iterateLeadsForExport`/`countLeadsForExport` + o escape de CSV
 * (`escapeCsvField`) moram aqui, não na rota, para o teste não precisar
 * importar `lib/api-handler.ts` (que puxa `lib/auth.ts`/`next-auth`, ver
 * `bug-nextauth-vitest-server-import`).
 *
 * `POST /leads/bulk` (2026-09-22): `bulkUpdateLeads` é o `patchLead` em
 * massa — mesma `checkStatusTransition`, mesmo padrão de `LeadActivity` por
 * alteração. Nunca falha o lote inteiro por um item ruim; só a validação de
 * ESCOPO da chamada (contagem via `expectedCount`, teto de itens) recusa a
 * chamada toda.
 */
import { prisma, type Lead, type LeadStatus, type Prisma } from '@inno/db';
import { checkStatusTransition } from '@inno/core';
import type {
  BulkLeadsBody,
  BulkLeadsResponse,
  BulkLeadsSkippedItem,
  ExportLeadsQuery,
  LeadDetail,
  LeadExportColumn,
  LeadFilter,
  LeadListItem,
  ListLeadsQuery,
  ListLeadsResponse,
  PatchLeadBody,
} from '@inno/contracts';
import { LEAD_BULK_MAX_IDS } from '@inno/contracts';
import { badRequest, conflict, notFound } from '@/lib/api-handler';
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
  filter: LeadFilter,
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

/**
 * Monta o `where` completo (COM `status`, se houver) de um `LeadFilter` —
 * usado por `GET /leads/export` e `POST /leads/bulk`, que (diferente de
 * `listLeads`) não precisam de facets, então sempre `includeStatus: true`.
 * Único ponto que decide "buscar `fetchTodosOptedOut` ou não" para os dois,
 * em vez de cada chamador reimplementar essa regra.
 */
async function resolveLeadWhere(filter: LeadFilter): Promise<Prisma.LeadWhereInput> {
  const todosOptedOut = filter.optedOut !== undefined ? await fetchTodosOptedOut() : null;
  return buildWhere(filter, { includeStatus: true, todosOptedOut });
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

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/leads/export
//
// A geração do CSV (BOM/separador/escape) mora AQUI, não em
// `app/api/v1/leads/export/route.ts`, de propósito: qualquer arquivo que
// importe `lib/api-handler.ts` (a rota importa) puxa `lib/auth.ts`, que
// chama `NextAuth(...)` e quebra em teste Vitest puro — ver
// `bug-nextauth-vitest-server-import` na memória. Mantendo a lógica pura
// aqui, o teste de escape/paginação não precisa mockar `next-auth`.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Página por vez do cursor de export — nunca a base inteira em memória
 * (a base pode ter dezenas de milhares de leads). Cada página paga UMA
 * consulta a `OptOut` (não uma por lead), igual ao padrão de `listLeads`.
 */
const LEAD_EXPORT_PAGE_SIZE = 1000;

/** Separador `;` (não `,`) — Excel PT-BR usa vírgula como separador DECIMAL; ver contrato. */
export const CSV_SEPARATOR = ';';
const CSV_NEWLINE = '\r\n';
/** BOM UTF-8 — sem isto o Excel abre acentuação quebrada num CSV UTF-8. */
export const CSV_BOM = '﻿';

/**
 * Primeiro caractere que o Excel/Sheets interpreta como início de fórmula ao
 * abrir um CSV. Um `nome`/`endereco`/`categoria` coletado do Google Maps que
 * comece por um destes (raro, mas não impossível — e o operador não escolhe
 * o dado, o scraper coleta) executaria como fórmula na máquina de quem abre o
 * arquivo. Isto é injeção de fórmula em CSV (CWE-1236), não frescura.
 */
const CSV_FORMULA_TRIGGER = new Set(['=', '+', '-', '@']);

/**
 * Escapa UM valor para uma célula CSV: neutraliza injeção de fórmula
 * (prefixo `'`, a mesma convenção que o Excel usa para forçar texto — sobrevive
 * como texto literal, nunca executa) e entre aspas quando o valor contém o
 * separador, aspas ou quebra de linha (RFC 4180).
 */
export function escapeCsvField(raw: string): string {
  let value = raw;
  if (value.length > 0 && CSV_FORMULA_TRIGGER.has(value[0]!)) {
    value = `'${value}`;
  }
  if (/["\r\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Monta uma linha CSV completa (já com `\r\n`) a partir dos valores já formatados. */
export function buildCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvField).join(CSV_SEPARATOR) + CSV_NEWLINE;
}

/** `Content-Disposition` datado — `leads-2026-09-22.csv`. */
export function leadExportFilename(now: Date = new Date()): string {
  return `leads-${now.toISOString().slice(0, 10)}.csv`;
}

/** Uma linha do export, já com todo campo formatado como string (pronta para `escapeCsvField`). */
type LeadExportRow = Record<LeadExportColumn, string>;

function buildExportRow(
  lead: Lead & { city: { name: string } | null },
  isOptedOut: boolean,
): LeadExportRow {
  return {
    nome: lead.name,
    telefone: lead.phoneE164 ?? '',
    tipo_telefone: lead.phoneType,
    endereco: lead.address ?? '',
    cidade: lead.city?.name ?? '',
    uf: lead.uf ?? '',
    site: lead.website ?? '',
    categoria: lead.category ?? '',
    // Vírgula decimal (pt-BR) — combina com o separador `;` da linha.
    nota: lead.rating !== null ? String(lead.rating).replace('.', ',') : '',
    avaliacoes: lead.reviewCount !== null ? String(lead.reviewCount) : '',
    status: lead.status,
    // `|` (nunca `,`/`;`) para não colidir com separador de campo nem com
    // decimal — tag em si já é restrita (sem esses caracteres pelo schema).
    tags: lead.tags.join('|'),
    descadastrado: isOptedOut ? 'sim' : 'não',
    origem_url: lead.sourceUrl,
    coletado_em: lead.collectedAt.toISOString(),
  };
}

/**
 * Contagem total do filtro, para o teto de `LEAD_EXPORT_MAX_ROWS` — decidido
 * ANTES de abrir o stream, para nunca começar uma resposta `200` que será
 * cortada no meio por ultrapassar o limite.
 */
export async function countLeadsForExport(filter: ExportLeadsQuery): Promise<number> {
  const where = await resolveLeadWhere(filter);
  return prisma.lead.count({ where });
}

/**
 * Gera as linhas do export em streaming, por cursor — nunca `findMany` sem
 * `take` (a base pode ter dezenas de milhares de leads). Ordena por
 * `createdAt, id` (não pelo `sort` da tela): é um dump completo do filtro,
 * não uma página de UI, então uma ordem estável e indexada é o que importa
 * aqui, não a ordenação da tela naquele momento.
 */
export async function* iterateLeadsForExport(filter: ExportLeadsQuery): AsyncGenerator<LeadExportRow> {
  const where = await resolveLeadWhere(filter);
  let cursor: string | undefined;

  while (true) {
    const rows = await prisma.lead.findMany({
      where,
      include: { city: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LEAD_EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    // Uma consulta por PÁGINA (não por lead) para saber quem está descadastrado.
    const optedOutPhones = await fetchOptedOutPhones(rows.map((lead) => lead.phoneE164));
    for (const lead of rows) {
      yield buildExportRow(lead, lead.phoneE164 !== null && optedOutPhones.has(lead.phoneE164));
    }

    if (rows.length < LEAD_EXPORT_PAGE_SIZE) break;
    cursor = rows[rows.length - 1]!.id;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/leads/bulk
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cada lote de alteração roda na SUA PRÓPRIA transação — não uma transação
 * única para os até 10.000 itens (`LEAD_BULK_MAX_IDS`). Uma transação desse
 * tamanho seguraria conexão/lock tempo suficiente para arriscar estourar
 * timeout, e o contrato já pede "não falhar tudo por causa de um item": não
 * há necessidade de atomicidade ENTRE lotes, só dentro de cada um (update do
 * lead + `LeadActivity` do mesmo lead nunca ficam dessincronizados).
 */
const LEAD_BULK_CHUNK_SIZE = 200;

/**
 * Resolve os ids alvo de `POST /leads/bulk`. Com `leadIds`, é a lista (sem
 * duplicatas). Com `filter`, reconsulta o filtro NESTE momento e recusa se a
 * contagem não bater com `expectedCount` da tela — é a proteção contra
 * "mudei 4.000 leads sem querer" pedida no escopo: sem isto, um filtro que
 * mudou de contagem entre a tela carregar e o operador clicar "aplicar"
 * altera mais (ou menos) leads do que ele conferiu.
 */
async function resolveBulkTargetIds(body: BulkLeadsBody): Promise<string[]> {
  if (body.leadIds) return [...new Set(body.leadIds)];

  const where = await resolveLeadWhere(body.filter!);
  const rows = await prisma.lead.findMany({
    where,
    select: { id: true },
    take: LEAD_BULK_MAX_IDS + 1,
  });

  if (rows.length > LEAD_BULK_MAX_IDS) {
    badRequest(
      `O filtro resolve para mais de ${LEAD_BULK_MAX_IDS} leads — refine o filtro antes de aplicar em massa.`,
      undefined,
      'TOO_MANY_ITEMS',
    );
  }
  if (rows.length !== body.expectedCount) {
    conflict(
      `A contagem atual do filtro (${rows.length}) é diferente da esperada (${body.expectedCount}). Atualize a tela e tente novamente.`,
      undefined,
      'EXPECTED_COUNT_MISMATCH',
    );
  }

  return rows.map((r) => r.id);
}

type BulkPlan = {
  id: string;
  data: Prisma.LeadUpdateInput;
  activityType: string;
  activityPayload: Prisma.InputJsonValue;
};

/**
 * Aplica `set_status`/`add_tags`/`remove_tags` a um lote de leads —
 * `PATCH /leads/:id` em massa, com a MESMA `checkStatusTransition` (nunca
 * uma segunda regra de transição). Nunca lança por um item ruim: cada lead
 * vira ou um item de `updatedIds`, ou um item de `skipped` com o motivo
 * (`NOT_FOUND`/`INVALID_STATUS_TRANSITION`/`NO_CHANGE`) — só a validação de
 * ESCOPO da chamada (contagem, teto) lança e recusa a chamada inteira.
 */
export async function bulkUpdateLeads(body: BulkLeadsBody, actorUserId: string): Promise<BulkLeadsResponse> {
  const ids = await resolveBulkTargetIds(body);

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, tags: true },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));

  const skipped: BulkLeadsSkippedItem[] = [];
  const plans: BulkPlan[] = [];

  for (const id of ids) {
    const lead = byId.get(id);
    if (!lead) {
      skipped.push({ id, reason: 'NOT_FOUND', message: 'Lead não encontrado.' });
      continue;
    }

    if (body.action === 'set_status') {
      const to = body.value.status!;
      if (to === lead.status) {
        skipped.push({ id, reason: 'NO_CHANGE', message: `o lead já está em '${to}'` });
        continue;
      }
      const result = checkStatusTransition(lead.status, to, 'human');
      if (!result.allowed) {
        skipped.push({ id, reason: 'INVALID_STATUS_TRANSITION', message: result.reason });
        continue;
      }
      plans.push({
        id,
        data: { status: to },
        activityType: 'status_changed',
        activityPayload: { from: lead.status, to },
      });
      continue;
    }

    // add_tags / remove_tags
    const tagsToApply = body.value.tags!;
    const current = new Set(lead.tags);
    let changed = false;
    if (body.action === 'add_tags') {
      for (const tag of tagsToApply) {
        if (!current.has(tag)) {
          current.add(tag);
          changed = true;
        }
      }
    } else {
      for (const tag of tagsToApply) {
        if (current.delete(tag)) changed = true;
      }
    }
    if (!changed) {
      skipped.push({
        id,
        reason: 'NO_CHANGE',
        message:
          body.action === 'add_tags'
            ? 'o lead já tinha todas as tags informadas'
            : 'o lead não tinha nenhuma das tags informadas',
      });
      continue;
    }
    plans.push({
      id,
      data: { tags: [...current] },
      activityType: body.action === 'add_tags' ? 'tags_added' : 'tags_removed',
      activityPayload: { tags: tagsToApply },
    });
  }

  const updatedIds: string[] = [];
  for (let i = 0; i < plans.length; i += LEAD_BULK_CHUNK_SIZE) {
    const chunk = plans.slice(i, i + LEAD_BULK_CHUNK_SIZE);
    await prisma.$transaction(
      chunk.flatMap((plan) => [
        prisma.lead.update({ where: { id: plan.id }, data: plan.data }),
        prisma.leadActivity.create({
          data: {
            leadId: plan.id,
            type: plan.activityType,
            payload: plan.activityPayload,
            actor: 'user',
            actorUserId,
          },
        }),
      ]),
    );
    updatedIds.push(...chunk.map((plan) => plan.id));
  }

  return {
    ok: true,
    updatedIds,
    skipped,
    summary: { requested: ids.length, updated: updatedIds.length, skipped: skipped.length },
  };
}
