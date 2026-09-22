/**
 * lib/services/dashboard.ts — `GET /api/v1/dashboard/summary` (painel
 * logado). CONTRATO fechado pelo Atlas com a Lyra — não mudar o formato de
 * `DashboardSummary` (`@inno/contracts`) sem repassar por ela.
 *
 * Janelas de tempo, duas convenções DIFERENTES de propósito:
 *   - `byDay` é uma série DIÁRIA, por natureza alinhada a dia-calendário — em
 *     `America/Sao_Paulo` (ARQUITETURA/contrato), não em UTC.
 *   - `createdLast7d`/`createdPrev7d` são contados com os MESMOS limites de
 *     dia-calendário (SP) que `byDay` usa — de propósito, para a UI poder
 *     mostrar "criados nos últimos 7 dias" ao lado do sparkline sem os dois
 *     números divergirem (somar os últimos 7 itens de `byDay` bate com
 *     `createdLast7d`). `completedLast30d`/`tasksFailedLast30d` (seção
 *     `searches`) já são uma janela ROLANTE simples (`generatedAt - 30*24h`,
 *     UTC) — não têm série diária ao lado para precisar bater com nada.
 *
 * `toSaoPauloDateKey`/`saoPauloDayStartUtc` assumem offset FIXO -03:00 —
 * válido porque o Brasil não tem horário de verão desde 2019/2020. Se essa
 * lei mudar, os dois precisam ser reescritos com um conversor de fuso de
 * verdade (`Intl` sozinho não dá o offset numérico de forma direta).
 *
 * ⚠️ Não pude rodar nenhuma destas queries contra Postgres real (indisponível
 * nesta máquina, ver PROGRESSO.md). `byDay`/`optedOut` usam `$queryRaw` com
 * tagged template (sempre parametrizado — nunca `$queryRawUnsafe`, nunca
 * interpolação de string) e `::int` explícito no `COUNT(*)` para já devolver
 * `number` (não `bigint`) — mas o SQL em si só se prova de verdade no
 * primeiro acesso a um Postgres real. Ver PENDÊNCIAS no handoff sobre os
 * índices que estas consultas pedem e que `Lead`/`SearchJob`/`SearchTask`
 * ainda não têm.
 */
import { prisma } from '@inno/db';
import type { DashboardSearchesSummary, DashboardSummary, LeadStatus } from '@inno/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Chave `YYYY-MM-DD` do dia-calendário em América/São_Paulo que contém o instante `date`. */
function toSaoPauloDateKey(date: Date): string {
  return SAO_PAULO_DATE_FORMATTER.format(date);
}

/** Instante UTC da meia-noite de `dateKey` em América/São_Paulo (offset fixo -03:00, ver comentário no topo do arquivo). */
function saoPauloDayStartUtc(dateKey: string): Date {
  return new Date(`${dateKey}T03:00:00.000Z`);
}

/** As 30 chaves de dia-calendário (SP) que `byDay` cobre, da mais antiga para a mais recente — `keys[29]` é sempre o dia de `generatedAt`. */
function last30DayKeys(generatedAt: Date): string[] {
  const keys: string[] = [];
  for (let i = 29; i >= 0; i--) {
    keys.push(toSaoPauloDateKey(new Date(generatedAt.getTime() - i * DAY_MS)));
  }
  return keys;
}

type ByDayRow = { day: string; count: number };

