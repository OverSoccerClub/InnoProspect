import type { LeadActivity, LeadDetail, LeadFilter, LeadListItem, LeadListResponse, LeadStatus, MessageItem, PhoneType } from '@/types/lead';
import { mockListCities, mockListUfs } from './locations';
import { mockNotFound, mulberry32, pick } from './utils';

const CATEGORIES = [
  'Clínica odontológica',
  'Restaurante',
  'Escritório de advocacia',
  'Pet shop',
  'Salão de beleza',
  'Academia',
  'Loja de roupas',
  'Oficina mecânica',
];

const NAME_PREFIXES = ['Clínica', 'Espaço', 'Studio', 'Centro', 'Grupo', 'Casa'];
const NAME_SUFFIXES = ['Sorriso', 'Vida', 'Bem-Estar', 'Premium', 'Popular', 'Central', 'Norte', 'Sul'];

const STATUSES: LeadStatus[] = ['new', 'validated', 'contacted', 'responded', 'negotiating', 'won', 'discarded'];
const PHONE_TYPES: PhoneType[] = ['mobile', 'mobile', 'mobile', 'landline', 'unknown'];

type MockLead = LeadDetail;

let leads: MockLead[] | null = null;

function buildLeads(): MockLead[] {
  const random = mulberry32(42);
  const ufs = mockListUfs().filter((u) => ['SP', 'ES', 'MG', 'RJ', 'BA'].includes(u.sigla));
  const result: MockLead[] = [];
  let counter = 1;

  for (const uf of ufs) {
    const cities = mockListCities(uf.sigla).slice(0, 8);
    for (const city of cities) {
      const leadsInCity = 2 + Math.floor(random() * 4);
      for (let i = 0; i < leadsInCity; i++) {
        const category = pick(CATEGORIES, random);
        const status = pick(STATUSES, random);
        const phoneType = pick(PHONE_TYPES, random);
        const hasWebsite = random() > 0.4;
        const isOptedOut = random() > 0.93;
        const id = `lead_${counter}`;
        const createdAt = new Date(Date.now() - Math.floor(random() * 60) * 86_400_000).toISOString();
        const phoneE164 =
          phoneType === 'unknown' ? null : `+55${String(11 + Math.floor(random() * 78)).padStart(2, '0')}9${String(Math.floor(random() * 100000000)).padStart(8, '0')}`;

        const activities: LeadActivity[] = [
          {
            id: `${id}_act_created`,
            leadId: id,
            type: 'created',
            payload: { source: 'scraper' },
            actor: 'system',
            createdAt,
          },
        ];
        if (status !== 'new') {
          activities.push({
            id: `${id}_act_status`,
            leadId: id,
            type: 'status_changed',
            payload: { from: 'new', to: status },
            actor: status === 'contacted' || status === 'responded' ? 'system' : 'user',
            createdAt: new Date(new Date(createdAt).getTime() + 86_400_000).toISOString(),
          });
        }

        const messages: MessageItem[] =
          status === 'contacted' || status === 'responded' || status === 'negotiating' || status === 'won'
            ? [
                {
                  id: `${id}_msg_1`,
                  direction: 'outbound',
                  body: `Olá! Tudo bem? Vi que vocês atuam com ${category.toLowerCase()} e gostaria de apresentar uma solução para atrair mais clientes.`,
                  status: 'delivered',
                  sentAt: createdAt,
                  deliveredAt: createdAt,
                  readAt: null,
                },
              ]
            : [];

        result.push({
          id,
          name: `${pick(NAME_PREFIXES, random)} ${pick(NAME_SUFFIXES, random)} ${city.nome}`,
          phoneE164,
          phoneType,
          address: `Rua ${counter}, ${100 + Math.floor(random() * 900)} — ${city.nome}`,
          city: city.nome,
          uf: uf.sigla,
          website: hasWebsite ? `https://www.exemplo${counter}.com.br` : null,
          category,
          rating: Math.round((3 + random() * 2) * 10) / 10,
          reviewCount: Math.floor(random() * 400),
          status,
          tags: random() > 0.7 ? ['prioridade'] : [],
          isOptedOut,
          lastContactedAt: messages.length > 0 ? messages[0]?.sentAt ?? null : null,
          createdAt,
          notes: null,
          latitude: null,
          longitude: null,
          source: { type: 'google_maps', url: null, collectedAt: createdAt, searchJobId: null },
          firstSeenAt: createdAt,
          lastSeenAt: createdAt,
          activities,
          messages,
        });
        counter++;
      }
    }
  }
  return result;
}

