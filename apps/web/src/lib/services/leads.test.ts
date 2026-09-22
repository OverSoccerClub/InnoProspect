/**
 * leads.test.ts — teste de REGRESSÃO para o bug achado na revisão de QA da
 * Fase 3 (REVISAO-QA.md §5.1) e corrigido no commit `addc7d4`: `isOptedOut`
 * ficava chumbado em `false` e o filtro `?optedOut=` era um no-op — a UI
 * nunca mostrava o badge de opt-out e o parâmetro de filtro não filtrava
 * nada, sem lançar erro nenhum (comportamento incorreto sem exceção = bug).
 *
 * Cobre em particular o caso que motivou a correção (comentário da própria
 * `buildWhere` em `leads.ts`): a chave do descadastro é o TELEFONE, não o
 * Lead — o mesmo telefone pode ter sido coletado como leads diferentes
 * (`externalRef` diferente), e TODOS precisam aparecer descadastrados.
 *
 * `prisma.lead.{findMany,count,groupBy}` e `prisma.optOut.findMany` são
 * mockados com um filtro simplificado (só os campos que `buildWhere`
 * realmente usa nestes cenários) — não é um fake de banco genérico, é
 * suficiente para provar que o `where` que `listLeads` monta filtra de
 * verdade, não só que "a função foi chamada".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listLeadsQuerySchema, type ListLeadsQuery } from '@inno/contracts';

type RawLead = {
  id: string;
  name: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneType: string;
  address: string | null;
  city: { name: string } | null;
  uf: string;
  website: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  status: string;
  tags: string[];
  createdAt: Date;
};

function rawLead(overrides: Partial<RawLead> & Pick<RawLead, 'id' | 'phoneE164'>): RawLead {
  return {
    name: 'Empresa Teste',
    phoneRaw: overrides.phoneE164,
    phoneType: 'mobile',
    address: null,
    city: { name: 'Campinas' },
    uf: 'SP',
    website: null,
    category: null,
    rating: null,
    reviewCount: null,
    status: 'new',
    tags: [],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** Réplica MINIMAL do subconjunto de `where` que `buildWhere` (leads.ts) gera nestes testes — não é um interpretador genérico de filtro Prisma. */
function matchesWhere(lead: RawLead, where: Record<string, unknown> = {}): boolean {
  const statusFilter = where.status as { in: string[] } | undefined;
  if (statusFilter?.in && !statusFilter.in.includes(lead.status)) return false;

  if ('phoneE164' in where) {
    const cond = where.phoneE164 as null | { in?: string[]; notIn?: string[] };
    if (cond === null) {
      if (lead.phoneE164 !== null) return false;
    } else if (cond && 'in' in cond && cond.in) {
      if (!lead.phoneE164 || !cond.in.includes(lead.phoneE164)) return false;
    } else if (cond && 'notIn' in cond && cond.notIn) {
      if (lead.phoneE164 && cond.notIn.includes(lead.phoneE164)) return false;
    }
  }
  return true;
}

const leadsFixture: RawLead[] = [
  rawLead({ id: 'lead-a', phoneE164: '+5511987654321' }), // opted-out, lead 1 de 2 com o mesmo telefone
  rawLead({ id: 'lead-b', phoneE164: '+5511987654321' }), // opted-out, lead 2 de 2 com o MESMO telefone (rede/franquia)
  rawLead({ id: 'lead-c', phoneE164: '+5511900000000' }), // não descadastrado
  rawLead({ id: 'lead-d', phoneE164: null }), // sem telefone — nunca pode ser "opted out"
];
const optOutsFixture = [{ phoneE164: '+5511987654321' }];

const prismaMock = vi.hoisted(() => ({
  lead: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    findUnique: vi.fn(),
  },
  optOut: {
    findMany: vi.fn(),
  },
  message: {
    findMany: vi.fn(),
  },
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock }));
// `import()` dinâmico DENTRO da factory, de propósito — ver comentário
// equivalente em `webhook.test.ts` (evita "Cannot access '...' before
// initialization" do hoisting do `vi.mock` quando a factory referencia um
// binding importado de OUTRO arquivo — `prismaMock` acima funciona direto
// porque nasce de `vi.hoisted` no MESMO arquivo).
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const { listLeads, getLeadDetail } = await import('./leads');

