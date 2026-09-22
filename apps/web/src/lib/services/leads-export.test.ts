/**
 * leads-export.test.ts — `GET /api/v1/leads/export` (ARQUITETURA §4.3,
 * revisado 2026-09-22). Cobre exatamente os pontos exigidos no escopo:
 *   1. Escape de injeção de fórmula (CWE-1236) — um valor que comece com
 *      `=`/`+`/`-`/`@` NUNCA pode virar fórmula ao abrir no Excel.
 *   2. O filtro de `GET /leads` é RESPEITADO no export (`iterateLeadsForExport`
 *      reusa a mesma `buildWhere` via `resolveLeadWhere` — não uma segunda
 *      implementação de filtro).
 *
 * `prisma.lead.{findMany,count}`/`prisma.optOut.findMany` mockados com um
 * filtro simplificado — mesmo padrão de `leads.test.ts` (só os campos que
 * `buildWhere` usa nestes cenários, não um interpretador genérico).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RawLead = {
  id: string;
  name: string;
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
  sourceUrl: string;
  collectedAt: Date;
  createdAt: Date;
};

function rawLead(overrides: Partial<RawLead> & Pick<RawLead, 'id'>): RawLead {
  return {
    name: 'Empresa Teste',
    phoneE164: '+5511900000000',
    phoneType: 'mobile',
    address: 'Rua X, 1',
    city: { name: 'Campinas' },
    uf: 'SP',
    website: null,
    category: 'Clínica',
    rating: 4.5,
    reviewCount: 10,
    status: 'new',
    tags: [],
    sourceUrl: 'https://maps.google.com/x',
    collectedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

const fixture: RawLead[] = [
  rawLead({ id: 'lead-won', status: 'won', phoneE164: '+5511900000001' }),
  rawLead({ id: 'lead-new-1', status: 'new', phoneE164: '+5511900000002' }),
  // Mesmo status 'new' que lead-new-1, mas com o telefone DESCADASTRADO —
  // prova que a coluna `descadastrado` reflete a OptOut de verdade, não o filtro.
  rawLead({ id: 'lead-new-optout', status: 'new', phoneE164: '+5511900000003' }),
];
const optOutFixture = [{ phoneE164: '+5511900000003' }];

function matchesWhere(lead: RawLead, where: Record<string, unknown> = {}): boolean {
  const statusFilter = where.status as { in: string[] } | undefined;
  if (statusFilter?.in && !statusFilter.in.includes(lead.status)) return false;
  return true;
}

const prismaMock = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), count: vi.fn() },
  optOut: { findMany: vi.fn() },
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock }));
// Ver comentário equivalente em `leads.test.ts`/`webhook.test.ts` sobre por
// que o `import()` dinâmico fica DENTRO da factory.
vi.mock('@/lib/api-handler', async () => {
  const { apiHandlerMockFactory } = await import('@/test/api-handler-mock');
  return apiHandlerMockFactory();
});
vi.mock('@/lib/logger', async () => {
  const { loggerMockFactory } = await import('@/test/logger-mock');
  return loggerMockFactory();
});

const { buildCsvLine, countLeadsForExport, escapeCsvField, iterateLeadsForExport, leadExportFilename } =
  await import('./leads');
const { exportLeadsQuerySchema } = await import('@inno/contracts');

function baseFilter(overrides: Record<string, unknown> = {}) {
  return exportLeadsQuerySchema.parse(overrides);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findMany.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    fixture.filter((l) => matchesWhere(l, where)),
  );
  prismaMock.lead.count.mockImplementation(async ({ where }: { where?: Record<string, unknown> } = {}) =>
    fixture.filter((l) => matchesWhere(l, where)).length,
  );
  prismaMock.optOut.findMany.mockImplementation(
    async ({ where }: { where?: { phoneE164?: { in: string[] } } } = {}) => {
      if (where?.phoneE164?.in) return optOutFixture.filter((o) => where.phoneE164!.in.includes(o.phoneE164));
      return optOutFixture;
    },
  );
});

describe('escapeCsvField / buildCsvLine — injeção de fórmula em CSV (CWE-1236)', () => {
  it.each(['=SOMA(A1:A2)', '+5511999999999', '-1+1', '@usuario'])(
    'prefixa apóstrofo quando o valor começa com um gatilho de fórmula (%s)',
    (raw) => {
      expect(escapeCsvField(raw)).toBe(`'${raw}`);
    },
  );

  it('NÃO altera um valor que não começa com gatilho de fórmula', () => {
    expect(escapeCsvField('Empresa Normal')).toBe('Empresa Normal');
  });

  it('envolve em aspas e escapa aspas internas quando o valor contém separador `;`, aspas ou quebra de linha', () => {
    expect(escapeCsvField('Rua A; nº 10')).toBe('"Rua A; nº 10"');
    expect(escapeCsvField('disse "oi"')).toBe('"disse ""oi"""');
    expect(escapeCsvField('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('buildCsvLine junta os campos com `;` (não `,` — decimal do Excel PT-BR) e termina em CRLF', () => {
    expect(buildCsvLine(['a', 'b', '=cmd'])).toBe("a;b;'=cmd\r\n");
  });
});

describe('leadExportFilename', () => {
  it('é datado: leads-YYYY-MM-DD.csv', () => {
    expect(leadExportFilename(new Date('2026-09-22T15:00:00Z'))).toBe('leads-2026-09-22.csv');
  });
});

describe('countLeadsForExport / iterateLeadsForExport — reusam o MESMO filtro de GET /leads', () => {
  it('countLeadsForExport conta só os leads que casam com o filtro', async () => {
    await expect(countLeadsForExport(baseFilter({ status: ['won'] }))).resolves.toBe(1);
  });

  it('iterateLeadsForExport devolve só os leads do filtro pedido', async () => {
    const rows: Record<string, string>[] = [];
    for await (const row of iterateLeadsForExport(baseFilter({ status: ['new'] }))) rows.push(row);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['new', 'new']);
  });

  it('a coluna `descadastrado` reflete a tabela OptOut de verdade, mesmo dentro do mesmo filtro de status', async () => {
    const rows: Record<string, string>[] = [];
    for await (const row of iterateLeadsForExport(baseFilter({ status: ['new'] }))) rows.push(row);

    const optedRow = rows.find((r) => r.telefone === '+5511900000003');
    const notOptedRow = rows.find((r) => r.telefone === '+5511900000002');
    expect(optedRow?.descadastrado).toBe('sim');
    expect(notOptedRow?.descadastrado).toBe('não');
  });

  it('sem filtro nenhum, devolve todos os leads', async () => {
    const rows: Record<string, string>[] = [];
    for await (const row of iterateLeadsForExport(baseFilter())) rows.push(row);
    expect(rows).toHaveLength(3);
  });
});
