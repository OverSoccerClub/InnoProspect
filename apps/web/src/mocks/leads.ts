import { formatPhone } from '@/lib/format';
import { clampPage, computeTotalPages, normalizePageSize } from '@/lib/pagination';
import { evaluateSendWindow } from '@/lib/send-window';
import {
  checkSpintaxSyntax,
  countVariations,
  extractKnownVariables,
  findUnknownVariables,
  type KnownVariable,
  renderWithSeed,
} from '@/lib/spintax';
import type {
  BulkLeadsBody,
  BulkLeadsResponse,
  BulkLeadsSkippedItem,
  LeadActivity,
  LeadDetail,
  LeadExportColumn,
  LeadListItem,
  LeadListResponse,
  LeadFilter,
  LeadStatus,
  MessageItem,
  PhoneType,
} from '@/types/lead';
import type {
  LeadMessagePreviewResponse,
  SendLeadMessageRequest,
  SendLeadMessageResponse,
  SendMessageWarning,
} from '@/types/lead-message';
import type { TemplateItem } from '@/types/template';
import { mockListCities, mockListUfs } from './locations';
import { LEAD_ORIGIN_JOB_BY_CATEGORY } from './searches';
import { mockGetTemplate } from './templates';
import { mockConflict, mockNotFound, mockUpstreamError, mockValidationError, mulberry32, pick } from './utils';
import {
  mockFindInstanceRaw,
  mockListInstancesRaw,
  mockRefundInstanceQuota,
  mockReserveInstanceQuota,
} from './whatsapp';

const CATEGORIES = [
  'Clínica odontológica',
  'Restaurante',
  'Escritório de advocacia',
  'Pet shop',
  'Salão de beleza',
  'Academia',
  'Loja de roupas',
  'Oficina mecânica',
  // Categoria real do pedido do dono (2026-09-23) — a busca por este nicho é
  // a que gerou os leads "fora do nicho" abaixo (ver ARCHITECTURE_OFF_NICHE_DEMO).
  'Escritório de arquitetura',
];

// Nomes de empresa por categoria (fictícios, mas plausíveis) — a versão
// anterior combinava um prefixo + sufixo genérico com o nome da cidade
// ("Studio Premium Monte Fundo 36"), o que ficava repetitivo e artificial em
// qualquer lista visível (Leads recentes, ficha do lead). Cada categoria tem
// seu próprio banco de nomes "de negócio de verdade"; o nome da cidade é
// anexado só em parte dos casos, como aconteceria na vida real.
const CATEGORY_NAME_POOL: Record<string, string[]> = {
  'Clínica odontológica': [
    'Sorriso Feliz Odontologia',
    'OdontoVida',
    'Clínica Dental Bem-Estar',
    'Espaço Sorriso',
    'Odonto Excellence',
    'Clínica Dentária Nova Geração',
    'Centro Odontológico Vitalle',
    'Sorriso & Saúde',
  ],
  Restaurante: [
    'Sabor da Serra',
    'Cantina Bella Itália',
    'Point do Sabor',
    'Restaurante Raízes',
    'Sabor Caseiro',
    'Empório Gourmet',
    'Recanto do Sabor',
    'Fogo de Chão Grill',
  ],
  'Escritório de advocacia': [
    'Silva & Associados Advocacia',
    'Escritório Jurídico Horizonte',
    'Martins Advogados',
    'Bittencourt & Costa Advocacia',
    'Advocacia Central',
    'Andrade Advogados Associados',
    'Prime Advocacia Empresarial',
  ],
  'Pet shop': ['Pet Amigo', 'Mundo Animal', 'Vida Animal Pet Shop', 'Cão & Gato', 'Pet Center', 'Focinho Feliz', 'Pet House'],
  'Salão de beleza': [
    'Salão Elegance',
    'Studio Beleza Pura',
    'Espaço Glamour',
    'Salão Charme',
    'Beleza Natural',
    'Studio Hair Design',
    'Salão Reflexo',
  ],
  Academia: [
    'Academia Fit Life',
    'PowerGym',
    'Academia Corpo em Forma',
    'Studio Fitness',
    'Academia Vitalidade',
    'Box Cross Training',
    'Academia Evolução',
  ],
  'Loja de roupas': ['Moda Bella', 'Loja Estilo Próprio', 'Boutique Elegance', 'Fashion Store', 'Loja Trend', 'Espaço Moda'],
  'Oficina mecânica': [
    'Oficina Motor Show',
    'Auto Center Confiança',
    'Mecânica do Zé',
    'Oficina Rápida',
    'Total Car Serviços',
    'Auto Peças e Serviços',
  ],
  'Escritório de arquitetura': [
    'Estúdio Arquitetura Viva',
    'Atelier de Projetos Horizonte',
    'Arquitetura & Espaço',
    'Traço Fino Arquitetura',
    'Casa Croqui Arquitetura',
    'Núcleo Arquitetônico',
  ],
};