function buildByDay(generatedAt: Date, rows: ByDayRow[]): DashboardSummary['leads']['byDay'] {
  const countsByDay = new Map(rows.map((row) => [row.day, row.count]));
  // Preenchido AQUI, não confiando que o `GROUP BY` devolveu os 30 dias —
  // dia sem lead simplesmente não aparece na query, e precisa virar `0`.
  return last30DayKeys(generatedAt).map((date) => ({ date, count: countsByDay.get(date) ?? 0 }));
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

function buildByStatus(groups: { status: LeadStatus; _count: { _all: number } }[]): Record<LeadStatus, number> {
  const byStatus: Record<LeadStatus, number> = { ...EMPTY_STATUS_COUNTS };
  for (const group of groups) byStatus[group.status] = group._count._all;
  return byStatus;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const generatedAt = new Date();
  const dayKeys = last30DayKeys(generatedAt);
  // `dayKeys[23]` = início da janela de 7 dias que termina hoje (hoje + 6
  // dias anteriores = 7 chaves, índices 23..29). `dayKeys[16]` = início dos 7
  // dias imediatamente anteriores a essa janela (índices 16..22) — contígua,
  // sem sobreposição nem buraco com a janela de cima.
  const last7Start = saoPauloDayStartUtc(dayKeys[23]!);
  const prev7Start = saoPauloDayStartUtc(dayKeys[16]!);
  const searchesCutoff30d = new Date(generatedAt.getTime() - 30 * DAY_MS);
  // Margem extra (32 dias) só para o filtro do `$queryRaw` de `byDay` não
  // depender de acertar o limite exato — o recorte fino de "quais dias
  // entram" é feito em `buildByDay`/`last30DayKeys`, não aqui.
  const byDaySince = new Date(generatedAt.getTime() - 32 * DAY_MS);

  const [
    total,
    createdLast7d,
    createdPrev7d,
    withPhone,
    withMobile,
    optedOutRows,
    statusGroups,
    byDayRows,
    topUfGroups,
    topCategoryGroups,
    queued,
    running,
    completedLast30d,
    tasksFailedLast30d,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: last7Start, lte: generatedAt } } }),
    prisma.lead.count({ where: { createdAt: { gte: prev7Start, lt: last7Start } } }),
    prisma.lead.count({ where: { phoneE164: { not: null } } }),
    prisma.lead.count({ where: { phoneType: 'mobile' } }),
    // `optedOut`: a chave do descadastro é o TELEFONE, não o lead (mesma
    // regra de `lib/services/leads.ts#buildWhere`) — por isso `EXISTS` contra
    // `opt_outs` por telefone, não uma relação por `leadId`. Dois leads com o
    // MESMO telefone descadastrado contam os dois (cada linha de `leads` é
    // avaliada independentemente).
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM leads l
      WHERE l."phoneE164" IS NOT NULL
        AND EXISTS (SELECT 1 FROM opt_outs o WHERE o."phoneE164" = l."phoneE164")
    `,
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    // `to_char(... , 'YYYY-MM-DD')` devolve a data já formatada como texto —
    // evita reconverter um `date`/`timestamp` do driver de volta para
    // string no fuso certo no lado do Node (fonte comum de off-by-one).
    //
    // ⚠️ DUPLO `AT TIME ZONE`, e a ordem importa. O Prisma mapeia `DateTime`
    // para `TIMESTAMP(3)` SEM fuso e grava o valor em UTC. Nesse tipo,
    // `"createdAt" AT TIME ZONE 'America/Sao_Paulo'` sozinho faz o contrário
    // do desejado: trata o valor UTC como se já fosse horário de SP e desloca
    // 3h no sentido errado. Todo lead criado entre 21h e 0h de SP cairia no
    // dia seguinte, e a soma dos últimos 7 itens de `byDay` deixaria de bater
    // com `createdLast7d`. O primeiro `AT TIME ZONE 'UTC'` declara o que o
    // valor é (um instante UTC); o segundo converte para o relógio de SP.
    // Correto independentemente do timezone da sessão do Postgres.
    prisma.$queryRaw<ByDayRow[]>`
      SELECT
        to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM leads
      WHERE "createdAt" >= ${byDaySince}
      GROUP BY day
      ORDER BY day ASC
    `,
    prisma.lead.groupBy({ by: ['uf'], _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 5 }),
    prisma.lead.groupBy({
      by: ['category'],
      where: { category: { not: null, notIn: [''] } },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    }),
    prisma.searchJob.count({ where: { status: 'queued' } }),
    prisma.searchJob.count({ where: { status: 'running' } }),
    prisma.searchJob.count({ where: { status: 'completed', finishedAt: { gte: searchesCutoff30d } } }),
    prisma.searchTask.count({ where: { status: 'failed', finishedAt: { gte: searchesCutoff30d } } }),
  ]);

  const searches: DashboardSearchesSummary = { queued, running, completedLast30d, tasksFailedLast30d };

  return {
    generatedAt: generatedAt.toISOString(),
    timezone: 'America/Sao_Paulo',
    leads: {
      total,
      createdLast7d,
      createdPrev7d,
      withPhone,
      withMobile,
      optedOut: optedOutRows[0]?.count ?? 0,
      byStatus: buildByStatus(statusGroups),
      byDay: buildByDay(generatedAt, byDayRows),
      topUfs: topUfGroups.map((g) => ({ uf: g.uf, count: g._count._all })),
      // `category` não pode ser `null` aqui: o `where` já filtrou
      // `not: null, notIn: ['']` — o `!` só afirma pro TS o que o Postgres já garantiu.
      topCategories: topCategoryGroups.map((g) => ({ category: g.category!, count: g._count._all })),
    },
    searches,
  };
}