function baseQuery(overrides: Partial<ListLeadsQuery> = {}): ListLeadsQuery {
  return { ...listLeadsQuerySchema.parse({}), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findMany.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    leadsFixture.filter((l) => matchesWhere(l, where)),
  );
  prismaMock.lead.count.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    leadsFixture.filter((l) => matchesWhere(l, where)).length,
  );
  prismaMock.lead.groupBy.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) => {
    const matched = leadsFixture.filter((l) => matchesWhere(l, where));
    const byStatus = new Map<string, number>();
    for (const l of matched) byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);
    return [...byStatus.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
  });
  prismaMock.optOut.findMany.mockImplementation(async ({ where }: { where?: { phoneE164?: { in: string[] } } } = {}) => {
    if (where?.phoneE164?.in) {
      return optOutsFixture.filter((o) => where.phoneE164!.in.includes(o.phoneE164));
    }
    return optOutsFixture;
  });
  prismaMock.message.findMany.mockResolvedValue([]);
});

describe('listLeads — isOptedOut / filtro optedOut (regressão do bug corrigido em addc7d4)', () => {
  it('isOptedOut reflete a tabela OptOut de verdade, mesmo SEM usar o filtro optedOut — antes do fix era sempre `false`', async () => {
    const result = await listLeads(baseQuery());

    const a = result.data.find((l) => l.id === 'lead-a');
    const c = result.data.find((l) => l.id === 'lead-c');
    expect(a?.isOptedOut).toBe(true);
    expect(c?.isOptedOut).toBe(false);
  });

  it('filtro optedOut=true retorna os leads cujo TELEFONE está na OptOut — inclusive quando o telefone foi coletado como DOIS leads diferentes', async () => {
    const result = await listLeads(baseQuery({ optedOut: true }));

    expect(result.data.map((l) => l.id).sort()).toEqual(['lead-a', 'lead-b']);
    expect(result.data.every((l) => l.isOptedOut)).toBe(true);
  });

  it('filtro optedOut=false EXCLUI os telefones descadastrados (antes do fix, o parâmetro era aceito e não fazia nada)', async () => {
    const result = await listLeads(baseQuery({ optedOut: false }));

    const ids = result.data.map((l) => l.id);
    expect(ids).not.toContain('lead-a');
    expect(ids).not.toContain('lead-b');
    expect(ids).toContain('lead-c');
    expect(ids).toContain('lead-d');
  });

  it('lead sem telefone nunca aparece como opted-out, mesmo que o filtro optedOut=true seja usado', async () => {
    const result = await listLeads(baseQuery({ optedOut: true }));

    expect(result.data.map((l) => l.id)).not.toContain('lead-d');
  });
});

describe('getLeadDetail — isOptedOut', () => {
  it('reflete o OptOut do telefone do lead', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce({ ...rawLead({ id: 'lead-a', phoneE164: '+5511987654321' }), activities: [], notes: null, latitude: null, longitude: null, sourceType: 'google_maps_scrape', sourceUrl: null, collectedAt: new Date(), searchJobId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });

    const detail = await getLeadDetail('lead-a');

    expect(detail.isOptedOut).toBe(true);
  });

  it('lead não descadastrado devolve isOptedOut=false', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce({ ...rawLead({ id: 'lead-c', phoneE164: '+5511900000000' }), activities: [], notes: null, latitude: null, longitude: null, sourceType: 'google_maps_scrape', sourceUrl: null, collectedAt: new Date(), searchJobId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });

    const detail = await getLeadDetail('lead-c');

    expect(detail.isOptedOut).toBe(false);
  });
});