const STATUSES: LeadStatus[] = ['new', 'validated', 'contacted', 'responded', 'negotiating', 'won', 'discarded'];
const PHONE_TYPES: PhoneType[] = ['mobile', 'mobile', 'mobile', 'landline', 'unknown'];

/**
 * Guarda `messages` no formato completo (`MessageItem`, com `instanceId`)
 * mesmo sabendo que `GET /leads/:id` de verdade devolve o resumo
 * (`LeadMessageSummary`, ver types/lead.ts) — é exatamente o que o backend
 * real faz também: `resolveInstanceForSend` (Vega, `lib/services/messages.ts`)
 * consulta `prisma.message.findFirst` para pegar `instanceId` da última
 * mensagem, não confia no formato serializado da ficha. `mockGetLead`
 * (a "resposta HTTP" simulada) segue expondo o formato completo por
 * enquanto — ver TODO no handoff sobre `leadDetailSchema.messages`.
 */
type MockLead = Omit<LeadDetail, 'messages'> & { messages: MessageItem[] };

let leads: MockLead[] | null = null;

/**
 * Reproduz, com nome e categoria reais, o caso que o dono relatou
 * (2026-09-23): buscou "escritório de arquitetura" e a lista trouxe Magazine
 * Luiza, Cartório Benício, INFONOT Computadores e Ciano Cópias — resultados
 * geograficamente próximos, sem relação com o nicho buscado. Ficam anexados
 * à MESMA busca (`search_arquitetura_demo`) que os escritórios de
 * arquitetura de verdade, para o filtro "por busca" e o selo "fora do nicho"
 * serem verificáveis lado a lado com um cenário que o dono já viu na prática
 * — não um exemplo genérico.
 */
function buildArchitectureOffNicheDemoLeads(random: () => number, startCounter: number): MockLead[] {
  const job = LEAD_ORIGIN_JOB_BY_CATEGORY['Escritório de arquitetura']!;
  const demo: Array<{ name: string; category: string; hasWebsite: boolean }> = [
    // Categorias alinhadas 1:1 com o exemplo real citado em
    // `packages/core/src/leads/niche.ts` (Vega) — mesmo relato do dono,
    // descrito nos dois lados independentemente; manter os textos iguais
    // evita qualquer estranheza ao comparar o critério real com este mock.
    { name: 'Magazine Luiza', category: 'Loja de departamentos', hasWebsite: true },
    { name: 'Cartório Benício', category: 'Cartório de registro', hasWebsite: false },
    { name: 'INFONOT Computadores', category: 'Assistência técnica', hasWebsite: true },
    { name: 'Ciano Cópias', category: 'Copiadora', hasWebsite: false },
  ];

  const items: MockLead[] = demo.map((item, index): MockLead => {
    const counter = startCounter + index;
    const id = `lead_${counter}`;
    const createdAt = new Date(Date.now() - (10 + index) * 86_400_000).toISOString();
    const phoneE164 = `+55119${String(70000000 + counter).padStart(8, '0')}`;
    return {
      id,
      name: item.name,
      phoneE164,
      phoneType: 'mobile',
      address: `Av. Paulista, ${1000 + counter} — São Paulo`,
      city: 'São Paulo',
      uf: 'SP',
      website: item.hasWebsite ? `https://www.${item.name.toLowerCase().replace(/\s+/g, '')}.com.br` : null,
      category: item.category,
      rating: Math.round((3.5 + random() * 1.5) * 10) / 10,
      reviewCount: Math.floor(random() * 800),
      status: 'new',
      tags: [],
      isOptedOut: false,
      lastContactedAt: null,
      createdAt,
      searchJobId: job.id,
      searchNiche: job.niche,
      offNiche: true,
      notes: null,
      latitude: null,
      longitude: null,
      source: { type: 'google_maps', url: null, collectedAt: createdAt, searchJobId: job.id },
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      activities: [
        { id: `${id}_act_created`, leadId: id, type: 'created', payload: { source: 'scraper' }, actor: 'system', createdAt },
      ],
      messages: [],
    };
  });
  return items;
}

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
        // Origem da busca: por padrão a busca cujo nicho é a própria
        // categoria do lead. ~7% das vezes o lead "vaza" para a busca de OUTRO
        // nicho — reproduz o comportamento real relatado pelo dono: o Google
        // Maps devolve resultados próximos geograficamente, não só do nicho
        // buscado (decisão dele: marcar como fora do nicho, nunca descartar).
        let originJob = LEAD_ORIGIN_JOB_BY_CATEGORY[category]!;
        let offNiche = false;
        if (random() < 0.07) {
          const otherCategories = CATEGORIES.filter((c) => c !== category);
          originJob = LEAD_ORIGIN_JOB_BY_CATEGORY[pick(otherCategories, random)]!;
          offNiche = true;
        }
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
                  leadId: id,
                  campaignTargetId: null,
                  instanceId: 'wa_1',
                  direction: 'outbound',
                  body: `Olá! Tudo bem? Vi que vocês atuam com ${category.toLowerCase()} e gostaria de apresentar uma solução para atrair mais clientes. Se preferir não receber mais mensagens, responda SAIR.`,
                  providerMessageId: `mock-prov-${id}-1`,
                  status: 'delivered',
                  errorCode: null,
                  sentAt: createdAt,
                  deliveredAt: createdAt,
                  readAt: null,
                },
              ]
            : [];

        const namePool = CATEGORY_NAME_POOL[category] ?? [category];
        const baseName = pick(namePool, random);
        // Só cerca de metade dos nomes leva o nome da cidade junto — negócio
        // de verdade nem sempre inclui a cidade no nome.
        const businessName = random() > 0.55 ? `${baseName} ${city.nome}` : baseName;

        result.push({
          id,
          name: businessName,
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
          searchJobId: originJob.id,
          searchNiche: originJob.niche,
          offNiche,
          notes: null,
          latitude: null,
          longitude: null,
          source: { type: 'google_maps', url: null, collectedAt: createdAt, searchJobId: originJob.id },
          firstSeenAt: createdAt,
          lastSeenAt: createdAt,
          activities,
          messages,
        });
        counter++;
      }
    }
  }

  result.push(...buildArchitectureOffNicheDemoLeads(random, counter));

  // Dois leads recebem uma conversa "de verdade" (várias mensagens, status
  // variado, uma delas terminando em opt-out) — para a ficha do lead ter algo
  // rico para mostrar sem depender de gerar dado via envio manual primeiro.
  const optedOutDemo = result.find((l) => l.isOptedOut);
  if (optedOutDemo) attachDemoConversation(optedOutDemo, { optedOut: true });
  const richDemo = result.find((l) => !l.isOptedOut && l.phoneType === 'mobile' && l.status === 'responded');
  if (richDemo) attachDemoConversation(richDemo, { optedOut: false });

  return result;
}