function getLeads(): MockLead[] {
  if (!leads) leads = buildLeads();
  return leads;
}

// btoa/atob (não Buffer): esse módulo roda tanto no client quanto no server.
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

export function mockListLeads(filter: LeadFilter): LeadListResponse {
  let items = getLeads();

  if (filter.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.phoneE164 ?? '').includes(q) ||
        (l.address ?? '').toLowerCase().includes(q),
    );
  }
  if (filter.status && filter.status.length > 0) items = items.filter((l) => filter.status?.includes(l.status));
  if (filter.uf && filter.uf.length > 0) items = items.filter((l) => l.uf && filter.uf?.includes(l.uf));
  if (filter.category && filter.category.length > 0)
    items = items.filter((l) => l.category && filter.category?.includes(l.category));
  if (filter.hasWebsite !== undefined) items = items.filter((l) => Boolean(l.website) === filter.hasWebsite);
  if (filter.hasPhone !== undefined) items = items.filter((l) => Boolean(l.phoneE164) === filter.hasPhone);
  if (filter.phoneType) items = items.filter((l) => l.phoneType === filter.phoneType);
  if (filter.minRating !== undefined) items = items.filter((l) => (l.rating ?? 0) >= filter.minRating!);
  if (filter.tags && filter.tags.length > 0) items = items.filter((l) => l.tags.some((t) => filter.tags?.includes(t)));

  // default do contrato: esconde opt-outs a menos que peçam explicitamente
  const optedOut = filter.optedOut ?? false;
  items = items.filter((l) => l.isOptedOut === optedOut || optedOut === true);

  const facets = {
    total: items.length,
    byStatus: STATUSES.reduce<Record<string, number>>((acc, s) => {
      acc[s] = items.filter((l) => l.status === s).length;
      return acc;
    }, {}),
  };

  const [sortField, sortDir] = (filter.sort ?? 'createdAt:desc').split(':');
  const dir = sortDir === 'asc' ? 1 : -1;
  items = [...items].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortField ?? 'createdAt'];
    const bv = (b as unknown as Record<string, unknown>)[sortField ?? 'createdAt'];
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return av > bv ? dir : -dir;
  });

  const limit = Math.min(100, filter.limit ?? 25);
  const start = decodeCursor(filter.cursor);
  const pageItems = items.slice(start, start + limit);
  const nextIndex = start + limit;
  const nextCursor = nextIndex < items.length ? encodeCursor(nextIndex) : null;

  const data: LeadListItem[] = pageItems.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phoneE164: lead.phoneE164,
    phoneType: lead.phoneType,
    address: lead.address,
    city: lead.city,
    uf: lead.uf,
    website: lead.website,
    category: lead.category,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    status: lead.status,
    tags: lead.tags,
    isOptedOut: lead.isOptedOut,
    lastContactedAt: lead.lastContactedAt,
    createdAt: lead.createdAt,
  }));

  return {
    data,
    page: { cursor: filter.cursor ?? null, nextCursor, limit, total: items.length },
    facets,
  };
}

export function mockGetLead(id: string): LeadDetail {
  const lead = getLeads().find((l) => l.id === id);
  if (!lead) mockNotFound(`Lead "${id}" não encontrado.`);
  return lead;
}

export function mockPatchLead(id: string, patch: Partial<LeadDetail>): LeadDetail {
  const all = getLeads();
  const index = all.findIndex((l) => l.id === id);
  if (index === -1) mockNotFound(`Lead "${id}" não encontrado.`);
  const current = all[index]!;
  const updated: MockLead = { ...current, ...patch };
  if (patch.status && patch.status !== current.status) {
    updated.activities = [
      ...current.activities,
      {
        id: `${id}_act_${Date.now()}`,
        leadId: id,
        type: 'status_changed',
        payload: { from: current.status, to: patch.status },
        actor: 'user',
        createdAt: new Date().toISOString(),
      },
    ];
  }
  all[index] = updated;
  return updated;
}