describe('getLeadDetail — messages/lastContactedAt (antes: sempre [] / null fixos, comentário desatualizado dizia "sem Message na Fase 1")', () => {
  function leadRow(id: string) {
    return {
      ...rawLead({ id, phoneE164: '+5511900000000' }),
      activities: [],
      notes: null,
      latitude: null,
      longitude: null,
      sourceType: 'google_maps_scrape',
      sourceUrl: null,
      collectedAt: new Date(),
      searchJobId: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };
  }

  it('devolve as mensagens reais, na ordem em que a consulta trouxe (mais antiga primeiro)', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-x'));
    prismaMock.message.findMany.mockResolvedValueOnce([
      { id: 'msg-1', direction: 'inbound', body: 'Oi, quero saber mais', status: 'delivered', sentAt: null, deliveredAt: new Date('2026-09-01T10:00:00Z'), readAt: null, createdAt: new Date('2026-09-01T10:00:00Z') },
      { id: 'msg-2', direction: 'outbound', body: 'Olá! Aqui é da Innova.', status: 'sent', sentAt: new Date('2026-09-01T10:05:00Z'), deliveredAt: null, readAt: null, createdAt: new Date('2026-09-01T10:05:00Z') },
    ]);

    const detail = await getLeadDetail('lead-x');

    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]!.id).toBe('msg-1');
    expect(detail.messages[1]!.id).toBe('msg-2');
    expect(detail.messages[1]!.direction).toBe('outbound');
  });

  it('entrega o errorCode da falha, para a tela separar "pode ter saído" de "não saiu"', async () => {
    // Sem isto, EVOLUTION_SEND_UNCERTAIN aparecia como "Falhou" na conversa e
    // convidava o operador a reenviar, duplicando a mensagem no WhatsApp do lead.
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-u'));
    prismaMock.message.findMany.mockResolvedValueOnce([
      { id: 'msg-u', direction: 'outbound', body: 'Olá!', status: 'failed', errorCode: 'EVOLUTION_SEND_UNCERTAIN', sentAt: null, deliveredAt: null, readAt: null, createdAt: new Date('2026-09-01T10:00:00Z') },
      { id: 'msg-ok', direction: 'outbound', body: 'Oi de novo', status: 'sent', errorCode: 'CODIGO_ANTIGO_IRRELEVANTE', sentAt: new Date('2026-09-01T11:00:00Z'), deliveredAt: null, readAt: null, createdAt: new Date('2026-09-01T11:00:00Z') },
    ]);

    const detail = await getLeadDetail('lead-u');

    expect(detail.messages[0]!.errorCode).toBe('EVOLUTION_SEND_UNCERTAIN');
    // Fora de `failed`, o código não vaza: um errorCode residual numa
    // mensagem que acabou enviada não pode pintar o selo de erro.
    expect(detail.messages[1]!.errorCode).toBeNull();
  });

  it('lastContactedAt vem da mensagem de SAÍDA mais recente (sentAt), ignorando inbound mais novo', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-x'));
    prismaMock.message.findMany.mockResolvedValueOnce([
      { id: 'msg-1', direction: 'outbound', body: 'Olá!', status: 'sent', sentAt: new Date('2026-09-01T10:00:00Z'), deliveredAt: null, readAt: null, createdAt: new Date('2026-09-01T10:00:00Z') },
      { id: 'msg-2', direction: 'inbound', body: 'Recebido, obrigado', status: 'delivered', sentAt: null, deliveredAt: new Date('2026-09-02T09:00:00Z'), readAt: null, createdAt: new Date('2026-09-02T09:00:00Z') },
    ]);

    const detail = await getLeadDetail('lead-x');

    expect(detail.lastContactedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('mensagem outbound "queued" (sem sentAt, ex.: falhou antes de enviar) usa createdAt como lastContactedAt', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-x'));
    prismaMock.message.findMany.mockResolvedValueOnce([
      { id: 'msg-1', direction: 'outbound', body: 'Olá!', status: 'failed', sentAt: null, deliveredAt: null, readAt: null, createdAt: new Date('2026-09-01T10:00:00Z') },
    ]);

    const detail = await getLeadDetail('lead-x');

    expect(detail.lastContactedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('sem nenhuma mensagem de saída, lastContactedAt continua null', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-x'));
    prismaMock.message.findMany.mockResolvedValueOnce([
      { id: 'msg-1', direction: 'inbound', body: 'Oi', status: 'delivered', sentAt: null, deliveredAt: new Date(), readAt: null, createdAt: new Date() },
    ]);

    const detail = await getLeadDetail('lead-x');

    expect(detail.lastContactedAt).toBeNull();
    expect(detail.messages).toHaveLength(1);
  });

  it('sem mensagem nenhuma, devolve messages=[] e lastContactedAt=null (comportamento antigo, sem Message no banco)', async () => {
    prismaMock.lead.findUnique.mockResolvedValueOnce(leadRow('lead-x'));
    prismaMock.message.findMany.mockResolvedValueOnce([]);

    const detail = await getLeadDetail('lead-x');

    expect(detail.messages).toEqual([]);
    expect(detail.lastContactedAt).toBeNull();
  });
});