/** Substitui a conversa de um lead por uma sequência plausível — só para demo/screenshot. */
function attachDemoConversation(lead: MockLead, opts: { optedOut: boolean }): void {
  const base = new Date(lead.createdAt).getTime();
  const at = (offsetMin: number) => new Date(base + offsetMin * 60_000).toISOString();

  const opener: MessageItem = {
    id: `${lead.id}_msg_demo_1`,
    leadId: lead.id,
    campaignTargetId: null,
    instanceId: 'wa_1',
    direction: 'outbound',
    body: `Olá! Tudo bem? Aqui é da InnoProspect. Vi que a ${lead.name} atua com ${(lead.category ?? 'o segmento').toLowerCase()} em ${lead.city ?? 'sua região'} e separei uma condição especial para quem ainda não conhece a gente.\n\nSe preferir não receber mais mensagens, responda SAIR.`,
    providerMessageId: `mock-prov-${lead.id}-1`,
    status: 'read',
    errorCode: null,
    sentAt: at(0),
    deliveredAt: at(1),
    readAt: at(6),
  };

  if (opts.optedOut) {
    const optOutReply: MessageItem = {
      id: `${lead.id}_msg_demo_2`,
      leadId: lead.id,
      campaignTargetId: null,
      instanceId: 'wa_1',
      direction: 'inbound',
      body: 'SAIR',
      providerMessageId: null,
      status: 'read',
      errorCode: null,
      sentAt: at(8),
      deliveredAt: at(8),
      readAt: at(8),
    };
    lead.messages = [opener, optOutReply];
    lead.activities = [
      ...lead.activities,
      {
        id: `${lead.id}_act_optout`,
        leadId: lead.id,
        type: 'opted_out',
        payload: { messageId: optOutReply.id },
        actor: 'lead',
        createdAt: at(8),
      },
    ];
    lead.lastContactedAt = opener.sentAt;
    lead.isOptedOut = true;
    return;
  }

  const reply: MessageItem = {
    id: `${lead.id}_msg_demo_2`,
    leadId: lead.id,
    campaignTargetId: null,
    instanceId: 'wa_1',
    direction: 'inbound',
    body: 'Oi! Pode me contar mais sobre os valores?',
    providerMessageId: null,
    status: 'read',
    errorCode: null,
    sentAt: at(22),
    deliveredAt: at(22),
    readAt: at(22),
  };
  const followUp: MessageItem = {
    id: `${lead.id}_msg_demo_3`,
    leadId: lead.id,
    campaignTargetId: null,
    instanceId: 'wa_1',
    direction: 'outbound',
    body: 'Claro! Temos planos a partir de R$ 197/mês, com teste grátis de 7 dias. Posso te enviar os detalhes por aqui mesmo?',
    providerMessageId: `mock-prov-${lead.id}-3`,
    status: 'delivered',
    errorCode: null,
    sentAt: at(26),
    deliveredAt: at(27),
    readAt: null,
  };
  lead.messages = [opener, reply, followUp];
  lead.lastContactedAt = followUp.sentAt;
  lead.activities = [
    ...lead.activities,
    {
      id: `${lead.id}_act_msg_received`,
      leadId: lead.id,
      type: 'message_received',
      payload: null,
      actor: 'lead',
      createdAt: at(22),
    },
  ];
}

