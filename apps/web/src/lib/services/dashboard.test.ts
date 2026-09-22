/**
 * dashboard.test.ts — cobre `getDashboardSummary` (`lib/services/dashboard.ts`)
 * sem Postgres real (indisponível nesta máquina, ver PROGRESSO.md). `$queryRaw`
 * é mockado com uma reimplementação MINIMAL, em memória, da semântica que o
 * SQL real descreve (`EXISTS` por telefone; `GROUP BY` dia-calendário em
 * América/São_Paulo) — roteada pelo TEXTO da query (`strings.join('')`), não
 * pela ordem de chamada, para não quebrar silenciosamente se a ordem das
 * consultas em `Promise.all` mudar.
 *
 * `vi.setSystemTime` fixa o "agora" que `getDashboardSummary` usa
 * internamente (`new Date()`) — é o que torna os testes de limite de
 * dia-calendário (30 dias de `byDay`, janelas de 7 dias) determinísticos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadStatus } from '@inno/contracts';

type FakeLead = {
  id: string;
  phoneE164: string | null;
  phoneType: 'mobile' | 'landline' | 'unknown';
  status: LeadStatus;
  uf: string;
  category: string | null;
  createdAt: Date;
};

type FakeSearchJob = { id: string; status: string; finishedAt: Date | null };
type FakeSearchTask = { id: string; status: string; finishedAt: Date | null };

function fakeLead(overrides: Partial<FakeLead> & Pick<FakeLead, 'id' | 'createdAt'>): FakeLead {
  return {
    phoneE164: null,
    phoneType: 'unknown',
    status: 'new',
    uf: 'SP',
    category: null,
    ...overrides,
  };
}

let leadsFixture: FakeLead[] = [];
let optOutPhonesFixture: string[] = [];
let searchJobsFixture: FakeSearchJob[] = [];
let searchTasksFixture: FakeSearchTask[] = [];

// ─────────────────────────────────────────────────────────────────────────
// Fakes de `where` — só os formatos que `dashboard.ts` realmente monta, não
// um interpretador genérico de filtro Prisma (mesma filosofia de
// `leads.test.ts#matchesWhere`).
// ─────────────────────────────────────────────────────────────────────────

type LeadWhere = {
  createdAt?: { gte?: Date; lte?: Date; lt?: Date };
  phoneE164?: { not: null };
  phoneType?: string;
  category?: { not?: null; notIn?: string[] };
};

function matchesLeadWhere(lead: FakeLead, where: LeadWhere = {}): boolean {
  if (where.createdAt) {
    const { gte, lte, lt } = where.createdAt;
    if (gte && lead.createdAt.getTime() < gte.getTime()) return false;
    if (lte && lead.createdAt.getTime() > lte.getTime()) return false;
    if (lt && lead.createdAt.getTime() >= lt.getTime()) return false;
  }
  if (where.phoneE164?.not === null && lead.phoneE164 === null) return false;
  if (where.phoneType !== undefined && lead.phoneType !== where.phoneType) return false;
  if (where.category) {
    if (where.category.not === null && lead.category === null) return false;
    if (where.category.notIn?.includes(lead.category ?? '')) return false;
  }
  return true;
}

type JobWhere = { status?: string; finishedAt?: { gte?: Date } };

function matchesJobWhere(job: { status: string; finishedAt: Date | null }, where: JobWhere = {}): boolean {
  if (where.status !== undefined && job.status !== where.status) return false;
  if (where.finishedAt?.gte && (!job.finishedAt || job.finishedAt.getTime() < where.finishedAt.gte.getTime())) return false;
  return true;
}

/** Mesma formatação (`en-CA` = `YYYY-MM-DD`) que `dashboard.ts#toSaoPauloDateKey` usa — duplicado de propósito para o teste não importar um internal do módulo testado. */
const SP_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const prismaMock = vi.hoisted(() => ({
  lead: { count: vi.fn(), groupBy: vi.fn() },
  searchJob: { count: vi.fn() },
  searchTask: { count: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('@inno/db', () => ({ prisma: prismaMock }));

const { getDashboardSummary } = await import('./dashboard');

beforeEach(() => {
  vi.useFakeTimers();
  // "Agora" fixo para todos os testes — 2026-09-22T15:00:00Z = 2026-09-22
  // 12:00 em América/São_Paulo (bem no meio do dia, longe de qualquer
  // fronteira de dia-calendário).
  vi.setSystemTime(new Date('2026-09-22T15:00:00.000Z'));

  leadsFixture = [];
  optOutPhonesFixture = [];
  searchJobsFixture = [];
  searchTasksFixture = [];
  vi.clearAllMocks();

  prismaMock.lead.count.mockImplementation(async ({ where }: { where?: LeadWhere } = {}) =>
    leadsFixture.filter((l) => matchesLeadWhere(l, where)).length,
  );

  prismaMock.lead.groupBy.mockImplementation(
    async ({
      by,
      where,
      orderBy,
      take,
    }: {
      by: (keyof FakeLead)[];
      where?: LeadWhere;
      orderBy?: { _count?: { id?: 'asc' | 'desc' } };
      take?: number;
    }) => {
      const field = by[0]!;
      const matched = leadsFixture.filter((l) => matchesLeadWhere(l, where));
      const counts = new Map<string, number>();
      for (const lead of matched) {
        const key = String(lead[field]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let groups = [...counts.entries()].map(([key, count]) => ({ [field]: key, _count: { _all: count } }));
      if (orderBy?._count?.id === 'desc') groups = groups.sort((a, b) => b._count._all - a._count._all);
      if (take !== undefined) groups = groups.slice(0, take);
      return groups;
    },
  );

  prismaMock.$queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('');
    if (sql.includes('EXISTS')) {
      const count = leadsFixture.filter((l) => l.phoneE164 !== null && optOutPhonesFixture.includes(l.phoneE164)).length;
      return Promise.resolve([{ count }]);
    }
    if (sql.includes('date_trunc')) {
      const since = values[0] as Date;
      const counts = new Map<string, number>();
      for (const lead of leadsFixture) {
        if (lead.createdAt.getTime() < since.getTime()) continue;
        const key = SP_DATE_FORMATTER.format(lead.createdAt);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const rows = [...counts.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));
      return Promise.resolve(rows);
    }
    throw new Error(`$queryRaw inesperado no teste: ${sql}`);
  });

  prismaMock.searchJob.count.mockImplementation(async ({ where }: { where?: JobWhere } = {}) =>
    searchJobsFixture.filter((j) => matchesJobWhere(j, where)).length,
  );
  prismaMock.searchTask.count.mockImplementation(async ({ where }: { where?: JobWhere } = {}) =>
    searchTasksFixture.filter((t) => matchesJobWhere(t, where)).length,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getDashboardSummary — base vazia (estado real de produção hoje)', () => {
  it('devolve tudo zerado sem quebrar', async () => {
    const result = await getDashboardSummary();

    expect(result.timezone).toBe('America/Sao_Paulo');
    expect(result.leads.total).toBe(0);
    expect(result.leads.createdLast7d).toBe(0);
    expect(result.leads.createdPrev7d).toBe(0);
    expect(result.leads.withPhone).toBe(0);
    expect(result.leads.withMobile).toBe(0);
    expect(result.leads.optedOut).toBe(0);
    expect(result.leads.topUfs).toEqual([]);
    expect(result.leads.topCategories).toEqual([]);
    expect(result.leads.byStatus).toEqual({
      new: 0,
      validated: 0,
      contacted: 0,
      responded: 0,
      negotiating: 0,
      won: 0,
      discarded: 0,
    });
    expect(result.leads.byDay).toHaveLength(30);
    expect(result.leads.byDay.every((d) => d.count === 0)).toBe(true);
    expect(result.searches).toEqual({ queued: 0, running: 0, completedLast30d: 0, tasksFailedLast30d: 0 });
  });
});

describe('getDashboardSummary — leads.byDay', () => {
  it('preenche dias vazios com zero e mantém exatamente 30 itens, em ordem crescente', async () => {
    leadsFixture = [
      fakeLead({ id: 'l1', createdAt: new Date('2026-09-22T12:00:00.000Z') }), // hoje
      fakeLead({ id: 'l2', createdAt: new Date('2026-09-22T13:00:00.000Z') }), // hoje, 2º lead
      fakeLead({ id: 'l3', createdAt: new Date('2026-09-12T14:00:00.000Z') }), // 10 dias atrás
      fakeLead({ id: 'l4', createdAt: new Date('2026-08-24T14:00:00.000Z') }), // 29 dias atrás — dia mais antigo da janela
      fakeLead({ id: 'l5', createdAt: new Date('2026-08-22T14:00:00.000Z') }), // 31 dias atrás — FORA da janela de 30 dias
    ];

    const { byDay } = (await getDashboardSummary()).leads;

    expect(byDay).toHaveLength(30);
    expect(byDay[0]!.date).toBe('2026-08-24');
    expect(byDay[29]!.date).toBe('2026-09-22');
    expect(byDay[0]).toEqual({ date: '2026-08-24', count: 1 });
    expect(byDay[29]).toEqual({ date: '2026-09-22', count: 2 });
    expect(byDay.find((d) => d.date === '2026-09-12')).toEqual({ date: '2026-09-12', count: 1 });
    // O lead de 31 dias atrás não pode aparecer em NENHUM dos 30 dias.
    expect(byDay.find((d) => d.date === '2026-08-22')).toBeUndefined();
    // Todo dia fora dos 3 acima tem que estar zerado (preenchido no código).
    const diasComLead = new Set(['2026-08-24', '2026-09-12', '2026-09-22']);
    for (const d of byDay) {
      if (!diasComLead.has(d.date)) expect(d.count).toBe(0);
    }
  });
});

describe('getDashboardSummary — leads.byStatus', () => {
  it('traz os 7 estados mesmo sem lead em nenhum deles, mesmo com leads em só 2 estados', async () => {
    leadsFixture = [
      fakeLead({ id: 'l1', createdAt: new Date('2026-09-20T12:00:00.000Z'), status: 'new' }),
      fakeLead({ id: 'l2', createdAt: new Date('2026-09-20T12:00:00.000Z'), status: 'new' }),
      fakeLead({ id: 'l3', createdAt: new Date('2026-09-20T12:00:00.000Z'), status: 'won' }),
    ];

    const { byStatus } = (await getDashboardSummary()).leads;

    expect(byStatus).toEqual({
      new: 2,
      validated: 0,
      contacted: 0,
      responded: 0,
      negotiating: 0,
      won: 1,
      discarded: 0,
    });
  });
});

describe('getDashboardSummary — leads.optedOut', () => {
  it('conta por TELEFONE: dois leads com o mesmo telefone descadastrado contam os dois', async () => {
    leadsFixture = [
      fakeLead({ id: 'l1', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511987654321' }),
      fakeLead({ id: 'l2', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511987654321' }), // mesmo telefone, lead diferente
      fakeLead({ id: 'l3', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511900000000' }), // não descadastrado
    ];
    optOutPhonesFixture = ['+5511987654321'];

    const { optedOut } = (await getDashboardSummary()).leads;

    expect(optedOut).toBe(2);
  });

  it('lead sem telefone nunca conta como opted-out', async () => {
    leadsFixture = [fakeLead({ id: 'l1', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: null })];
    optOutPhonesFixture = [];

    const { optedOut } = (await getDashboardSummary()).leads;

    expect(optedOut).toBe(0);
  });
});

describe('getDashboardSummary — createdLast7d / createdPrev7d', () => {
  it('usa os MESMOS limites de dia-calendário (SP) que byDay, não uma janela rolante de 7*24h', async () => {
    leadsFixture = [
      fakeLead({ id: 'x', createdAt: new Date('2026-09-22T14:00:00.000Z') }), // hoje — dentro dos últimos 7 dias
      fakeLead({ id: 'y', createdAt: new Date('2026-09-16T04:00:00.000Z') }), // início exato da janela de 7 dias (dayKeys[23])
      fakeLead({ id: 'z', createdAt: new Date('2026-09-15T20:00:00.000Z') }), // 1 dia-calendário SP antes — cai nos 7 dias ANTERIORES
      fakeLead({ id: 'w', createdAt: new Date('2026-09-01T14:00:00.000Z') }), // fora das duas janelas
    ];

    const { total, createdLast7d, createdPrev7d } = (await getDashboardSummary()).leads;

    expect(total).toBe(4);
    expect(createdLast7d).toBe(2); // x, y
    expect(createdPrev7d).toBe(1); // z
  });
});

describe('getDashboardSummary — withPhone / withMobile / topUfs / topCategories', () => {
  it('agrega telefone/celular corretamente e ignora category nula/vazia em topCategories', async () => {
    leadsFixture = [
      fakeLead({ id: 'l1', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511900000001', phoneType: 'mobile', uf: 'SP', category: 'Odontologia' }),
      fakeLead({ id: 'l2', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511900000002', phoneType: 'mobile', uf: 'SP', category: 'Odontologia' }),
      fakeLead({ id: 'l3', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: '+5511900000003', phoneType: 'landline', uf: 'RJ', category: null }),
      fakeLead({ id: 'l4', createdAt: new Date('2026-09-20T12:00:00.000Z'), phoneE164: null, phoneType: 'unknown', uf: 'RJ', category: '' }),
    ];

    const { withPhone, withMobile, topUfs, topCategories } = (await getDashboardSummary()).leads;

    expect(withPhone).toBe(3);
    expect(withMobile).toBe(2);
    expect(topUfs).toEqual(
      expect.arrayContaining([
        { uf: 'SP', count: 2 },
        { uf: 'RJ', count: 2 },
      ]),
    );
    expect(topCategories).toEqual([{ category: 'Odontologia', count: 2 }]);
  });
});

describe('getDashboardSummary — searches', () => {
  it('conta por status (queued/running) e por janela de 30 dias (completedLast30d/tasksFailedLast30d)', async () => {
    searchJobsFixture = [
      { id: 'j1', status: 'queued', finishedAt: null },
      { id: 'j2', status: 'running', finishedAt: null },
      { id: 'j3', status: 'completed', finishedAt: new Date('2026-09-20T12:00:00.000Z') }, // dentro dos 30 dias
      { id: 'j4', status: 'completed', finishedAt: new Date('2026-07-01T12:00:00.000Z') }, // fora dos 30 dias
    ];
    searchTasksFixture = [
      { id: 't1', status: 'failed', finishedAt: new Date('2026-09-21T12:00:00.000Z') }, // dentro
      { id: 't2', status: 'failed', finishedAt: new Date('2026-01-01T12:00:00.000Z') }, // fora
      { id: 't3', status: 'done', finishedAt: new Date('2026-09-21T12:00:00.000Z') }, // não é failed
    ];

    const { searches } = await getDashboardSummary();

    expect(searches).toEqual({ queued: 1, running: 1, completedLast30d: 1, tasksFailedLast30d: 1 });
  });
});

describe('getDashboardSummary — SQL de byDay (regressão de fuso)', () => {
  // Este teste NÃO prova a semântica do SQL — sem Postgres nada prova, e o
  // mock acima reimplementa o agrupamento em JS, então passaria com o SQL
  // errado. O que ele trava é a EXPRESSÃO: `createdAt` é `TIMESTAMP(3)` SEM
  // fuso, gravado em UTC, e `"createdAt" AT TIME ZONE 'America/Sao_Paulo'`
  // sozinho desloca 3h no sentido errado (leads das 21h às 0h iam para o dia
  // seguinte). A versão curta parece mais limpa, e é exatamente essa a
  // "simplificação" que este teste existe para barrar.
  it('converte UTC -> São Paulo com AT TIME ZONE duplo, nesta ordem', async () => {
    await getDashboardSummary();

    const sqlDoByDay = prismaMock.$queryRaw.mock.calls
      .map((call) => (call[0] as TemplateStringsArray).join('?'))
      .find((sql) => sql.includes('date_trunc'));

    expect(sqlDoByDay).toBeDefined();
    const normalizado = sqlDoByDay!.replace(/\s+/g, ' ');
    expect(normalizado).toContain(`("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'`);
  });
});