function getLeads(): MockLead[] {
  if (!leads) leads = buildLeads();
  return leads;
}

/**
 * Filtragem compartilhada entre `mockListLeads` (paginada) e
 * `mockExportLeadsCsv`/`mockBulkUpdateLeads` (dump/alvo completo do filtro,
 * sem paginação) — extraída para as duas rotas nunca divergirem sobre o que
 * "o filtro atual" significa (o mesmo risco que motivou `resolveLeadWhere`
 * ser reaproveitado pelo Vega entre `listLeads`/`countLeadsForExport`/
 * `iterateLeadsForExport` no backend real).
 */
function filterLeads(filter: LeadFilter): MockLead[] {
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
  if (filter.searchJobId) items = items.filter((l) => l.searchJobId === filter.searchJobId);
  if (filter.offNiche !== undefined) items = items.filter((l) => l.offNiche === filter.offNiche);

  // default do contrato: esconde opt-outs a menos que peçam explicitamente
  const optedOut = filter.optedOut ?? false;
  items = items.filter((l) => l.isOptedOut === optedOut || optedOut === true);

  return items;
}

/**
 * `GET /leads` — paginação NUMERADA (`page`/`pageSize`), não cursor (ver
 * `types/lead.ts` e a nota em `lib/api/leads.ts`). Usa os mesmos
 * `computeTotalPages`/`clampPage` de `lib/pagination.ts` que a tela usa do
 * lado do cliente — os dois lados nunca podem discordar sobre qual é a
 * "última página válida" quando um filtro reduz o resultado.
 */
export function mockListLeads(filter: LeadFilter): LeadListResponse {
  let items = filterLeads(filter);

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

  const pageSize = normalizePageSize(filter.pageSize);
  const totalPages = computeTotalPages(items.length, pageSize);
  const page = clampPage(filter.page ?? 1, totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

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
    searchJobId: lead.searchJobId,
    searchNiche: lead.searchNiche,
    offNiche: lead.offNiche,
  }));

  return {
    data,
    page,
    pageSize,
    total: items.length,
    totalPages,
    facets,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /leads/export (CSV) — mesmo formato de `lib/services/leads.ts`
// (`buildCsvLine`/`escapeCsvField`/`CSV_BOM`/separador `;`), duplicado aqui
// de propósito: aquele arquivo importa `@inno/db` (Prisma), que não pode
// entrar no bundle do client. As colunas (`LEAD_EXPORT_COLUMNS`) vêm de
// `@inno/contracts` de verdade (zero duplicação ali — é zod puro, seguro
// para os dois lados); só a FORMATAÇÃO da linha está copiada. Se o formato
// do CSV mudar no backend, atualizar aqui também (ver ARQUITETURA §4.3).
// ─────────────────────────────────────────────────────────────────────────

const MOCK_CSV_SEPARATOR = ';';
const MOCK_CSV_NEWLINE = '\r\n';
const MOCK_CSV_BOM = '﻿';
const MOCK_CSV_FORMULA_TRIGGER = new Set(['=', '+', '-', '@']);

function mockEscapeCsvField(raw: string): string {
  let value = raw;
  if (value.length > 0 && MOCK_CSV_FORMULA_TRIGGER.has(value[0]!)) value = `'${value}`;
  if (/["\r\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function mockBuildCsvLine(values: readonly string[]): string {
  return values.map(mockEscapeCsvField).join(MOCK_CSV_SEPARATOR) + MOCK_CSV_NEWLINE;
}

function mockBuildExportRow(lead: MockLead): Record<LeadExportColumn, string> {
  return {
    nome: lead.name,
    telefone: lead.phoneE164 ?? '',
    tipo_telefone: lead.phoneType,
    endereco: lead.address ?? '',
    cidade: lead.city ?? '',
    uf: lead.uf ?? '',
    site: lead.website ?? '',
    categoria: lead.category ?? '',
    // Vírgula decimal (pt-BR) — combina com o separador `;` da linha, igual ao backend real.
    nota: lead.rating !== null ? String(lead.rating).replace('.', ',') : '',
    avaliacoes: lead.reviewCount !== null ? String(lead.reviewCount) : '',
    status: lead.status,
    tags: lead.tags.join('|'),
    descadastrado: lead.isOptedOut ? 'sim' : 'não',
    origem_url: lead.source.url ?? '',
    coletado_em: lead.source.collectedAt,
  };
}

/** `GET /leads/export` — dump completo do filtro (sem paginação), pronto para virar um `Blob` no client. */
export function mockExportLeadsCsv(filter: LeadFilter, columns: readonly LeadExportColumn[]): { filename: string; csv: string } {
  const items = filterLeads(filter);
  const lines = [mockBuildCsvLine(columns)];
  for (const lead of items) {
    const row = mockBuildExportRow(lead);
    lines.push(mockBuildCsvLine(columns.map((column) => row[column])));
  }
  const now = new Date();
  return { filename: `leads-${now.toISOString().slice(0, 10)}.csv`, csv: MOCK_CSV_BOM + lines.join('') };
}

// ─────────────────────────────────────────────────────────────────────────
// POST /leads/bulk — versão simplificada do `bulkUpdateLeads` real
// (`lib/services/leads.ts`): aplica `set_status`/`add_tags`/`remove_tags`
// por `leadIds` (a tela só usa seleção de linhas visíveis, nunca `filter` +
// `expectedCount` — ver TODO no handoff se a Onda 3 quiser "selecionar todos
// os N do filtro"). NÃO valida a máquina de estados de status
// (`checkStatusTransition`) — isso é regra de negócio do Vega; o mock só
// cobre o caminho feliz + `NO_CHANGE`, suficiente para testar a UI.
// ─────────────────────────────────────────────────────────────────────────

export function mockBulkUpdateLeads(body: BulkLeadsBody): BulkLeadsResponse {
  const ids = body.leadIds ?? [];
  const all = getLeads();
  const skipped: BulkLeadsSkippedItem[] = [];
  const updatedIds: string[] = [];

  for (const id of ids) {
    const index = all.findIndex((l) => l.id === id);
    if (index === -1) {
      skipped.push({ id, reason: 'NOT_FOUND', message: 'Lead não encontrado.' });
      continue;
    }
    const lead = all[index]!;

    if (body.action === 'set_status') {
      const to = body.value.status!;
      if (to === lead.status) {
        skipped.push({ id, reason: 'NO_CHANGE', message: `o lead já está em '${to}'` });
        continue;
      }
      const from = lead.status;
      all[index] = {
        ...lead,
        status: to,
        activities: [
          ...lead.activities,
          {
            id: `${id}_act_bulk_${Date.now()}`,
            leadId: id,
            type: 'status_changed',
            payload: { from, to },
            actor: 'user',
            createdAt: new Date().toISOString(),
          },
        ],
      };
      updatedIds.push(id);
      continue;
    }

    const tagsToApply = body.value.tags ?? [];
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
          body.action === 'add_tags' ? 'o lead já tinha todas as tags informadas' : 'o lead não tinha nenhuma das tags informadas',
      });
      continue;
    }
    all[index] = {
      ...lead,
      tags: [...current],
      activities: [
        ...lead.activities,
        {
          id: `${id}_act_bulk_${Date.now()}`,
          leadId: id,
          type: body.action === 'add_tags' ? 'tags_added' : 'tags_removed',
          payload: { tags: tagsToApply },
          actor: 'user',
          createdAt: new Date().toISOString(),
        },
      ],
    };
    updatedIds.push(id);
  }

  return {
    ok: true,
    updatedIds,
    skipped,
    summary: { requested: ids.length, updated: updatedIds.length, skipped: skipped.length },
  };
}

/** Referência mutável ao registro persistente — só para quem precisa gravar (`mockSendLeadMessage`). */
function getLeadRecord(id: string): MockLead {
  const lead = getLeads().find((l) => l.id === id);
  if (!lead) mockNotFound(`Lead "${id}" não encontrado.`, 'LEAD_NOT_FOUND');
  return lead;
}

/**
 * `GET /leads/:id` — snapshot (cópia rasa), nunca a referência viva.
 * ⚠️ Bug real encontrado testando o envio: quando isto devolvia a referência
 * direta, o estado do React (`setLead`) e o registro do mock passavam a
 * apontar para o MESMO objeto. `mockSendLeadMessage` empurra a mensagem no
 * registro (`getLeadRecord`) e devolve `{ message }`; se o chamador (UI)
 * também faz `[...lead.messages, response.message]` sobre esse estado, a
 * mensagem aparece duas vezes — o array já tinha sido mutado por baixo.
 * Mock devolvendo cópia é o mesmo contrato de uma API HTTP real (JSON
 * sempre desacopla o cliente do armazenamento) — evita essa classe de bug.
 */
export function mockGetLead(id: string): LeadDetail {
  const lead = getLeadRecord(id);
  return { ...lead, activities: [...lead.activities], messages: [...lead.messages], tags: [...lead.tags] };
}

export function mockPatchLead(id: string, patch: Partial<Omit<LeadDetail, 'messages'>>): LeadDetail {
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

// ─────────────────────────────────────────────────────────────────────────
// Envio unitário de mensagem (ARQUITETURA.md §4.9) — POST /leads/:id/messages
// e o preview que o alimenta. O Vega implementa a rota real em paralelo;
// este mock segue a §4.9.3 (portões, na mesma ordem) e a §4.9.6 (janela).
// ─────────────────────────────────────────────────────────────────────────

/** Valores reais do lead para as variáveis conhecidas (ARQUITETURA §4.4/§4.9.4). */
function leadVariableValues(lead: LeadDetail): Partial<Record<KnownVariable, string>> {
  const values: Partial<Record<KnownVariable, string>> = {
    // ⚠️ Sem endpoint de "minha empresa" (config do tenant) ainda — placeholder
    // fixo, igual ao preview genérico do editor de template. Confirmar com o
    // Vega de onde isso vem quando a rota real existir.
    minha_empresa: 'Sua Empresa',
  };
  if (lead.name) {
    values.nome = lead.name;
    values.primeiro_nome = lead.name.trim().split(/\s+/)[0];
  }
  if (lead.city) values.cidade = lead.city;
  if (lead.uf) values.uf = lead.uf;
  if (lead.category) values.categoria = lead.category;
  if (lead.website) values.site = lead.website;
  if (lead.phoneE164) values.telefone = formatPhone(lead.phoneE164);
  return values;
}

function defaultSpintaxSeed(leadId: string, templateId: string, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  return `${leadId}:${templateId}:${today}`;
}

/** `POST /templates/:id/preview` com `leadId` — variáveis reais + variações de spintax seedadas (§4.9.4). */
export function mockPreviewLeadMessage(leadId: string, templateId: string, sampleCount = 3): LeadMessagePreviewResponse {
  const lead = mockGetLead(leadId);
  const template = mockGetTemplate(templateId);
  const values = leadVariableValues(lead);
  const usedVariables = extractKnownVariables(template.body);
  const missingVariables = usedVariables.filter((v) => v !== 'minha_empresa' && !values[v]);

  const baseSeed = defaultSpintaxSeed(leadId, templateId);
  // Sem sentido oferecer 3 "variações" idênticas quando o template não tem
  // spintax — trava no número real de combinações possíveis.
  const variationCount = Math.min(sampleCount, countVariations(template.body));
  const previews = Array.from({ length: variationCount }, (_, i) => {
    const seed = i === 0 ? baseSeed : `${baseSeed}#${i + 1}`;
    const text = renderWithSeed(template.body, seed, values);
    return { text, length: text.length, spintaxSeed: seed };
  });

  return { previews, missingVariables };
}

const INSTANCE_STATUS_LABEL: Record<string, string> = {
  disconnected: 'desconectada',
  connecting: 'conectando',
  qr_pending: 'aguardando QR code',
  connected: 'conectada',
  banned: 'banida',
};

function quotaResetsAt(now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export function mockSendLeadMessage(leadId: string, input: SendLeadMessageRequest): SendLeadMessageResponse {
  const now = new Date();
  const lead = getLeadRecord(leadId); // G1 (lead) — registro vivo: este fluxo grava (write-ahead, §4.9.5)

  // G2 — payload
  const hasTemplate = Boolean(input.templateId?.trim());
  const hasBody = Boolean(input.body?.trim());
  if (hasTemplate === hasBody) {
    mockValidationError('BODY_OR_TEMPLATE_REQUIRED', 'Escolha um template ou digite uma mensagem — nunca os dois, nem nenhum.');
  }

  let finalText: string;
  let renderedFrom: SendLeadMessageResponse['renderedFrom'] = null;

  if (hasTemplate) {
    let template: TemplateItem;
    try {
      template = mockGetTemplate(input.templateId!);
    } catch {
      mockNotFound(`Template "${input.templateId}" não encontrado.`, 'TEMPLATE_NOT_FOUND');
    }
    const unknown = findUnknownVariables(template.body);
    if (unknown.length > 0) {
      mockValidationError('UNKNOWN_VARIABLE', `Variável desconhecida no template: {{${unknown[0]}}}.`);
    }
    const syntaxIssues = checkSpintaxSyntax(template.body);
    if (syntaxIssues.length > 0) {
      mockValidationError('INVALID_SPINTAX', syntaxIssues[0]!.message);
    }
    const seed = input.spintaxSeed ?? defaultSpintaxSeed(leadId, template.id, now);
    finalText = renderWithSeed(template.body, seed, leadVariableValues(lead));
    renderedFrom = { templateId: template.id, spintaxSeed: seed };
  } else {
    const body = input.body!.trim();
    if (body.length < 1 || body.length > 4000) {
      mockValidationError('BODY_TOO_LONG', 'A mensagem precisa ter entre 1 e 4000 caracteres.');
    }
    finalText = body;
  }

  // G3 — telefone
  if (!lead.phoneE164) {
    mockConflict('LEAD_HAS_NO_PHONE', 'Este lead não tem um telefone cadastrado — não há para onde enviar.');
  }

  // G4 — celular
  if (lead.phoneType !== 'mobile' && !input.allowNonMobile) {
    mockConflict(
      'LEAD_NOT_MOBILE',
      lead.phoneType === 'landline'
        ? 'Este número está classificado como fixo — fixos não recebem WhatsApp. Confirme se quer enviar mesmo assim.'
        : 'Não temos certeza se este número é celular. Confirme se quer enviar mesmo assim.',
    );
  }

  // G5/G6 — janela de envio
  const window = evaluateSendWindow(now);
  if (window.level === 'quiet_hours') {
    mockConflict(
      'QUIET_HOURS',
      `Fora do horário permitido para contato comercial (08h–20h, exceto domingo). Você poderá enviar a partir de ${formatWindowTime(window.nextOpensAt)}.`,
      { details: [{ path: 'nextWindowOpensAt', message: window.nextOpensAt.toISOString() }] },
    );
  }
  if (window.level === 'outside_business' && !input.confirmOutsideBusinessWindow) {
    mockConflict(
      'OUTSIDE_BUSINESS_WINDOW',
      `Fora do horário comercial (09h–18h, seg. a sex.). A próxima janela comercial abre em ${formatWindowTime(window.nextOpensAt)}. Você pode confirmar o envio mesmo assim.`,
      { details: [{ path: 'nextWindowOpensAt', message: window.nextOpensAt.toISOString() }] },
    );
  }

  // G7 — instância
  const instance = pickInstanceForSend(lead, input.instanceId);

  // G8 — cota diária
  if (instance.today.remaining <= 0) {
    mockConflict(
      'DAILY_LIMIT_REACHED',
      `A instância "${instance.name}" já atingiu o limite de envios de hoje (aquecimento). Tente novamente amanhã ou escolha outro número.`,
      { details: [{ path: 'resetsAt', message: quotaResetsAt(now) }] },
    );
  }

  // G9 — duplo clique
  const lastOutbound = [...lead.messages].reverse().find((m) => m.direction === 'outbound');
  if (lastOutbound?.sentAt && now.getTime() - new Date(lastOutbound.sentAt).getTime() < 60_000) {
    mockConflict('DUPLICATE_SEND', 'Acabamos de enviar uma mensagem para este lead. Aguarde um minuto antes de enviar de novo.');
  }

  // G10 — primeiro contato frio
  const isColdFirstContact = lead.messages.length === 0;
  if (isColdFirstContact) {
    if (hasTemplate && renderedFrom) {
      const template = mockGetTemplate(renderedFrom.templateId);
      if (!extractKnownVariables(template.body).includes('minha_empresa')) {
        mockConflict('MISSING_COMPANY_NAME', 'Primeiro contato precisa dizer quem está enviando — adicione {{minha_empresa}} ao template.');
      }
    }
    if (!/\bsair\b/i.test(finalText)) {
      mockConflict('MISSING_OPTOUT_NOTICE', 'Primeiro contato precisa oferecer uma saída fácil (ex.: "responda SAIR para não receber mais mensagens").');
    }
  }

  // G11 — opt-out (checagem "sem cache", a mais próxima da rede)
  if (lead.isOptedOut) {
    const optOutActivity = lead.activities.find((a) => a.type === 'opted_out');
    mockConflict('OPTED_OUT', 'Este número pediu para não receber mais mensagens. Não é possível enviar — esse bloqueio é definitivo.', {
      details: optOutActivity ? [{ path: 'optedOutAt', message: optOutActivity.createdAt }] : undefined,
    });
  }

  // "Envio" — write-ahead: reserva a cota antes de "chamar a rede".
  mockReserveInstanceQuota(instance.id);
  const shouldFail = mulberry32(hashCode(`${leadId}:${now.getTime()}`))() < 0.04;

  const message: MessageItem = {
    id: `${leadId}_msg_${Date.now()}`,
    leadId,
    campaignTargetId: null,
    instanceId: instance.id,
    direction: 'outbound',
    body: finalText,
    providerMessageId: shouldFail ? null : `mock-prov-${leadId}-${Date.now()}`,
    status: shouldFail ? 'failed' : 'sent',
    errorCode: shouldFail ? 'EVOLUTION_TRANSIENT' : null,
    sentAt: shouldFail ? null : now.toISOString(),
    deliveredAt: null,
    readAt: null,
  };
  lead.messages = [...lead.messages, message];

  if (shouldFail) {
    mockRefundInstanceQuota(instance.id);
    lead.activities = [
      ...lead.activities,
      { id: `${leadId}_act_${Date.now()}`, leadId, type: 'message_failed', payload: { messageId: message.id }, actor: 'system', createdAt: now.toISOString() },
    ];
    mockUpstreamError('EVOLUTION_TRANSIENT', 'A Evolution não respondeu a tempo. A mensagem ficou registrada como falhou — você pode tentar de novo.');
  }

  lead.lastContactedAt = message.sentAt;
  if (lead.status === 'new' || lead.status === 'validated') {
    const from = lead.status;
    lead.status = 'contacted';
    lead.activities = [
      ...lead.activities,
      { id: `${leadId}_act_${Date.now()}_status`, leadId, type: 'status_changed', payload: { from, to: 'contacted' }, actor: 'system', createdAt: now.toISOString() },
    ];
  }
  lead.activities = [
    ...lead.activities,
    { id: `${leadId}_act_${Date.now()}_sent`, leadId, type: 'message_sent', payload: { messageId: message.id, instanceId: instance.id }, actor: 'user', createdAt: now.toISOString() },
  ];

  const warnings: SendMessageWarning[] = [];
  if (window.level === 'outside_business') {
    warnings.push({ code: 'OUTSIDE_BUSINESS_WINDOW_CONFIRMED', message: 'Enviado fora do horário comercial, conforme confirmado.' });
  }
  if (lead.phoneType !== 'mobile' && input.allowNonMobile) {
    warnings.push({ code: 'NON_MOBILE_CONFIRMED', message: 'Enviado para um número não confirmado como celular.' });
  }
  if (instance.health === 'degraded') {
    warnings.push({ code: 'INSTANCE_DEGRADED', message: 'Esta instância teve falhas recentes e está degradada — considere usar outra.' });
  }
  if (instance.today.remaining <= Math.ceil(instance.warmup.dailyLimit * 0.1)) {
    warnings.push({ code: 'LOW_QUOTA_REMAINING', message: `Restam poucos envios hoje nesta instância (${instance.today.remaining}).` });
  }
  if (!isColdFirstContact && !/\bsair\b/i.test(finalText)) {
    warnings.push({ code: 'NO_OPTOUT_NOTICE_IN_REPLY', message: 'Esta resposta não menciona a opção de sair da lista.' });
  }

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
    renderedFrom,
    warnings,
  };
}

function formatWindowTime(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

/** Afinidade lead→instância, depois maior cota entre as conectadas (ARQUITETURA §4.9.4). */
function pickInstanceForSend(lead: MockLead, requestedInstanceId?: string) {
  if (requestedInstanceId) {
    const instance = mockFindInstanceRaw(requestedInstanceId);
    if (!instance) mockNotFound(`Instância "${requestedInstanceId}" não encontrada.`, 'INSTANCE_NOT_FOUND');
    if (instance.status === 'banned') {
      mockConflict('INSTANCE_BANNED', `A instância "${instance.name}" foi banida pelo WhatsApp e não pode mais enviar mensagens.`);
    }
    if (instance.status !== 'connected') {
      mockConflict('INSTANCE_NOT_CONNECTED', `A instância "${instance.name}" está ${INSTANCE_STATUS_LABEL[instance.status] ?? instance.status}. Conecte-a antes de enviar.`);
    }
    return instance;
  }

  const lastMessage = [...lead.messages].reverse()[0];
  if (lastMessage) {
    const affinity = mockFindInstanceRaw(lastMessage.instanceId);
    if (affinity && affinity.status === 'connected' && affinity.today.remaining > 0) return affinity;
  }

  const connected = mockListInstancesRaw().filter((i) => i.status === 'connected');
  if (connected.length === 0) {
    mockConflict('INSTANCE_NOT_CONNECTED', 'Nenhuma instância de WhatsApp está conectada. Conecte um número em WhatsApp antes de enviar.', {
      details: mockListInstancesRaw().map((i) => ({ path: i.id, message: `${i.name}: ${INSTANCE_STATUS_LABEL[i.status] ?? i.status}` })),
    });
  }
  const withQuota = connected.filter((i) => i.today.remaining > 0);
  if (withQuota.length === 0) {
    mockConflict('INSTANCE_NOT_CONNECTED', 'Todas as instâncias conectadas já atingiram o limite de envios de hoje.', {
      details: connected.map((i) => ({ path: i.id, message: `${i.name}: cota esgotada hoje` })),
    });
  }
  return [...withQuota].sort((a, b) => {
    if (b.today.remaining !== a.today.remaining) return b.today.remaining - a.today.remaining;
    return (a.health === 'degraded' ? 1 : 0) - (b.health === 'degraded' ? 1 : 0);
  })[0]!;
}
